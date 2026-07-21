/**
 * Operações de leitura de issues sobre o {@link HttpClient} do M1.
 *
 * Escopo (issue #9): apenas `getIssue` e `listIssues`. Sem retry/backoff
 * (issue #10) e SEM normalização (issue #11) — o payload é devolvido bruto,
 * tipado de forma rasa. A normalização para o modelo {@link Issue} do contrato
 * acontece em outra camada.
 */

import type { HttpClient, QueryParams } from './http.js';

/**
 * Payload bruto de uma issue, exatamente como a API do Redmine devolve.
 * Tipo raso e intencionalmente permissivo: só garante `id`; os demais campos
 * (subject, journals, attachments, custom_fields, ...) ficam sob a assinatura
 * de índice e serão interpretados na normalização (issue #11).
 */
export interface RedmineIssuePayload {
  id: number;
  [key: string]: unknown;
}

/** Include padrão do detalhe de issue (ADR-005): histórico e coleções aninhadas. */
const ISSUE_INCLUDE = 'journals,attachments,relations,children';

/** Teto de itens por página imposto pelo Redmine ao parâmetro `limit`. */
const REDMINE_MAX_LIMIT = 100;

/** Opções de {@link listIssues}: filtros de query + controle de paginação. */
export interface ListIssuesOptions {
  /**
   * Filtros repassados ao endpoint `/issues.json` (ex.: `{ project_id: 5,
   * status_id: 'open' }`). São enviados junto de `offset`/`limit` em cada página.
   */
  filters?: QueryParams;
  /**
   * Itens por página (parâmetro `limit`). Default e teto: {@link REDMINE_MAX_LIMIT}.
   * Valores acima do teto são reduzidos silenciosamente para 100.
   */
  pageSize?: number;
  /**
   * Máximo de itens a acumular no total. Ausente = esgota toda a coleção
   * (respeitando `total_count`). Também reduz o `limit` da última página para
   * não buscar além do necessário.
   */
  maxItems?: number;
}

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

/**
 * Busca o detalhe completo de uma issue com todas as coleções aninhadas.
 *
 * Usa `include=journals,attachments,relations,children` e devolve o payload
 * BRUTO (sem normalizar). A resposta do Redmine tem o formato `{ issue: {...} }`;
 * o objeto interno é retornado tipado como {@link RedmineIssuePayload}.
 *
 * @param http - Client HTTP autenticado (ver {@link HttpClient}).
 * @param id - Identificador da issue.
 * @returns O payload bruto da issue.
 * @throws {Error} Se a resposta não contiver a chave `issue`.
 * @throws {RedmineHttpError} Propagado pelo client em respostas ≥ 400.
 * @example
 * const issue = await getIssue(http, 100);
 */
export async function getIssue(http: HttpClient, id: number): Promise<RedmineIssuePayload> {
  const raw = await http.get(`/issues/${id}.json`, { include: ISSUE_INCLUDE });
  const body = asRecord(raw);
  const issue = body === undefined ? undefined : asRecord(body.issue);
  if (issue === undefined) {
    throw new Error(`Resposta de /issues/${id}.json não contém a chave "issue".`);
  }
  return issue as RedmineIssuePayload;
}

/** Extrai `issues[]` e `total_count` de uma página de `/issues.json`. */
function parsePage(raw: unknown): { issues: RedmineIssuePayload[]; totalCount: number } {
  const body = asRecord(raw);
  const issues = body?.issues;
  if (!Array.isArray(issues)) {
    throw new Error('Resposta de /issues.json não contém o array "issues".');
  }
  // total_count pode faltar em respostas inesperadas: assume o tamanho da página.
  const totalCount = typeof body?.total_count === 'number' ? body.total_count : issues.length;
  return { issues: issues as RedmineIssuePayload[], totalCount };
}

/**
 * Lista issues paginando `/issues.json` via `offset`/`limit` até esgotar a
 * coleção (respeitando `total_count`) ou atingir `maxItems`.
 *
 * Cada página respeita o teto de {@link REDMINE_MAX_LIMIT} do Redmine. Quando
 * `maxItems` está definido, o `limit` da última página é reduzido para não
 * buscar itens além do necessário. Sem retry (issue #10).
 *
 * @param http - Client HTTP autenticado (ver {@link HttpClient}).
 * @param options - Filtros e controle de paginação (ver {@link ListIssuesOptions}).
 * @returns Array acumulado com os payloads brutos das issues.
 * @throws {Error} Se alguma página não trouxer o array `issues`.
 * @throws {RedmineHttpError} Propagado pelo client em respostas ≥ 400.
 * @example
 * const all = await listIssues(http, { filters: { project_id: 5 }, maxItems: 500 });
 */
export async function listIssues(
  http: HttpClient,
  options: ListIssuesOptions = {},
): Promise<RedmineIssuePayload[]> {
  const { filters = {}, maxItems } = options;
  const pageSize = Math.min(options.pageSize ?? REDMINE_MAX_LIMIT, REDMINE_MAX_LIMIT);

  const acc: RedmineIssuePayload[] = [];
  let offset = 0;

  for (;;) {
    // Reduz o limit da última página quando maxItems se aproxima do total.
    const remaining = maxItems === undefined ? pageSize : Math.min(pageSize, maxItems - acc.length);
    if (remaining <= 0) {
      break;
    }

    const params: QueryParams = { ...filters, offset, limit: remaining };
    const { issues, totalCount } = parsePage(await http.get('/issues.json', params));

    acc.push(...issues);
    offset += issues.length;

    // Para em página vazia (guarda contra loop infinito) ou ao esgotar a coleção.
    if (issues.length === 0 || offset >= totalCount) {
      break;
    }
    if (maxItems !== undefined && acc.length >= maxItems) {
      break;
    }
  }

  return acc;
}
