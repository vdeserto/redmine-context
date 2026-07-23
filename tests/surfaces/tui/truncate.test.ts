/**
 * Testes do truncamento por largura unificado (M2-16, #39) — antes uma
 * função local em `screens/home.tsx`. Escrito ANTES da implementação (TDD).
 */
import { describe, expect, it } from 'vitest';

import { truncate, truncateStart } from '../../../src/surfaces/tui/truncate.js';

describe('truncate (corte a partir do fim)', () => {
  it('string dentro do limite: retorna inalterada', () => {
    expect(truncate('curto', 10)).toBe('curto');
  });

  it('string exatamente no limite: retorna inalterada (sem reticências)', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });

  it('string longa: corta e termina com reticências, respeitando o total de colunas', () => {
    const result = truncate('Refatorar o pipeline de exportação de anexos', 20);
    expect(result.length).toBe(20);
    expect(result.endsWith('…')).toBe(true);
    expect(result).toBe('Refatorar o pipelin…');
  });

  it('max === 1: retorna só a reticência', () => {
    expect(truncate('qualquer coisa', 1)).toBe('…');
  });

  it('max <= 0: retorna string vazia (caso de borda/falha defensivo)', () => {
    expect(truncate('qualquer coisa', 0)).toBe('');
    expect(truncate('qualquer coisa', -5)).toBe('');
  });
});

describe('truncateStart (corte a partir do início, preserva o fim)', () => {
  it('string dentro do limite: retorna inalterada', () => {
    expect(truncateStart('curto', 10)).toBe('curto');
  });

  it('string longa: corta do início, preserva o final e prefixa reticências', () => {
    const result = truncateStart('/home/usuario/projetos/redmine-context/saida', 20);
    expect(result.length).toBe(20);
    expect(result.startsWith('…')).toBe(true);
    expect(result.endsWith('saida')).toBe(true);
  });

  it('max === 1: retorna só a reticência', () => {
    expect(truncateStart('qualquer coisa', 1)).toBe('…');
  });

  it('max <= 0: retorna string vazia (caso de borda/falha defensivo)', () => {
    expect(truncateStart('qualquer coisa', 0)).toBe('');
  });
});
