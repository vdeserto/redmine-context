/**
 * Orquestração "últimas issues" — tool MCP `get_last` e comando CLI `last`.
 *
 * Função fina do core reutilizável pelas superfícies (CLI e MCP): lista as
 * issues mais recentes segundo uma ORDEM escolhida e devolve o BUNDLE COMPLETO
 * de cada uma — o atalho de um passo para "me dá a última issue", sem exigir
 * que o chamador descubra o id antes.
 *
 * Diferença para `fetchIssueSearch`: aquela responde "quais issues casam com
 * estes filtros?" com uma lista compacta; esta responde "qual é a mais recente?"
 * com o contexto inteiro (descrição, histórico, custom fields, anexos, relações).
 *
 * Ordem (parâmetro, com default):
 *  - `updated`  → `sort=updated_on:desc` (DEFAULT — "no que se mexeu por último")
 *  - `created`  → `sort=created_on:desc` ("o que entrou de novo", triagem)
 *  - `priority` → `sort=priority:desc,updated_on:desc` ("o que é mais urgente",
 *                 desempatando pela mais recente)
 *
 * ESCOPO: não passa `status_id`, então vale o default do Redmine em
 * `/issues.json` — apenas issues ABERTAS. Quem precisa de fechadas/filtros usa
 * `fetchIssueSearch`, que expõe `status_id` e os demais filtros estruturados.
 *
 * Mantém a fronteira do ADR-005: encapsula os módulos internos (`client`) e
 * reutiliza `fetchIssueBundle` para o empacotamento, sem duplicar a pipeline.
 */

import { createHttpClient, listIssues } from './client/index.js';
import type { QueryParams } from './client/index.js';
import type { CoreEvent, ProgressEvent, Result } from './contract.js';
import { fetchIssueBundle, type BundleFormat } from './fetch-issue-bundle.js';

/** Critério de ordenação aceito por {@link fetchLastIssues}. */
export type LastIssuesOrder = 'updated' | 'created' | 'priority';

/** Ordem usada quando a superfície não informa `order`. */
export const LAST_DEFAULT_ORDER: LastIssuesOrder = 'updated';

/** Quantidade default de issues: só a última. */
export const LAST_DEFAULT_COUNT = 1;

/**
 * Teto de issues por chamada. Baixo de propósito: cada item é um bundle
 * COMPLETO (histórico + anexos), então o custo em tokens/latência cresce rápido.
 * Quem quer uma visão ampla usa `fetchIssueSearch` (lista compacta).
 */
export const LAST_MAX_COUNT = 5;

/** Tradução ordem → parâmetro `sort` do `/issues.json`. */
const SORT_BY_ORDER: Record<LastIssuesOrder, string> = {
  updated: 'updated_on:desc',
  created: 'created_on:desc',
  // Desempate explícito: mesma prioridade → a mexida mais recente vem primeiro.
  priority: 'priority:desc,updated_on:desc',
};

/** Separador entre bundles Markdown consecutivos. */
const MARKDOWN_SEPARATOR = '\n\n---\n\n';

/** Conteúdo devolvido quando a instância não tem nenhuma issue aberta. */
const EMPTY_MARKDOWN = '_(nenhuma issue encontrada)_';

/** Opções de {@link fetchLastIssues}: credenciais já resolvidas + ordem + formato. */
export interface FetchLastIssuesOptions {
  /** URL base da instância Redmine (ex.: `https://redmine.example`). */
  baseUrl: string;
  /** api_key já resolvida pela cascata da superfície. */
  apiKey: string;
  /** Critério de ordenação. Default: {@link LAST_DEFAULT_ORDER}. */
  order?: LastIssuesOrder | undefined;
  /**
   * Quantas issues empacotar. Default: {@link LAST_DEFAULT_COUNT}. Valores fora
   * de `[1, LAST_MAX_COUNT]` são reduzidos ao intervalo (sem erro).
   */
  count?: number | undefined;
  /** Formato de saída de cada bundle. */
  format: BundleFormat;
  /** Versão da ferramenta gravada nos bundles. */
  toolVersion: string;
  /** Permite `http://` (sem TLS) com aviso ruidoso. Default: `false`. */
  insecure?: boolean | undefined;
  /** Extrai o texto (OCR) dos anexos e o embute nos bundles. Default: `false`. */
  extractAttachments?: boolean | undefined;
  /** Modo cache-first não-bloqueante (M4-11) repassado a `fetchIssueBundle`. */
  cacheFirst?: boolean | undefined;
  /** Raiz do cache em disco repassada a `fetchIssueBundle`. */
  cacheDir?: string | undefined;
}

/** Resultado final: bundles das últimas issues, prontos para stdout/CallToolResult. */
export interface LastIssuesResult {
  /** Ids empacotados, na ordem de saída (mais recente primeiro). */
  issueIds: number[];
  /** Ordem efetivamente aplicada (útil quando a superfície omitiu `order`). */
  order: LastIssuesOrder;
  /** Formato efetivo do conteúdo. */
  format: BundleFormat;
  /**
   * Bundles serializados. Em `md`, concatenados e separados por `---`. Em
   * `json`, SEMPRE um array JSON válido (inclusive com um único item ou nenhum)
   * — `get_last` devolve uma coleção, diferente de `fetchIssueBundle`, que
   * devolve o bundle de uma issue.
   */
  content: string;
}

/** Helper: constrói um evento de progresso tipado. */
function progress(stage: string, message: string): ProgressEvent {
  return { kind: 'progress', stage, message };
}

/** Reduz `count` ao intervalo `[1, LAST_MAX_COUNT]`. */
function clampCount(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count)) return LAST_DEFAULT_COUNT;
  return Math.min(Math.max(Math.trunc(count), 1), LAST_MAX_COUNT);
}

/**
 * Lista as issues mais recentes e empacota o bundle completo de cada uma.
 *
 * @param options - Ver {@link FetchLastIssuesOptions}.
 * @returns Sequência de {@link ProgressEvent} terminada por um {@link Result}
 *   com o {@link LastIssuesResult}.
 * @throws {RedmineAuthError} Em 401 (propagado do client).
 * @throws {RedmineHttpError} Em outros status ≥ 400.
 * @throws {Error} Em falha de rede/TLS/JSON inválido.
 * @example
 * for await (const event of fetchLastIssues({ ...creds, order: 'priority', format: 'md' })) {
 *   if (event.kind === 'result') process.stdout.write(event.value.content);
 * }
 */
export async function* fetchLastIssues(
  options: FetchLastIssuesOptions,
): AsyncIterable<CoreEvent<LastIssuesResult>> {
  const { baseUrl, apiKey, format, toolVersion, insecure = false } = options;
  const order = options.order ?? LAST_DEFAULT_ORDER;
  const count = clampCount(options.count);

  yield progress('connect', `Conectando a ${baseUrl}`);
  const http = createHttpClient({ baseUrl, apiKey, insecure });

  yield progress('list', `Listando as ${count} issue(s) mais recentes (ordem: ${order})`);
  const filters: QueryParams = { sort: SORT_BY_ORDER[order] };
  const payloads = await listIssues(http, { filters, pageSize: count, maxItems: count });
  const issueIds = payloads.map((payload) => payload.id);

  if (issueIds.length === 0) {
    const empty: Result<LastIssuesResult> = {
      kind: 'result',
      value: { issueIds, order, format, content: format === 'json' ? '[]' : EMPTY_MARKDOWN },
    };
    yield empty;
    return;
  }

  // Reuso da pipeline de bundle (uma issue por vez), repassando o progresso de
  // cada uma para a superfície — nada de duplicar get → normalize → bundle.
  const contents: string[] = [];
  for (const issueId of issueIds) {
    for await (const event of fetchIssueBundle({
      baseUrl,
      apiKey,
      issueId,
      format,
      toolVersion,
      insecure,
      extractAttachments: options.extractAttachments ?? false,
      ...(options.cacheFirst !== undefined ? { cacheFirst: options.cacheFirst } : {}),
      ...(options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {}),
    })) {
      if (event.kind === 'progress') {
        yield event;
      } else {
        contents.push(event.value.content);
      }
    }
  }

  const content = format === 'json' ? `[${contents.join(',')}]` : contents.join(MARKDOWN_SEPARATOR);
  const result: Result<LastIssuesResult> = {
    kind: 'result',
    value: { issueIds, order, format, content },
  };
  yield result;
}
