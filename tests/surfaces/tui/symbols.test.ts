/**
 * Testes do módulo de símbolos da TUI (M2-03) — garante que as telas tenham
 * uma fonte única de símbolos (via `figures`, que já degrada para ASCII em
 * terminais sem suporte a Unicode) em vez de caracteres hardcoded.
 */
import { describe, expect, it } from 'vitest';

import { symbols } from '../../../src/surfaces/tui/symbols.js';

describe('TUI: symbols', () => {
  it('expõe os símbolos conhecidos usados pelas telas', () => {
    expect(typeof symbols.tick).toBe('string');
    expect(typeof symbols.cross).toBe('string');
    expect(typeof symbols.pointer).toBe('string');
    expect(typeof symbols.warning).toBe('string');
    expect(typeof symbols.info).toBe('string');
  });

  it('nenhum símbolo conhecido é uma string vazia', () => {
    for (const value of Object.values(symbols)) {
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
