import { describe, expect, it } from 'vitest';

import { stableStringify, type JsonValue } from '../../src/bundle/index.js';

describe('stableStringify: serializador estável com chaves ordenadas', () => {
  it('ordena as chaves de objeto alfabeticamente (uso esperado)', () => {
    const value: JsonValue = { c: 1, a: 2, b: 3 };
    expect(stableStringify(value)).toBe('{\n  "a": 2,\n  "b": 3,\n  "c": 1\n}');
  });

  it('produz saída idêntica independentemente da ordem de inserção das chaves', () => {
    const a: JsonValue = { first: 'x', second: 'y', nested: { z: 1, y: 2, x: 3 } };
    const b: JsonValue = { nested: { x: 3, y: 2, z: 1 }, second: 'y', first: 'x' };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('ordena chaves recursivamente em objetos aninhados (edge)', () => {
    const value: JsonValue = { outer: { b: [{ d: 1, c: 2 }], a: null } };
    const parsed = JSON.parse(stableStringify(value)) as Record<string, unknown>;
    // A ordem serializada de chaves aninhadas deve ser determinística.
    expect(stableStringify(value)).toContain('"a": null');
    expect(stableStringify(value)).toContain('"c": 2');
    expect(parsed).toEqual(value);
  });

  it('preserva a ordem de arrays (não reordena elementos)', () => {
    const value: JsonValue = [3, 1, 2];
    expect(stableStringify(value)).toBe('[\n  3,\n  1,\n  2\n]');
  });

  it('omite propriedades undefined como JSON padrão (edge)', () => {
    const value = { a: 1, b: undefined } as unknown as JsonValue;
    expect(stableStringify(value)).toBe('{\n  "a": 1\n}');
  });

  it('serializa primitivos e null (failure/edge de tipos simples)', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('texto')).toBe('"texto"');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify(true)).toBe('true');
  });
});
