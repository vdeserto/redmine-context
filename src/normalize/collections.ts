/**
 * Normalização das coleções aninhadas de uma issue (issue #12).
 *
 * Cobre o que a issue #11 deixou como coleções vazias: custom_fields, relations,
 * parent/children e watchers. Mesmo contrato de robustez de {@link normalizeIssue}
 * (`src/normalize/issue.ts`): reutiliza os helpers defensivos de `./helpers.js` e
 * NUNCA lança — itens malformados são descartados e campos ausentes degradam para
 * defaults estáveis do contrato (ADR-005).
 */

import type { CustomField, IssueChild, IssueRelation, RedmineRef } from '../contract.js';
import { asArray, asNumber, asRecord, asString, isDefined, normalizeRef } from './helpers.js';

/**
 * Extrai o `raw_value` de um custom field preservando o bruto da API.
 *
 * Mantém `string`, `""` e arrays (filtrando itens não-textuais) exatamente como
 * vieram; `null`, ausência e tipos inesperados colapsam para `null`.
 *
 * @param value - Valor bruto de `custom_field.value`.
 * @returns O bruto preservado no formato do contrato.
 */
function rawCustomFieldValue(value: unknown): string | string[] | null {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return asString(value) ?? null;
}

/**
 * Normaliza APENAS a ausência de um custom field (`""`/`null` → `null`).
 *
 * Não há coerção de tipo (ADR-005): qualquer valor presente e não-vazio é
 * repassado intacto — inclusive arrays.
 *
 * @param raw - O `raw_value` já extraído.
 * @returns `null` para ausência (`""`/`null`); senão o próprio bruto.
 */
function normalizedCustomFieldValue(raw: string | string[] | null): string | string[] | null {
  if (raw === null || raw === '') return null;
  return raw;
}

/**
 * Normaliza um custom field para o contrato {@link CustomField}.
 *
 * `field_format` não vem na API de issue: só é anotado quando o chamador fornece
 * o formato via `fieldFormats` (ex.: de `/custom_fields.json`).
 *
 * @param value - Item bruto de `issue.custom_fields[]`.
 * @param fieldFormats - Mapa opcional `id → field_format` fornecido externamente.
 * @returns O custom field normalizado, ou `undefined` se não tiver `id` numérico.
 */
function normalizeCustomField(
  value: unknown,
  fieldFormats?: Map<number, string>,
): CustomField | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const id = asNumber(record.id);
  if (id === undefined) return undefined;

  const raw = rawCustomFieldValue(record.value);
  const field: CustomField = {
    id,
    name: asString(record.name) ?? '',
    value: normalizedCustomFieldValue(raw),
    raw_value: raw,
  };
  const format = fieldFormats?.get(id);
  if (format !== undefined) field.field_format = format;
  return field;
}

/**
 * Normaliza a coleção de custom fields de uma issue.
 *
 * @param value - Valor bruto de `issue.custom_fields`.
 * @param fieldFormats - Mapa opcional `id → field_format` fornecido externamente.
 * @returns Array de custom fields válidos (itens malformados descartados).
 */
export function normalizeCustomFields(
  value: unknown,
  fieldFormats?: Map<number, string>,
): CustomField[] {
  return asArray(value)
    .map((item) => normalizeCustomField(item, fieldFormats))
    .filter(isDefined);
}

/**
 * Normaliza uma relação entre issues para o contrato {@link IssueRelation}.
 *
 * @param value - Item bruto de `issue.relations[]`.
 * @returns A relação normalizada, ou `undefined` se não tiver `id` numérico.
 *   `delay` ausente vira `null`; demais campos numéricos/textuais degradam.
 */
function normalizeRelation(value: unknown): IssueRelation | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const id = asNumber(record.id);
  if (id === undefined) return undefined;
  return {
    id,
    issue_id: asNumber(record.issue_id) ?? 0,
    issue_to_id: asNumber(record.issue_to_id) ?? 0,
    relation_type: asString(record.relation_type) ?? '',
    delay: asNumber(record.delay) ?? null,
  };
}

/**
 * Normaliza a coleção de relations de uma issue.
 *
 * @param value - Valor bruto de `issue.relations`.
 * @returns Array de relations válidas (itens malformados descartados).
 */
export function normalizeRelations(value: unknown): IssueRelation[] {
  return asArray(value).map(normalizeRelation).filter(isDefined);
}

/**
 * Normaliza uma issue-filha para o contrato {@link IssueChild}.
 *
 * O contrato é plano (`{id, tracker?, subject?}`): eventuais `children` aninhados
 * do payload são ignorados aqui — cada nível é uma issue por si.
 *
 * @param value - Item bruto de `issue.children[]`.
 * @returns A filha normalizada, ou `undefined` se não tiver `id` numérico.
 */
function normalizeChild(value: unknown): IssueChild | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const id = asNumber(record.id);
  if (id === undefined) return undefined;

  const child: IssueChild = { id };
  const tracker = normalizeRef(record.tracker);
  if (tracker !== undefined) child.tracker = tracker;
  const subject = asString(record.subject);
  if (subject !== undefined) child.subject = subject;
  return child;
}

/**
 * Normaliza a coleção de children (nível de topo) de uma issue.
 *
 * @param value - Valor bruto de `issue.children`.
 * @returns Array de children válidos (itens malformados descartados).
 */
export function normalizeChildren(value: unknown): IssueChild[] {
  return asArray(value).map(normalizeChild).filter(isDefined);
}

/**
 * Extrai a referência de parent (`{ id }`) do payload.
 *
 * @param value - Valor bruto de `issue.parent`.
 * @returns `{ id }` quando há `id` numérico; senão `undefined`.
 */
export function normalizeParent(value: unknown): { id: number } | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const id = asNumber(record.id);
  return id === undefined ? undefined : { id };
}

/**
 * Normaliza a lista de watchers (refs `{ id, name }`).
 *
 * Só deve ser chamada quando a chave `watchers` está presente no payload — a
 * ausência da chave (include não pedido ou 403) é degradação e o campo do
 * contrato fica omitido pelo chamador.
 *
 * @param value - Valor bruto de `issue.watchers`.
 * @returns Array de refs válidas (itens malformados descartados).
 */
export function normalizeWatchers(value: unknown): RedmineRef[] {
  return asArray(value).map(normalizeRef).filter(isDefined);
}
