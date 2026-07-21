/**
 * Superfície MCP (stdio) do `redmine-context` (M1-12).
 *
 * Expõe a tool read-only `get_issue_context(issue_id, format?)`, que reutiliza a
 * orquestração `fetchIssueBundle` do core. Segue a mesma fronteira da CLI
 * (ADR-005): importa o core EXCLUSIVAMENTE por `../../index.js`; nenhum módulo
 * interno é acessado diretamente (regra eslint `no-restricted-imports`).
 *
 * Segurança: NENHUMA tool aceita URL/host arbitrário — a instância vem sempre da
 * config/env do processo (`REDMINE_URL` + cascata de credencial). No transporte
 * stdio o protocolo ocupa o stdout, portanto todo diagnóstico vai para stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import * as core from '../../index.js';
import type { BundleFormat, resolveApiKey } from '../../index.js';

/** Formato aceito pela tool MCP (nomes amigáveis expostos ao cliente). */
export type McpFormat = 'markdown' | 'json';

/** Argumentos da tool `get_issue_context` já validados pelo schema zod. */
export interface GetIssueContextArgs {
  /** Identificador numérico da issue no Redmine. */
  issue_id: number;
  /** Formato de saída: `markdown` (padrão) ou `json`. */
  format?: McpFormat | undefined;
}

/**
 * Dependências injetáveis do server MCP — permitem testar o handler sem tocar o
 * processo real nem a rede. Os defaults (ver {@link defaultMcpDeps}) apontam para
 * o core e o `process.env` reais.
 */
export interface McpServerDeps {
  /** Orquestração get → normalize → bundle do core. */
  fetchIssueBundle: typeof core.fetchIssueBundle;
  /** Resolução de credencial pela cascata (arquivo → env). */
  resolveApiKey: typeof resolveApiKey;
  /** Ambiente consultado para `REDMINE_URL` e pela cascata de credencial. */
  env: NodeJS.ProcessEnv;
  /** Versão da ferramenta gravada no bundle. */
  toolVersion: string;
  /** Sink de diagnóstico (progresso/erros) — SEMPRE stderr no stdio transport. */
  log?: (message: string) => void;
}

/** Nome canônico da tool exposta pelo server. */
export const TOOL_NAME = 'get_issue_context';

/** Schema zod dos argumentos da tool (sem URL/host: a instância vem da env). */
const INPUT_SCHEMA = {
  issue_id: z.number().int().positive().describe('Identificador numérico da issue no Redmine'),
  format: z
    .enum(['markdown', 'json'])
    .optional()
    .describe("Formato de saída: 'markdown' (padrão) ou 'json'"),
} as const;

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
    const baseUrl = deps.env.REDMINE_URL;
    if (baseUrl === undefined || baseUrl.length === 0) {
      return errorResult('Instância não configurada. Defina REDMINE_URL no ambiente do processo.');
    }

    let apiKey: string | undefined;
    try {
      apiKey = await deps.resolveApiKey(baseUrl, { env: deps.env });
    } catch (error) {
      return errorResult(messageOf(error));
    }
    if (apiKey === undefined || apiKey.length === 0) {
      return errorResult(
        `Nenhuma credencial encontrada para ${baseUrl}. Configure REDMINE_API_KEY (ou o arquivo de credenciais via 'redmine-context login').`,
      );
    }

    const format: BundleFormat = args.format === 'json' ? 'json' : 'md';
    try {
      let content: string | undefined;
      for await (const event of deps.fetchIssueBundle({
        baseUrl,
        apiKey,
        issueId: args.issue_id,
        format,
        toolVersion: deps.toolVersion,
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

  return server;
}

/** Constrói as dependências default apontando para o core e o processo reais. */
export function defaultMcpDeps(): McpServerDeps {
  return {
    fetchIssueBundle: core.fetchIssueBundle,
    resolveApiKey: core.resolveApiKey,
    env: process.env,
    toolVersion: core.TOOL_VERSION,
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
