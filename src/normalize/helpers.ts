/**
 * Helpers de parsing defensivo compartilhados pela normalização (issues #11/#12).
 *
 * Núcleo do estilo "nunca lança" de `src/normalize/*`: cada função converte um
 * valor `unknown` em um tipo estável ou num `undefined`/default previsível,
 * permitindo que payloads parciais ou malformados degradem campo a campo sem
 * crashar. Reutilizados por {@link normalizeIssue} e pelos normalizadores de
 * coleções (custom_fields, relations, children, watchers).
 */

import type { RedmineRef } from '../contract.js';

/**
 * Converte um valor desconhecido em `Record<string, unknown>` para acesso seguro.
 *
 * @param value - Valor a inspecionar.
 * @returns O objeto tipado, ou `undefined` se não for um objeto simples.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Devolve o array bruto, ou `[]` quando o valor não é um array. */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `string` quando o valor é textual, senão `undefined`. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** `number` quando o valor é numérico, senão `undefined`. */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Preserva `string`/`null` de valores brutos; tipos inesperados viram `null`. */
export function asStringOrNull(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : null;
}

/** Type guard para remover `undefined` após um `map` defensivo. */
export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Normaliza uma ref nomeada do Redmine (`{ id, name }`).
 *
 * @param value - Valor bruto (objeto esperado).
 * @returns A ref quando há `id` numérico; senão `undefined`. `name` não-string
 *   degrada para `""`.
 */
export function normalizeRef(value: unknown): RedmineRef | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const id = asNumber(record.id);
  if (id === undefined) return undefined;
  return { id, name: asString(record.name) ?? '' };
}
