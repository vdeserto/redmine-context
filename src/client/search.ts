/**
 * Busca full-text de issues via `/search.json` (M1-13).
 *
 * Camada baixa sobre o {@link HttpClient} do M1: dispara `GET /search.json` com o
 * termo `q` restrito a issues (`issues=1`) e devolve os acertos de forma rasa
 * (id/título/tipo/url), SEM normalizar. É best-effort por natureza — um Redmine
 * sem o módulo de busca responde 404; o orquestrador ({@link fetchIssueSearch})
 * captura a falha e degrada para os filtros estruturados.
 *
 * Nunca recebe URL/host: o {@link HttpClient} já carrega a instância/credencial.
 */

import type { HttpClient, QueryParams } from './http.js';

/** Opções da busca full-text sobre `/search.json`. */
export interface SearchIssuesOptions {
  /** Termo de busca (`q`). Deve ser não vazio (validado na superfície). */
  query: string;
  /** Deslocamento de paginação (`offset`). Default: `0`. */
  offset?: number;
  /** Itens por página (`limit`). Default e teto: {@link SEARCH_MAX_LIMIT}. */
  limit?: number;
}

/** Acerto raso de `/search.json` já filtrado para o tipo `issue`. */
export interface RedmineSearchHit {
  /** Id da issue correspondente ao acerto. */
  id: number;
  /** Título do acerto como a API devolve (ex.: `Bug #12: assunto`). */
  title: string;
  /** Tipo do acerto (`issue`, `issue-closed`, ...). */
  type: string;
  /** URL do acerto na instância Redmine. */
  url: string;
}

/** Página de resultados de `/search.json`: acertos + total reportado. */
export interface SearchIssuesPage {
  /** Acertos do tipo issue, na ordem devolvida pela API. */
  hits: RedmineSearchHit[];
  /** `total_count` reportado (ou o tamanho da página se ausente). */
  totalCount: number;
}

/** Teto de itens por página imposto ao parâmetro `limit` de `/search.json`. */
export const SEARCH_MAX_LIMIT = 100;

/**
 * Converte um valor desconhecido em `Record<string, unknown>` para acesso seguro.
 *
 * @param value - Valor a inspecionar.
 * @returns O objeto tipado, ou `undefined` se não for um objeto simples.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Extrai um acerto do array `results`, aceitando apenas os do tipo `issue*`. */
function parseHit(entry: unknown): RedmineSearchHit | undefined {
  const rec = asRecord(entry);
  if (rec === undefined) return undefined;
  const { id, type } = rec;
  // Reason: o /search.json mistura tipos (issue, wiki-page, ...); só issues nos
  // interessam. Redmine varia entre `issue` e `issue-closed` — casamos o prefixo.
  if (typeof id !== 'number' || typeof type !== 'string' || !type.startsWith('issue')) {
    return undefined;
  }
  return {
    id,
    type,
    title: typeof rec.title === 'string' ? rec.title : '',
    url: typeof rec.url === 'string' ? rec.url : '',
  };
}

/**
 * Busca issues por texto livre em `/search.json`, restrito a issues.
 *
 * Devolve apenas os acertos do tipo issue (ids reutilizáveis como filtro
 * `issue_id` em `/issues.json`). Não retenta e não normaliza — propaga os erros
 * tipados do {@link HttpClient} (ex.: 404 quando a busca está indisponível) para
 * o chamador decidir a degradação.
 *
 * @param http - Client HTTP autenticado (ver {@link HttpClient}).
 * @param options - Termo e paginação (ver {@link SearchIssuesOptions}).
 * @returns Página com os acertos de issue e o `total_count` reportado.
 * @throws {Error} Se a resposta não contiver o array `results`.
 * @throws {RedmineHttpError} Propagado pelo client em respostas ≥ 400.
 * @example
 * const page = await searchIssues(http, { query: 'timeout', limit: 25 });
 */
export async function searchIssues(
  http: HttpClient,
  options: SearchIssuesOptions,
): Promise<SearchIssuesPage> {
  const limit = Math.min(options.limit ?? SEARCH_MAX_LIMIT, SEARCH_MAX_LIMIT);
  const params: QueryParams = {
    q: options.query,
    issues: 1,
    limit,
    offset: options.offset ?? 0,
  };

  const body = asRecord(await http.get('/search.json', params));
  const results = body?.results;
  if (!Array.isArray(results)) {
    throw new Error('Resposta de /search.json não contém o array "results".');
  }

  const hits: RedmineSearchHit[] = [];
  for (const entry of results) {
    const hit = parseHit(entry);
    if (hit !== undefined) hits.push(hit);
  }
  const totalCount = typeof body?.total_count === 'number' ? body.total_count : hits.length;
  return { hits, totalCount };
}
