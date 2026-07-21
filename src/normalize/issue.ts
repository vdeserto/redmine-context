/**
 * Normalização do payload bruto de issue (issues #11/#12).
 *
 * Converte o {@link RedmineIssuePayload} devolvido por `getIssue`
 * (`/issues/{id}.json?include=journals,attachments,relations,children`) no modelo
 * estável {@link Issue} do contrato. Cobre o núcleo (#11) — id, subject,
 * description, refs, datas, journals e attachments — e as coleções aninhadas
 * (#12) delegadas a `./collections.js`: custom_fields, relations, parent/children
 * e watchers.
 *
 * Parsing 100% defensivo (estilo `src/client/issues.ts`): payload parcial ou
 * malformado NUNCA lança — cada campo degrada para um default estável.
 */

import type { RedmineIssuePayload } from '../client/issues.js';
import type { Attachment, Issue, Journal, JournalDetail, RedmineRef } from '../contract.js';
import {
  normalizeChildren,
  normalizeCustomFields,
  normalizeParent,
  normalizeRelations,
  normalizeWatchers,
} from './collections.js';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  asStringOrNull,
  isDefined,
  normalizeRef,
} from './helpers.js';

/** Ref placeholder para campos obrigatórios do contrato ausentes no payload. */
// Congelado: instância compartilhada entre todas as issues degradadas — mutação
// acidental corromperia o placeholder globalmente (modo strict lança).
const NULL_REF: RedmineRef = Object.freeze({ id: 0, name: '' });

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
 * Núcleo (#11): id, subject, description, refs, datas, journals e attachments.
 * Coleções (#12): custom_fields, relations, parent/children e watchers. Nunca
 * lança: payload parcial/malformado degrada campo a campo para defaults estáveis.
 *
 * `watchers` só aparece quando a chave está presente no payload; a ausência
 * (include não pedido ou 403) omite o campo como degradação. A API de issue não
 * devolve `field_format` dos custom fields — o chamador pode anotá-lo via
 * `fieldFormats` (ex.: a partir de `/custom_fields.json`).
 *
 * @param payload - Payload bruto de `getIssue`.
 * @param fieldFormats - Mapa opcional `custom_field_id → field_format`.
 * @returns A issue normalizada, sempre válida perante o contrato.
 * @example
 * const issue = normalizeIssue(await getIssue(http, 100));
 */
export function normalizeIssue(
  payload: RedmineIssuePayload,
  fieldFormats?: Map<number, string>,
): Issue {
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
    custom_fields: normalizeCustomFields(record.custom_fields, fieldFormats),
    relations: normalizeRelations(record.relations),
    children: normalizeChildren(record.children),
  };

  const description = asString(record.description);
  if (description !== undefined && description !== '') issue.description = description;
  const assignedTo = normalizeRef(record.assigned_to);
  if (assignedTo !== undefined) issue.assigned_to = assignedTo;
  const parent = normalizeParent(record.parent);
  if (parent !== undefined) issue.parent = parent;
  // Ausência da chave `watchers` = degradação (403/include ausente): campo omitido.
  if ('watchers' in record) issue.watchers = normalizeWatchers(record.watchers);

  return issue;
}
