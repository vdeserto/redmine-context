/**
 * Orquestração de busca de issues para a tool `search_issues` (M1-13).
 *
 * Função fina do core reutilizável pela superfície MCP (#19): recebe credenciais
 * já resolvidas + filtros estruturados + termo full-text opcional e devolve uma
 * lista COMPACTA em Markdown (id, assunto fenced, status, responsável) — nunca o
 * bundle completo por item.
 *
 * Estratégia (best-effort no full-text):
 *  - Sem `query`: lista `/issues.json` só com os filtros estruturados.
 *  - Com `query`: busca `/search.json` para obter os ids que casam com o texto e
 *    então lista `/issues.json` restringindo por `issue_id` (interseção
 *    texto ∩ filtros). Se `/search` falhar (404/erro), DEGRADA para os filtros
 *    estruturados e adiciona um aviso ao payload — sem quebrar a tool.
 *
 * Mantém a fronteira do ADR-005: encapsula os módulos internos (`client`,
 * `bundle`) para que a superfície permaneça fina e sem acesso a URL/host.
 */

import { buildSearchListMarkdown, type SearchListItem } from './bundle/index.js';
import { createHttpClient, listIssues, searchIssues } from './client/index.js';
import type { QueryParams, RedmineIssuePayload } from './client/index.js';

/** Limite default de resultados quando a superfície não informa `limit`. */
export const SEARCH_DEFAULT_LIMIT = 25;

/**
 * Filtros estruturados aceitos por `/issues.json`. Os valores seguem os formatos
 * do Redmine (ex.: `status_id: 'open'`, `updated_on: '>=2026-01-01'`).
 */
export interface IssueSearchFilters {
  /** Filtro `project_id`. */
  project_id?: number | undefined;
  /** Filtro `status_id` (`'open'`, `'closed'`, `'*'` ou um id). */
  status_id?: number | string | undefined;
  /** Filtro `assigned_to_id` (um id ou `'me'`). */
  assigned_to_id?: number | string | undefined;
  /** Filtro `updated_on` no formato do Redmine (ex.: `>=2026-01-01`). */
  updated_on?: string | undefined;
}

/** Opções de {@link fetchIssueSearch}: credenciais + filtros + full-text. */
export interface FetchIssueSearchOptions {
  /** URL base da instância Redmine (ex.: `https://redmine.example`). */
  baseUrl: string;
  /** api_key já resolvida pela cascata da superfície. */
  apiKey: string;
  /** Filtros estruturados de `/issues.json` (ver {@link IssueSearchFilters}). */
  filters: IssueSearchFilters;
  /** Termo full-text opcional (`/search.json`, best-effort). */
  query?: string | undefined;
  /** Máximo de resultados. Default: {@link SEARCH_DEFAULT_LIMIT}. */
  limit?: number | undefined;
  /** Permite `http://` (sem TLS) com aviso ruidoso. Default: `false`. */
  insecure?: boolean | undefined;
}

/** Resultado da busca: markdown compacto + metadados de degradação. */
export interface IssueSearchResult {
  /** Lista compacta em Markdown pronta para o CallToolResult. */
  content: string;
  /** Número de itens retornados. */
  count: number;
  /** Avisos de degradação (ex.: `/search` indisponível). Vazio no caminho feliz. */
  warnings: string[];
  /** `true` quando o full-text foi solicitado mas degradou para os filtros. */
  degraded: boolean;
}

/** Placeholder para responsável ausente (issue sem `assigned_to`). */
const ABSENT_ASSIGNEE = '(nenhum)';
/** Placeholder para ref degradada/desconhecida (nome ausente). */
const UNKNOWN_REF = '(desconhecido)';

/** Extrai uma mensagem legível de um erro desconhecido. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Converte um valor desconhecido em objeto simples para acesso seguro. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Nome legível de uma ref `{ id, name }` bruta; ausência → `undefined`. */
function refName(value: unknown): string | undefined {
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  return typeof rec.name === 'string' ? rec.name : UNKNOWN_REF;
}

/** Monta os params de `/issues.json` a partir dos filtros definidos. */
function structuredParams(filters: IssueSearchFilters): QueryParams {
  const params: QueryParams = {};
  if (filters.project_id !== undefined) params.project_id = filters.project_id;
  if (filters.status_id !== undefined) params.status_id = filters.status_id;
  if (filters.assigned_to_id !== undefined) params.assigned_to_id = filters.assigned_to_id;
  if (filters.updated_on !== undefined) params.updated_on = filters.updated_on;
  return params;
}

/** Extrai a linha compacta (assunto/status/responsável) de um payload bruto. */
function toSearchListItem(payload: RedmineIssuePayload): SearchListItem {
  return {
    id: payload.id,
    subject: typeof payload.subject === 'string' ? payload.subject : null,
    status: refName(payload.status) ?? UNKNOWN_REF,
    assignee: refName(payload.assigned_to) ?? ABSENT_ASSIGNEE,
  };
}

/**
 * Busca issues combinando filtros estruturados e full-text best-effort.
 *
 * @param options - Ver {@link FetchIssueSearchOptions}.
 * @returns Lista compacta em Markdown + metadados de degradação.
 * @throws {RedmineAuthError} Em 401 (propagado do client).
 * @throws {RedmineForbiddenError} Em 403.
 * @throws {RedmineHttpError} Em outros status ≥ 400 de `/issues.json`.
 * @example
 * const res = await fetchIssueSearch({
 *   baseUrl, apiKey, filters: { project_id: 5 }, query: 'timeout', limit: 25,
 * });
 */
export async function fetchIssueSearch(options: FetchIssueSearchOptions): Promise<IssueSearchResult> {
  const { baseUrl, apiKey, filters, insecure = false } = options;
  const limit = options.limit ?? SEARCH_DEFAULT_LIMIT;
  const query = options.query?.trim();
  const http = createHttpClient({ baseUrl, apiKey, insecure });

  const warnings: string[] = [];
  let degraded = false;
  let payloads: RedmineIssuePayload[];

  if (query !== undefined && query.length > 0) {
    let hitIds: number[] | undefined;
    try {
      const page = await searchIssues(http, { query, limit });
      // Ids únicos preservando a ordem de relevância do /search.
      hitIds = [...new Set(page.hits.map((hit) => hit.id))];
    } catch (error) {
      // Degradação best-effort: /search indisponível não quebra a tool.
      degraded = true;
      warnings.push(
        `Busca full-text indisponível (${messageOf(error)}); exibindo apenas os filtros estruturados.`,
      );
    }

    if (hitIds !== undefined) {
      // Interseção texto ∩ filtros: restringe /issues.json pelos ids do /search.
      payloads =
        hitIds.length === 0
          ? []
          : await listIssues(http, {
              filters: { ...structuredParams(filters), issue_id: hitIds.join(',') },
              maxItems: limit,
            });
    } else {
      payloads = await listIssues(http, { filters: structuredParams(filters), maxItems: limit });
    }
  } else {
    payloads = await listIssues(http, { filters: structuredParams(filters), maxItems: limit });
  }

  const items = payloads.slice(0, limit).map(toSearchListItem);
  const content = buildSearchListMarkdown(items, { query, warnings });
  return { content, count: items.length, warnings, degraded };
}
