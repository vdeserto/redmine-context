/**
 * Superfície MCP (stdio) do `redmine-context` (M1-12).
 *
 * Expõe a tool read-only `get_issue_context(issue_id, format?)`, que reutiliza a
 * orquestração `fetchIssueBundle` do core. Segue a mesma fronteira da CLI
 * (ADR-005): importa o core EXCLUSIVAMENTE por `../../index.js`; nenhum módulo
 * interno é acessado diretamente (regra eslint `no-restricted-imports`).
 *
 * Segurança: NENHUMA tool aceita URL/host arbitrário — a instância vem sempre da
 * config/env do processo (`REDMINE_URL`; sem ela, a URL persistida no `login`,
 * #187) + cascata de credencial. Quando a URL vem da persistida (fonte mutável),
 * a credencial de AMBIENTE (`REDMINE_API_KEY`, instance-agnóstica) é DESABILITADA
 * — só credencial pinada à instância (keychain/arquivo) é aceita, impedindo que um
 * `settings.json` adulterado exfiltre a chave (ver `resolveInstance`). No transporte
 * stdio o protocolo ocupa o stdout, portanto todo diagnóstico vai para stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  ATTACHMENT_INPUT_SCHEMA,
  ATTACHMENT_TOOL_NAME,
  INPUT_SCHEMA,
  LAST_INPUT_SCHEMA,
  LAST_TOOL_NAME,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_INPUT_SCHEMA,
  SEARCH_TOOL_NAME,
  TOOL_NAME,
  type GetAttachmentTextArgs,
  type GetIssueContextArgs,
  type GetLastArgs,
  type SearchIssuesArgs,
} from './tools.js';
import * as core from '../../index.js';
import { fenceBlock } from '../../index.js';
import type {
  AttachmentTextResult,
  BundleFormat,
  FetchAttachmentTextOptions,
  IssueSearchFilters,
  resolveApiKey,
} from '../../index.js';

/**
 * Dependências injetáveis do server MCP — permitem testar o handler sem tocar o
 * processo real nem a rede. Os defaults (ver {@link defaultMcpDeps}) apontam para
 * o core e o `process.env` reais.
 */
export interface McpServerDeps {
  /** Orquestração get → normalize → bundle do core. */
  fetchIssueBundle: typeof core.fetchIssueBundle;
  /** Orquestração de busca (filtros + full-text best-effort) do core. */
  searchIssues: typeof core.fetchIssueSearch;
  /** Orquestração das últimas issues (ordem + bundle completo) do core. */
  fetchLastIssues: typeof core.fetchLastIssues;
  /**
   * Orquestração get → normalize → extração CACHE-FIRST de UM anexo (M4-11 #70):
   * devolve o texto já cacheado na hora e `processing` (sem bloquear) para mídia
   * ainda não processada. Default: {@link core.fetchAttachmentTextCacheFirst}.
   * Tipada pela assinatura base para aceitar tanto a variante cache-first quanto
   * a síncrona (M3) nos testes.
   */
  fetchAttachmentText: (options: FetchAttachmentTextOptions) => Promise<AttachmentTextResult>;
  /** Resolução de credencial pela cascata (arquivo → env). */
  resolveApiKey: typeof resolveApiKey;
  /** Ambiente consultado para `REDMINE_URL` e pela cascata de credencial. */
  env: NodeJS.ProcessEnv;
  /**
   * Store da URL da instância persistida (#187): fallback quando `REDMINE_URL`
   * não está no ambiente do processo (ex.: registro MCP sem a env, mas com
   * `login` já feito). Continua uma ÚNICA instância configurada — nunca vem dos
   * argumentos das tools. Opcional (ausente nos testes que fixam a env).
   */
  settings?: core.SettingsStore;
  /** Versão da ferramenta gravada no bundle. */
  toolVersion: string;
  /**
   * Permite `http://` (sem TLS) com aviso ruidoso. Derivado de `REDMINE_INSECURE`
   * no ambiente do processo. Default: `false` (só `https://`). Espelha a flag
   * `--insecure` da CLI para os ambientes de teste/CI que usam http local.
   */
  insecure?: boolean;
  /** Sink de diagnóstico (progresso/erros) — SEMPRE stderr no stdio transport. */
  log?: (message: string) => void;
}

/** Interpreta `REDMINE_INSECURE` (`1`/`true`, case-insensitive) como boolean. */
function parseInsecure(env: NodeJS.ProcessEnv): boolean {
  const raw = env.REDMINE_INSECURE;
  return raw !== undefined && /^(1|true)$/i.test(raw.trim());
}

/** Extrai uma mensagem legível de um erro desconhecido. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Monta um `CallToolResult` de erro (isError) com uma única mensagem de texto. */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Monta um `CallToolResult` de sucesso com o bundle serializado. */
function textResult(content: string): CallToolResult {
  return { content: [{ type: 'text', text: content }] };
}

/**
 * Traduz um erro da operação em uma mensagem MCP clara e tipada.
 *
 * 403/404/401 recebem texto orientado; os demais propagam a mensagem original.
 * Nenhum resultado é cacheado aqui — o erro é sempre recomputado por chamada.
 *
 * @param error - Erro capturado durante o fetch/bundle.
 * @param issueId - Id da issue para compor a mensagem.
 * @returns A mensagem a ser exibida no `isError`.
 */
function typedErrorMessage(error: unknown, issueId: number): string {
  if (error instanceof core.RedmineNotFoundError) {
    return `Issue #${issueId} não encontrada (404). Verifique o id na instância configurada.`;
  }
  if (error instanceof core.RedmineForbiddenError) {
    return `Acesso negado à issue #${issueId} (403). A credencial não tem permissão para vê-la.`;
  }
  if (error instanceof core.RedmineAuthError) {
    return 'Falha de autenticação (401). Verifique a credencial em REDMINE_API_KEY.';
  }
  return messageOf(error);
}

/** Instância resolvida a partir da env: base URL + credencial já validadas. */
interface ResolvedInstance {
  baseUrl: string;
  apiKey: string;
}

/**
 * Resolve `REDMINE_URL` + credencial da env (nunca de argumentos das tools).
 *
 * Fonte única da política "sem URL/host nos argumentos": ambas as tools passam
 * por aqui. Em falha devolve um {@link CallToolResult} de erro orientado; em
 * sucesso, a instância pronta para uso.
 *
 * @param deps - Ver {@link McpServerDeps}.
 * @returns A instância resolvida, ou um CallToolResult de erro (`isError`).
 */
async function resolveInstance(deps: McpServerDeps): Promise<ResolvedInstance | CallToolResult> {
  // REDMINE_URL tem precedência; sem ela, cai na URL persistida no login (#187),
  // via o resolvedor único (trata string vazia como ausente). Continua UMA
  // instância configurada (env/persistida) — nunca de argumento de tool.
  const persistedUrl = deps.settings ? await deps.settings.getInstanceUrl() : undefined;
  const resolved = core.resolveInstanceUrl({ envUrl: deps.env.REDMINE_URL, persistedUrl });
  if (resolved === undefined) {
    return errorResult(
      'Instância não configurada. Defina REDMINE_URL no ambiente do processo ou rode `redmine-context login`.',
    );
  }
  const { url: baseUrl, origin } = resolved;
  // Auditabilidade (#187): quando a instância NÃO veio da env (fallback persistido),
  // registra a URL em uso no diagnóstico (o stdout é do protocolo → vai ao stderr).
  if (origin !== 'env') {
    deps.log?.(`instância resolvida via ${origin}: ${baseUrl}`);
  }

  let apiKey: string | undefined;
  try {
    apiKey = await deps.resolveApiKey(baseUrl, {
      env: deps.env,
      // SEGURANÇA (#187): URL de fonte MUTÁVEL (settings.json persistido, origem
      // `config`) NÃO pode usar a REDMINE_API_KEY instance-agnóstica — só credencial
      // PINADA à instância (keychain/arquivo). Impede que um settings.json adulterado
      // redirecione a chave real para um host arbitrário (fail-closed).
      allowEnvFallback: origin !== 'config',
      // Aviso de migração/keychain vai para o diagnóstico (stdout é do protocolo).
      logger: { warn: (message) => deps.log?.(message) },
    });
  } catch (error) {
    return errorResult(messageOf(error));
  }
  if (apiKey === undefined || apiKey.length === 0) {
    return errorResult(
      `Nenhuma credencial encontrada para ${baseUrl}. Configure REDMINE_API_KEY (ou o arquivo de credenciais via 'redmine-context login').`,
    );
  }
  return { baseUrl, apiKey };
}

/** Type guard: distingue a instância resolvida de um CallToolResult de erro. */
function isResolved(value: ResolvedInstance | CallToolResult): value is ResolvedInstance {
  return 'baseUrl' in value;
}

/**
 * Cria o handler da tool `get_issue_context`, testável isoladamente.
 *
 * Resolve a instância/credencial a partir da env (nunca de argumentos), invoca
 * `fetchIssueBundle` e devolve o bundle. Erros viram `isError` com mensagem
 * tipada; a ausência de `REDMINE_URL`/credencial orienta a configuração.
 *
 * @param deps - Ver {@link McpServerDeps}.
 * @returns Função assíncrona que recebe os argumentos e devolve um CallToolResult.
 * @example
 * const handler = createGetIssueContextHandler(defaultMcpDeps());
 * const result = await handler({ issue_id: 42, format: 'json' });
 */
export function createGetIssueContextHandler(
  deps: McpServerDeps,
): (args: GetIssueContextArgs) => Promise<CallToolResult> {
  return async (args: GetIssueContextArgs): Promise<CallToolResult> => {
    const resolved = await resolveInstance(deps);
    if (!isResolved(resolved)) return resolved;
    const { baseUrl, apiKey } = resolved;

    const format: BundleFormat = args.format === 'json' ? 'json' : 'md';
    try {
      let content: string | undefined;
      for await (const event of deps.fetchIssueBundle({
        baseUrl,
        apiKey,
        issueId: args.issue_id,
        format,
        toolVersion: deps.toolVersion,
        insecure: deps.insecure ?? false,
        extractAttachments: args.extract_attachments ?? false,
        // Cache-first (#70): embute o texto já pronto e marca o restante como
        // `processing` sem bloquear na extração cara (a computação corre em background).
        cacheFirst: true,
      })) {
        if (event.kind === 'progress') {
          deps.log?.(event.message);
        } else {
          content = event.value.content;
        }
      }
      if (content === undefined) {
        return errorResult('A operação não produziu um bundle.');
      }
      return textResult(content);
    } catch (error) {
      return errorResult(typedErrorMessage(error, args.issue_id));
    }
  };
}

/**
 * Traduz erros da busca em mensagens claras (sem `issue_id`, que não se aplica).
 *
 * @param error - Erro capturado durante a busca.
 * @returns Mensagem a exibir no `isError`.
 */
function typedSearchErrorMessage(error: unknown): string {
  if (error instanceof core.RedmineAuthError) {
    return 'Falha de autenticação (401). Verifique a credencial em REDMINE_API_KEY.';
  }
  if (error instanceof core.RedmineForbiddenError) {
    return 'Acesso negado (403). A credencial não tem permissão para esta busca.';
  }
  return messageOf(error);
}

/** Monta os filtros estruturados a partir dos argumentos definidos da tool. */
function searchFiltersOf(args: SearchIssuesArgs): IssueSearchFilters {
  return {
    project_id: args.project_id,
    status_id: args.status_id,
    assigned_to_id: args.assigned_to_id,
    updated_on: args.updated_on,
  };
}

/**
 * Cria o handler da tool `search_issues`, testável isoladamente.
 *
 * Resolve a instância/credencial da env (nunca de argumentos), delega à
 * orquestração `fetchIssueSearch` (filtros + full-text best-effort) e devolve a
 * lista compacta em Markdown. A degradação da busca full-text NÃO é erro: o
 * aviso já vem embutido no payload retornado pelo core.
 *
 * @param deps - Ver {@link McpServerDeps}.
 * @returns Função assíncrona que recebe os argumentos e devolve um CallToolResult.
 * @example
 * const handler = createSearchIssuesHandler(defaultMcpDeps());
 * const result = await handler({ query: 'timeout', project_id: 5 });
 */
export function createSearchIssuesHandler(
  deps: McpServerDeps,
): (args: SearchIssuesArgs) => Promise<CallToolResult> {
  return async (args: SearchIssuesArgs): Promise<CallToolResult> => {
    const resolved = await resolveInstance(deps);
    if (!isResolved(resolved)) return resolved;
    const { baseUrl, apiKey } = resolved;

    try {
      const result = await deps.searchIssues({
        baseUrl,
        apiKey,
        filters: searchFiltersOf(args),
        query: args.query,
        limit: args.limit ?? SEARCH_DEFAULT_LIMIT,
      });
      // Degradação vira aviso no corpo (não isError); logamos para diagnóstico.
      if (result.degraded) deps.log?.(result.warnings.join(' '));
      return textResult(result.content);
    } catch (error) {
      return errorResult(typedSearchErrorMessage(error));
    }
  };
}

/**
 * Cria o handler da tool `get_last`, testável isoladamente.
 *
 * Resolve a instância/credencial da env (nunca de argumentos) e delega à
 * orquestração `fetchLastIssues`: ordena por `updated`/`created`/`priority` e
 * devolve o BUNDLE COMPLETO das mais recentes — o atalho de um passo para
 * "me dá a última issue", sem exigir que o cliente descubra o id antes.
 *
 * Usa `cacheFirst: true` como as demais tools: responde na hora com o texto de
 * anexo já cacheado e marca o restante como `processing`, sem bloquear no OCR.
 *
 * @param deps - Ver {@link McpServerDeps}.
 * @returns Função assíncrona que recebe os argumentos e devolve um CallToolResult.
 * @example
 * const handler = createGetLastHandler(defaultMcpDeps());
 * const result = await handler({ order: 'priority', count: 3 });
 */
export function createGetLastHandler(
  deps: McpServerDeps,
): (args: GetLastArgs) => Promise<CallToolResult> {
  return async (args: GetLastArgs): Promise<CallToolResult> => {
    const resolved = await resolveInstance(deps);
    if (!isResolved(resolved)) return resolved;
    const { baseUrl, apiKey } = resolved;

    const format: BundleFormat = args.format === 'json' ? 'json' : 'md';
    try {
      let content: string | undefined;
      for await (const event of deps.fetchLastIssues({
        baseUrl,
        apiKey,
        format,
        order: args.order,
        count: args.count,
        toolVersion: deps.toolVersion,
        insecure: deps.insecure ?? false,
        extractAttachments: args.extract_attachments ?? false,
        cacheFirst: true,
      })) {
        if (event.kind === 'progress') {
          deps.log?.(event.message);
        } else {
          content = event.value.content;
        }
      }
      if (content === undefined) {
        return errorResult('A operação não produziu um bundle.');
      }
      return textResult(content);
    } catch (error) {
      return errorResult(typedSearchErrorMessage(error));
    }
  };
}

/**
 * Traduz erros da extração de anexo em mensagens claras e tipadas.
 *
 * 404/403/401 do Redmine e o {@link core.AttachmentNotFoundError} recebem texto
 * orientado; os demais propagam a mensagem original. Nenhum resultado é cacheado
 * aqui — o erro é sempre recomputado por chamada (sem cache indevido).
 *
 * @param error - Erro capturado durante o fetch/extração.
 * @param issueId - Id da issue para compor a mensagem.
 * @param attachmentId - Id do anexo para compor a mensagem.
 * @returns A mensagem a ser exibida no `isError`.
 */
function typedAttachmentErrorMessage(error: unknown, issueId: number, attachmentId: number): string {
  if (error instanceof core.AttachmentNotFoundError) {
    return `Anexo #${attachmentId} não encontrado na issue #${issueId}. Verifique o id do anexo.`;
  }
  return typedErrorMessage(error, issueId);
}

/**
 * Renderiza o {@link AttachmentTextResult} como conteúdo MCP de sucesso.
 *
 * Com texto (`done`/`text`): devolve-o dentro da fence `<untrusted-content>` — é
 * conteúdo DERIVADO do anexo, logo não confiável (padrão do repo). Sem texto
 * (`pending`/`processing`/`skipped`/`unsupported`/`failed`): devolve `status` +
 * `reason`/`hint` legíveis — NUNCA um erro genérico; o `hint` é texto nosso
 * (ex.: como instalar o tesseract), fora da fence por ser confiável.
 *
 * @param result - Resultado da extração do anexo.
 * @returns CallToolResult de sucesso (não `isError`).
 */
function renderAttachmentText(result: AttachmentTextResult): CallToolResult {
  const { extraction } = result;
  if (typeof extraction.text === 'string' && extraction.text.trim() !== '') {
    return textResult(fenceBlock(extraction.text));
  }
  const lines = [`Anexo #${result.attachmentId}: extração ${extraction.status} (sem texto disponível).`];
  const reason = extraction.metadata?.['reason'];
  const hint = extraction.metadata?.['hint'];
  if (typeof reason === 'string') lines.push(`Motivo: ${reason}`);
  if (typeof hint === 'string') lines.push(hint);
  return textResult(lines.join('\n'));
}

/**
 * Cria o handler da tool `get_attachment_text`, testável isoladamente.
 *
 * Resolve a instância/credencial da env (nunca de argumentos), delega à
 * orquestração cache-first `fetchAttachmentText` (texto já cacheado volta na
 * hora; mídia pesada ainda não processada volta como `processing` SEM bloquear —
 * M4-11 #70) e devolve o texto extraído dentro da fence untrusted. Anexo não
 * processável / `processing` vira status legível (não `isError`); 403/404 do
 * Redmine e anexo inexistente viram `isError` tipado.
 *
 * @param deps - Ver {@link McpServerDeps}.
 * @returns Função assíncrona que recebe os argumentos e devolve um CallToolResult.
 * @example
 * const handler = createGetAttachmentTextHandler(defaultMcpDeps());
 * const result = await handler({ issue_id: 42, attachment_id: 77 });
 */
export function createGetAttachmentTextHandler(
  deps: McpServerDeps,
): (args: GetAttachmentTextArgs) => Promise<CallToolResult> {
  return async (args: GetAttachmentTextArgs): Promise<CallToolResult> => {
    const resolved = await resolveInstance(deps);
    if (!isResolved(resolved)) return resolved;
    const { baseUrl, apiKey } = resolved;

    try {
      const result = await deps.fetchAttachmentText({
        baseUrl,
        apiKey,
        issueId: args.issue_id,
        attachmentId: args.attachment_id,
        insecure: deps.insecure ?? false,
      });
      return renderAttachmentText(result);
    } catch (error) {
      return errorResult(typedAttachmentErrorMessage(error, args.issue_id, args.attachment_id));
    }
  };
}

/**
 * Constrói um {@link McpServer} com a tool `get_issue_context` registrada.
 *
 * A tool é read-only e não expõe URL/host — a instância vem sempre da env.
 *
 * @param deps - Ver {@link McpServerDeps}.
 * @returns O server pronto para `connect(transport)`.
 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: core.TOOL_NAME, version: deps.toolVersion });
  const handler = createGetIssueContextHandler(deps);
  const searchHandler = createSearchIssuesHandler(deps);
  const attachmentHandler = createGetAttachmentTextHandler(deps);
  const lastHandler = createGetLastHandler(deps);

  server.registerTool(
    TOOL_NAME,
    {
      title: 'Contexto de issue do Redmine',
      description:
        'Busca uma issue na instância Redmine configurada (REDMINE_URL) e retorna seu contexto completo empacotado. Read-only.',
      inputSchema: INPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => handler(args),
  );

  server.registerTool(
    SEARCH_TOOL_NAME,
    {
      title: 'Buscar issues no Redmine',
      description:
        'Busca issues na instância configurada (REDMINE_URL) por filtros estruturados (project_id, status_id, assigned_to_id, updated_on) e, opcionalmente, texto livre (query, best-effort via /search). Retorna uma lista compacta paginada. Read-only.',
      inputSchema: SEARCH_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => searchHandler(args),
  );

  server.registerTool(
    ATTACHMENT_TOOL_NAME,
    {
      title: 'Texto extraído de um anexo do Redmine',
      description:
        'Extrai (com cache) o texto de um anexo de uma issue na instância configurada (REDMINE_URL) e o retorna dentro de uma fence de conteúdo não confiável. Anexo não processável retorna o status/motivo legível (skipped/unsupported/failed), não um erro. Read-only.',
      inputSchema: ATTACHMENT_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => attachmentHandler(args),
  );

  server.registerTool(
    LAST_TOOL_NAME,
    {
      title: 'Últimas issues do Redmine',
      description:
        'Retorna o contexto completo das issues mais recentes da instância configurada (REDMINE_URL), ordenadas por updated (padrão), created ou priority. Atalho de um passo quando o id ainda não é conhecido — considera apenas issues abertas; use search_issues para filtros (projeto, status, responsável). Read-only.',
      inputSchema: LAST_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => lastHandler(args),
  );

  return server;
}

/** Constrói as dependências default apontando para o core e o processo reais. */
export function defaultMcpDeps(): McpServerDeps {
  return {
    fetchIssueBundle: core.fetchIssueBundle,
    searchIssues: core.fetchIssueSearch,
    fetchLastIssues: core.fetchLastIssues,
    fetchAttachmentText: core.fetchAttachmentTextCacheFirst,
    resolveApiKey: core.resolveApiKey,
    env: process.env,
    settings: core.defaultSettingsStore(),
    toolVersion: core.TOOL_VERSION,
    insecure: parseInsecure(process.env),
    // Diagnóstico SEMPRE em stderr: o stdout pertence ao protocolo stdio.
    log: (message: string) => void process.stderr.write(`${message}\n`),
  };
}

/* c8 ignore start -- wire de I/O (stdio transport); coberto pelo teste E2E real (#20). */
/**
 * Sobe o server MCP no transporte stdio e resolve quando a conexão fecha.
 *
 * O stdout é reservado ao protocolo; qualquer log vai para stderr.
 *
 * @param overrides - Dependências injetáveis (defaults via {@link defaultMcpDeps}).
 * @returns Promise que resolve quando o transporte encerra.
 */
export async function runStdioServer(overrides: Partial<McpServerDeps> = {}): Promise<void> {
  const deps: McpServerDeps = { ...defaultMcpDeps(), ...overrides };
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  deps.log?.('redmine-context MCP server pronto (stdio).');
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}
/* c8 ignore stop */

// Contrato de entrada das tools (nomes, tipos e schemas) — vive em `./tools.ts`
// desde a extração da RULES #24. Reexportado aqui para que os consumidores
// (CLI, testes) continuem tendo `./server.js` como porta única da superfície MCP.
export {
  ATTACHMENT_TOOL_NAME,
  LAST_TOOL_NAME,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_TOOL_NAME,
  TOOL_NAME,
  type GetAttachmentTextArgs,
  type GetIssueContextArgs,
  type GetLastArgs,
  type McpFormat,
  type SearchIssuesArgs,
} from './tools.js';
