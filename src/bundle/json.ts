/**
 * Bundle JSON determinístico de uma issue normalizada (issue #15, ADR-005).
 *
 * Converte uma {@link Issue} do contrato num corpo canônico byte-idêntico entre
 * execuções do mesmo estado, próprio para consumo por LLMs. Três invariantes:
 *
 * 1. Determinismo: coleções recebem ordenação estável DECLARADA (journals por
 *    `(created_on, id)`; attachments/relations/custom_fields/children por `id`) e
 *    as chaves de objeto são ordenadas pelo serializador ({@link stableStringify}).
 * 2. `generated_at` FORA do corpo canônico: vive no envelope separado, para que
 *    dois bundles do mesmo estado sejam idênticos. O chamador (CLI, #17) decide
 *    como unir corpo e envelope.
 * 3. Anti prompt-injection: conteúdo textual derivado do Redmine (descrição, notas
 *    de journal, valores de custom field) é marcado `untrusted: true` (ADR-005).
 *
 * Follow-up da review da #11: refs degradadas — o `NULL_REF` congelado do
 * normalize, com `id === 0` — NÃO são renderizadas como valores válidos; emitem
 * `null` explícito, evitando que um placeholder vaze como referência real.
 */

import type {
  Attachment,
  CustomField,
  Issue,
  IssueChild,
  IssueRelation,
  Journal,
  JournalDetail,
  RedmineRef,
} from '../contract.js';
import { stableStringify, type JsonValue } from './stable-stringify.js';

/** Versão do schema do bundle — congelada em "1.0" para esta major. */
const SCHEMA_VERSION = '1.0' as const;

/** Metadados do empacotamento fornecidos pela superfície chamadora. */
export interface JsonBundleMeta {
  /** Base URL do Redmine de origem (compõe o envelope `source`). */
  baseUrl: string;
  /** Versão da ferramenta (`TOOL_VERSION`), gravada no corpo canônico. */
  toolVersion: string;
  /**
   * Timestamp ISO do empacotamento. Injetável para testes/reprodutibilidade;
   * quando omitido, usa o relógio do sistema. NUNCA entra no corpo canônico.
   */
  generatedAt?: string;
}

/** Proveniência da issue empacotada. */
export interface JsonBundleSource {
  base_url: string;
  issue_id: number;
  issue_updated_on: string;
}

/** Envelope não-canônico: carrega o que varia entre execuções (`generated_at`). */
export interface JsonBundleEnvelope {
  generated_at: string;
  source: JsonBundleSource;
}

/** Resultado do empacotamento: corpo canônico (string) + envelope (objeto). */
export interface JsonBundle {
  /** Corpo canônico serializado — determinístico e byte-idêntico por estado. */
  canonical: string;
  /** Envelope separado; o chamador decide como unir ao corpo. */
  envelope: JsonBundleEnvelope;
}

/** Envolve um conteúdo não-confiável do Redmine com a marca `untrusted: true`. */
function untrusted(value: JsonValue): JsonValue {
  return { untrusted: true, value };
}

/**
 * Renderiza uma ref obrigatória do contrato.
 *
 * Refs degradadas (`id === 0`, o `NULL_REF` do normalize) viram `null` — nunca
 * são emitidas como `{ id: 0, name: '' }`, que aparentaria uma referência válida.
 *
 * @param ref - Ref do contrato (possivelmente o placeholder degradado).
 * @returns `{ id, name }` para refs reais; `null` para o placeholder.
 */
function renderRef(ref: RedmineRef): JsonValue {
  if (ref.id === 0) return null;
  return { id: ref.id, name: ref.name };
}

/** Renderiza uma ref opcional; ausência vira `null` (mesmo canal que degradação). */
function renderOptionalRef(ref: RedmineRef | undefined): JsonValue {
  return ref === undefined ? null : renderRef(ref);
}

/** Detalhe bruto de journal — histórico estruturado, repassado sem interpretação. */
function renderDetail(detail: JournalDetail): JsonValue {
  const out: { [key: string]: JsonValue } = {
    property: detail.property,
    // `name` fica estrutural: vocabulário fixo em property=attr e id em
    // property=cf — é chave programática do status history.
    name: detail.name,
  };
  // old/new_value carregam texto derivado (ex.: descrição inteira em
  // details de "description") — mesma categoria de confiança de notes.
  if ('old_value' in detail) {
    out.old_value = detail.old_value === null || detail.old_value === undefined ? null : untrusted(detail.old_value);
  }
  if ('new_value' in detail) {
    out.new_value = detail.new_value === null || detail.new_value === undefined ? null : untrusted(detail.new_value);
  }
  return out;
}

/** Renderiza um journal; a nota livre (se houver) é marcada `untrusted`. */
function renderJournal(journal: Journal): JsonValue {
  const out: { [key: string]: JsonValue } = {
    id: journal.id,
    created_on: journal.created_on,
    user: renderOptionalRef(journal.user),
    details: journal.details.map(renderDetail),
  };
  if (journal.notes !== undefined) out.notes = untrusted(journal.notes);
  return out;
}

/** Renderiza um custom field; o `value` (texto do Redmine) é marcado `untrusted`. */
function renderCustomField(field: CustomField): JsonValue {
  const out: { [key: string]: JsonValue } = {
    id: field.id,
    name: field.name,
    value: untrusted(field.value),
    raw_value: field.raw_value,
  };
  if (field.field_format !== undefined) out.field_format = field.field_format;
  return out;
}

/** Renderiza um anexo (metadados; conteúdo binário é extraído fora do bundle). */
function renderAttachment(att: Attachment): JsonValue {
  const out: { [key: string]: JsonValue } = {
    id: att.id,
    filename: att.filename,
    filesize: att.filesize,
    created_on: att.created_on,
    content_url: att.content_url,
  };
  if (att.content_type !== undefined) out.content_type = att.content_type;
  if (att.description !== undefined) out.description = untrusted(att.description);
  if (att.author !== undefined) out.author = renderOptionalRef(att.author);
  if (att.digest !== undefined) out.digest = att.digest;
  return out;
}

/** Renderiza uma relação entre issues. */
function renderRelation(rel: IssueRelation): JsonValue {
  return {
    id: rel.id,
    issue_id: rel.issue_id,
    issue_to_id: rel.issue_to_id,
    relation_type: rel.relation_type,
    delay: rel.delay ?? null,
  };
}

/** Renderiza uma issue-filha. */
function renderChild(child: IssueChild): JsonValue {
  const out: { [key: string]: JsonValue } = { id: child.id };
  if (child.tracker !== undefined) out.tracker = renderOptionalRef(child.tracker);
  if (child.subject !== undefined) out.subject = untrusted(child.subject);
  return out;
}

/**
 * Comparador estável de journals: `created_on` e, em empate, `id`.
 *
 * Exportado para que o bundle Markdown (#16) reutilize EXATAMENTE a mesma
 * ordenação cronológica do JSON, sem duplicar a regra de desempate.
 */
export function compareJournals(a: Journal, b: Journal): number {
  if (a.created_on < b.created_on) return -1;
  if (a.created_on > b.created_on) return 1;
  return a.id - b.id;
}

/**
 * Ordena por `id` sem mutar o array de entrada.
 *
 * Exportado para reuso pelo bundle Markdown (#16): attachments, relations,
 * custom_fields e children compartilham a MESMA ordenação estável do JSON.
 */
export function byId<T extends { id: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.id - b.id);
}

/**
 * Monta o corpo da issue já ordenado e com marcações `untrusted`.
 *
 * @param issue - Issue normalizada do contrato.
 * @returns Objeto JSON pronto para serialização estável.
 */
function renderIssue(issue: Issue): JsonValue {
  const out: { [key: string]: JsonValue } = {
    id: issue.id,
    subject: untrusted(issue.subject),
    description: issue.description === undefined ? null : untrusted(issue.description),
    project: renderRef(issue.project),
    tracker: renderRef(issue.tracker),
    status: renderRef(issue.status),
    priority: renderRef(issue.priority),
    author: renderRef(issue.author),
    created_on: issue.created_on,
    updated_on: issue.updated_on,
    custom_fields: byId(issue.custom_fields).map(renderCustomField),
    journals: [...issue.journals].sort(compareJournals).map(renderJournal),
    attachments: byId(issue.attachments).map(renderAttachment),
    relations: byId(issue.relations).map(renderRelation),
    children: byId(issue.children).map(renderChild),
  };
  if (issue.assigned_to !== undefined) out.assigned_to = renderOptionalRef(issue.assigned_to);
  if (issue.done_ratio !== undefined) out.done_ratio = issue.done_ratio;
  if (issue.start_date !== undefined) out.start_date = issue.start_date;
  if (issue.due_date !== undefined) out.due_date = issue.due_date;
  if (issue.parent !== undefined) out.parent = { id: issue.parent.id };
  if (issue.watchers !== undefined) out.watchers = byId(issue.watchers).map(renderRef);
  return out;
}

/**
 * Empacota uma issue normalizada num bundle JSON determinístico.
 *
 * O corpo canônico é byte-idêntico entre execuções do mesmo estado (ordenação
 * estável + serializador de chaves ordenadas). `generated_at` fica no envelope,
 * fora do corpo, preservando essa propriedade.
 *
 * @param issue - Issue normalizada (ver `src/normalize`).
 * @param meta - Metadados do empacotamento (base URL, versão, timestamp opcional).
 * @returns Corpo canônico serializado e envelope com `generated_at` + `source`.
 * @example
 * const { canonical, envelope } = buildJsonBundle(issue, {
 *   baseUrl: 'https://redmine.example',
 *   toolVersion: TOOL_VERSION,
 * });
 */
export function buildJsonBundle(issue: Issue, meta: JsonBundleMeta): JsonBundle {
  const source: JsonBundleSource = {
    base_url: meta.baseUrl,
    issue_id: issue.id,
    issue_updated_on: issue.updated_on,
  };

  const body: JsonValue = {
    schema_version: SCHEMA_VERSION,
    tool_version: meta.toolVersion,
    source: { ...source },
    issue: renderIssue(issue),
  };

  return {
    canonical: stableStringify(body),
    envelope: {
      generated_at: meta.generatedAt ?? new Date().toISOString(),
      source,
    },
  };
}
