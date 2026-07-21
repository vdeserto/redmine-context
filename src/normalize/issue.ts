/**
 * Normalização do payload bruto de issue (issue #11).
 *
 * Converte o {@link RedmineIssuePayload} devolvido por `getIssue`
 * (`/issues/{id}.json?include=journals,attachments`) no modelo estável
 * {@link Issue} do contrato. Escopo: NÚCLEO apenas — id, subject, description,
 * refs (project/tracker/status/priority/author/assigned_to), datas, journals e
 * attachments. Custom fields, relations, parent/children e watchers ficam para
 * a issue #12: aqui saem como coleções vazias / ausências explícitas.
 *
 * Parsing 100% defensivo (estilo `src/client/issues.ts`): payload parcial ou
 * malformado NUNCA lança — cada campo degrada para um default estável.
 */

import type { RedmineIssuePayload } from '../client/issues.js';
import type {
  Attachment,
  Issue,
  Journal,
  JournalDetail,
  RedmineRef,
} from '../contract.js';

/** Ref placeholder para campos obrigatórios do contrato ausentes no payload. */
const NULL_REF: RedmineRef = { id: 0, name: '' };

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

/** Devolve o array bruto, ou `[]` quando o valor não é um array. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `string` quando o valor é textual, senão `undefined`. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** `number` quando o valor é numérico, senão `undefined`. */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Preserva `string`/`null` de details brutos; tipos inesperados viram `null`. */
function asStringOrNull(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : null;
}

/** Type guard para remover `undefined` após um `map` defensivo. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Normaliza uma ref nomeada do Redmine (`{ id, name }`).
 *
 * @param value - Valor bruto (objeto esperado).
 * @returns A ref quando há `id` numérico; senão `undefined`. `name` não-string
 *   degrada para `""`.
 */
function normalizeRef(value: unknown): RedmineRef | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const id = asNumber(record.id);
  if (id === undefined) return undefined;
  return { id, name: asString(record.name) ?? '' };
}

/** Ref obrigatória do contrato: cai para {@link NULL_REF} se ausente/inválida. */
function requireRef(value: unknown): RedmineRef {
  return normalizeRef(value) ?? NULL_REF;
}

/**
 * Normaliza um detalhe bruto de journal, preservando o histórico sem interpretar.
 *
 * @param value - Item bruto de `journal.details[]`.
 * @returns O detalhe normalizado, ou `undefined` se não for um objeto.
 */
function normalizeJournalDetail(value: unknown): JournalDetail | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const detail: JournalDetail = {
    property: asString(record.property) ?? '',
    name: asString(record.name) ?? '',
  };
  if ('old_value' in record) detail.old_value = asStringOrNull(record.old_value);
  if ('new_value' in record) detail.new_value = asStringOrNull(record.new_value);
  return detail;
}

/**
 * Normaliza uma entrada de journal (nota opcional + `details[]` brutos).
 *
 * @param value - Item bruto de `issue.journals[]`.
 * @returns O journal normalizado, ou `undefined` se não tiver `id` numérico.
 */
function normalizeJournal(value: unknown): Journal | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const id = asNumber(record.id);
  if (id === undefined) return undefined;

  const journal: Journal = {
    id,
    created_on: asString(record.created_on) ?? '',
    details: asArray(record.details).map(normalizeJournalDetail).filter(isDefined),
  };
  // notes só é significativa quando não-vazia (Redmine devolve "" em journal de detalhe).
  const notes = asString(record.notes);
  if (notes !== undefined && notes !== '') journal.notes = notes;
  const user = normalizeRef(record.user);
  if (user !== undefined) journal.user = user;
  return journal;
}

/**
 * Normaliza um anexo, mantendo `content_type`/`digest` quando presentes.
 *
 * @param value - Item bruto de `issue.attachments[]`.
 * @returns O anexo normalizado, ou `undefined` se não tiver `id` numérico.
 */
function normalizeAttachment(value: unknown): Attachment | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const id = asNumber(record.id);
  if (id === undefined) return undefined;

  const attachment: Attachment = {
    id,
    filename: asString(record.filename) ?? '',
    filesize: asNumber(record.filesize) ?? 0,
    created_on: asString(record.created_on) ?? '',
    content_url: asString(record.content_url) ?? '',
  };
  const contentType = asString(record.content_type);
  if (contentType !== undefined) attachment.content_type = contentType;
  const description = asString(record.description);
  if (description !== undefined && description !== '') attachment.description = description;
  const author = normalizeRef(record.author);
  if (author !== undefined) attachment.author = author;
  const digest = asString(record.digest);
  if (digest !== undefined) attachment.digest = digest;
  return attachment;
}

/**
 * Normaliza o payload bruto de uma issue no modelo {@link Issue} do contrato.
 *
 * Escopo issue #11 (núcleo): id, subject, description, refs, datas, journals e
 * attachments. Campos da issue #12 (custom_fields, relations, parent/children,
 * watchers) saem vazios/ausentes. Nunca lança: payload parcial/malformado
 * degrada campo a campo para defaults estáveis.
 *
 * @param payload - Payload bruto de `getIssue`.
 * @returns A issue normalizada, sempre válida perante o contrato.
 * @example
 * const issue = normalizeIssue(await getIssue(http, 100));
 */
export function normalizeIssue(payload: RedmineIssuePayload): Issue {
  const record = asRecord(payload) ?? {};

  const issue: Issue = {
    id: asNumber(record.id) ?? 0,
    subject: asString(record.subject) ?? '',
    project: requireRef(record.project),
    tracker: requireRef(record.tracker),
    status: requireRef(record.status),
    priority: requireRef(record.priority),
    author: requireRef(record.author),
    created_on: asString(record.created_on) ?? '',
    updated_on: asString(record.updated_on) ?? '',
    journals: asArray(record.journals).map(normalizeJournal).filter(isDefined),
    attachments: asArray(record.attachments).map(normalizeAttachment).filter(isDefined),
    // Escopo issue #12: preenchidos noutra camada.
    custom_fields: [],
    relations: [],
    children: [],
  };

  const description = asString(record.description);
  if (description !== undefined && description !== '') issue.description = description;
  const assignedTo = normalizeRef(record.assigned_to);
  if (assignedTo !== undefined) issue.assigned_to = assignedTo;

  return issue;
}
