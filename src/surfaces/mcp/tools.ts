/**
 * Contrato de ENTRADA das tools MCP: nomes canônicos, tipos de argumentos e
 * schemas zod.
 *
 * Extraído de `./server.ts` (RULES #24 — arquivo não-teste perto de 700 linhas):
 * o server passa a conter apenas o comportamento (resolução de instância,
 * handlers e registro), enquanto a superfície declarativa — o que cada tool
 * aceita — vive aqui. Um só motivo para mudar cada arquivo.
 *
 * Segurança: nenhum schema aceita URL/host — a instância vem sempre da config do
 * processo (ver `resolveInstance` em `./server.ts`).
 */

import { z } from 'zod';

import * as core from '../../index.js';

/** Formato aceito pelas tools MCP (nomes amigáveis expostos ao cliente). */
export type McpFormat = 'markdown' | 'json';

/** Nome canônico da tool de contexto de issue. */
export const TOOL_NAME = 'get_issue_context';

/** Nome canônico da tool de busca de issues. */
export const SEARCH_TOOL_NAME = 'search_issues';

/** Nome canônico da tool de texto de anexo. */
export const ATTACHMENT_TOOL_NAME = 'get_attachment_text';

/** Nome canônico da tool das últimas issues. */
export const LAST_TOOL_NAME = 'get_last';

/** Limite default de resultados da tool `search_issues` (documentado no schema). */
export const SEARCH_DEFAULT_LIMIT = 25;

/** Teto de resultados aceito pela tool `search_issues`. */
const SEARCH_MAX_LIMIT = 100;

/** Argumentos da tool `get_issue_context` já validados pelo schema zod. */
export interface GetIssueContextArgs {
  /** Identificador numérico da issue no Redmine. */
  issue_id: number;
  /** Formato de saída: `markdown` (padrão) ou `json`. */
  format?: McpFormat | undefined;
  /**
   * Extrai o texto dos anexos de imagem (OCR) e o embute no bundle. Default:
   * `false` — a extração adiciona latência (download + OCR por anexo). O M4 trará
   * o modo cache-first/processing assíncrono; no M3 a extração é síncrona.
   */
  extract_attachments?: boolean | undefined;
}

/** Argumentos da tool `get_attachment_text` já validados pelo schema zod. */
export interface GetAttachmentTextArgs {
  /** Identificador numérico da issue que contém o anexo. */
  issue_id: number;
  /** Identificador numérico do anexo cujo texto será extraído. */
  attachment_id: number;
}

/** Argumentos da tool `search_issues` já validados pelo schema zod. */
export interface SearchIssuesArgs {
  /** Termo full-text opcional (`/search.json`, best-effort). */
  query?: string | undefined;
  /** Filtro `project_id`. */
  project_id?: number | undefined;
  /** Filtro `status_id` (`'open'`, `'closed'`, `'*'` ou um id). */
  status_id?: number | string | undefined;
  /** Filtro `assigned_to_id` (um id ou `'me'`). */
  assigned_to_id?: number | string | undefined;
  /** Filtro `updated_on` no formato do Redmine (ex.: `>=2026-01-01`). */
  updated_on?: string | undefined;
  /** Máximo de resultados. Default: {@link SEARCH_DEFAULT_LIMIT}. */
  limit?: number | undefined;
}

/** Argumentos da tool `get_last` já validados pelo schema zod. */
export interface GetLastArgs {
  /** Critério de ordenação. Default: `updated`. */
  order?: core.LastIssuesOrder | undefined;
  /** Quantas issues empacotar. Default: 1; teto {@link core.LAST_MAX_COUNT}. */
  count?: number | undefined;
  /** Formato de saída: `markdown` (padrão) ou `json`. */
  format?: McpFormat | undefined;
  /** Extrai o texto (OCR) dos anexos e o embute nos bundles. Default: `false`. */
  extract_attachments?: boolean | undefined;
}

/** Schema zod da tool `get_issue_context` (sem URL/host: a instância vem da env). */
export const INPUT_SCHEMA = {
  issue_id: z.number().int().positive().describe('Identificador numérico da issue no Redmine'),
  format: z
    .enum(['markdown', 'json'])
    .optional()
    .describe("Formato de saída: 'markdown' (padrão) ou 'json'"),
  extract_attachments: z
    .boolean()
    .optional()
    .describe(
      'Extrai o texto (OCR) dos anexos de imagem e o embute no bundle. Default: false (adiciona latência de download+OCR). O M4 traz o modo cache-first/processing.',
    ),
} as const;

/** Schema zod da tool `get_attachment_text` (read-only, sem URL/host). */
export const ATTACHMENT_INPUT_SCHEMA = {
  issue_id: z.number().int().positive().describe('Identificador numérico da issue que contém o anexo'),
  attachment_id: z.number().int().positive().describe('Identificador numérico do anexo a extrair'),
} as const;

/** Schema zod da tool `search_issues` (read-only, sem URL/host). */
export const SEARCH_INPUT_SCHEMA = {
  query: z
    .string()
    .min(1)
    .optional()
    .describe('Termo full-text via /search.json (best-effort). Se a busca falhar, degrada para os filtros estruturados com aviso.'),
  project_id: z.number().int().positive().optional().describe('Filtro estruturado project_id'),
  status_id: z
    .union([z.number().int(), z.string()])
    .optional()
    .describe("Filtro status_id: um id, 'open', 'closed' ou '*'"),
  assigned_to_id: z
    .union([z.number().int(), z.string()])
    .optional()
    .describe("Filtro assigned_to_id: um id ou 'me'"),
  updated_on: z
    .string()
    .optional()
    .describe('Filtro updated_on no formato do Redmine (ex.: >=2026-01-01, <=2026-12-31)'),
  limit: z
    .number()
    .int()
    .positive()
    .max(SEARCH_MAX_LIMIT)
    .optional()
    .describe(`Máximo de resultados paginados (default ${SEARCH_DEFAULT_LIMIT}, teto ${SEARCH_MAX_LIMIT})`),
} as const;

/** Schema zod da tool `get_last` (read-only, sem URL/host). */
export const LAST_INPUT_SCHEMA = {
  order: z
    .enum(['updated', 'created', 'priority'])
    .optional()
    .describe(
      `Critério de ordenação: 'updated' (padrão — mexida mais recente), 'created' (entrada mais recente) ou 'priority' (mais urgente, desempatando pela mais recente)`,
    ),
  count: z
    .number()
    .int()
    .positive()
    .max(core.LAST_MAX_COUNT)
    .optional()
    .describe(
      `Quantas issues empacotar (default ${core.LAST_DEFAULT_COUNT}, teto ${core.LAST_MAX_COUNT}). Cada item é um bundle COMPLETO — prefira search_issues para visões amplas.`,
    ),
  format: z
    .enum(['markdown', 'json'])
    .optional()
    .describe("Formato de saída: 'markdown' (padrão) ou 'json' (sempre um array)"),
  extract_attachments: z
    .boolean()
    .optional()
    .describe(
      'Extrai o texto (OCR) dos anexos de imagem e o embute nos bundles. Default: false (adiciona latência de download+OCR).',
    ),
} as const;
