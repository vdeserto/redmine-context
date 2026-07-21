/**
 * Serializador JSON estável para o bundle determinístico (issue #15).
 *
 * O contrato do bundle exige que dois empacotamentos do mesmo estado sejam
 * byte-idênticos. `JSON.stringify` NÃO garante ordem de chaves entre objetos
 * construídos por caminhos diferentes; este módulo remove essa variável
 * reordenando as chaves de todo objeto (recursivamente) antes de serializar.
 * Arrays têm sua ordem preservada — a ordenação semântica das coleções é
 * responsabilidade de quem monta o corpo (`./json.ts`), não do serializador.
 *
 * Sem dependências novas: apenas `JSON.stringify` sobre uma cópia com chaves
 * ordenadas.
 */

/** Valor serializável em JSON (fechado sobre si mesmo, recursivo). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Reordena as chaves de todo objeto alfabeticamente, em profundidade.
 *
 * Propriedades `undefined` são descartadas (mesma semântica de `JSON.stringify`),
 * evitando que a presença/ausência de chaves opcionais dependa do caminho de
 * construção. A ordem de arrays é mantida intacta.
 *
 * @param value - Valor a normalizar.
 * @returns Cópia com chaves de objeto ordenadas recursivamente.
 */
function sortKeysDeep(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as { [key: string]: JsonValue };
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry !== undefined) sorted[key] = sortKeysDeep(entry);
    }
    return sorted;
  }
  return value;
}

/**
 * Serializa um valor em JSON estável (chaves ordenadas, indentação de 2 espaços).
 *
 * @param value - Valor JSON a serializar.
 * @returns String JSON determinística — idêntica para valores semanticamente iguais.
 * @example
 * stableStringify({ b: 1, a: 2 }); // '{\n  "a": 2,\n  "b": 1\n}'
 */
export function stableStringify(value: JsonValue): string {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}
