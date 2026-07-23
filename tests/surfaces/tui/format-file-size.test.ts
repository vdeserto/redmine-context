/**
 * Testes de `humanizeFileSize` (#32) — formata `Attachment.filesize` (bytes,
 * inteiro bruto do Redmine) em texto humanizado (B/KB/MB/GB) para a seção de
 * anexos do detalhe da issue. Escrito ANTES da implementação (TDD).
 */
import { describe, expect, it } from 'vitest';

import { humanizeFileSize } from '../../../src/surfaces/tui/format-file-size.js';

describe('TUI: humanizeFileSize', () => {
  it('bytes abaixo de 1024 mostram o inteiro com sufixo B', () => {
    expect(humanizeFileSize(999)).toBe('999B');
  });

  it('zero bytes mostra "0B"', () => {
    expect(humanizeFileSize(0)).toBe('0B');
  });

  it('KB com fração mostra 1 casa decimal', () => {
    expect(humanizeFileSize(1536)).toBe('1.5KB'); // 1536 / 1024 = 1.5
  });

  it('KB exato (sem fração) não mostra ".0"', () => {
    expect(humanizeFileSize(1024)).toBe('1KB');
  });

  it('MB exato não mostra casas decimais desnecessárias', () => {
    expect(humanizeFileSize(2 * 1024 * 1024)).toBe('2MB'); // 2097152 bytes
  });

  it('MB com fração mostra 1 casa decimal', () => {
    expect(humanizeFileSize(1.5 * 1024 * 1024)).toBe('1.5MB');
  });

  it('GB também é suportado (arquivo hipotético grande)', () => {
    expect(humanizeFileSize(2 * 1024 * 1024 * 1024)).toBe('2GB');
  });

  it('valores negativos (defensivo, nunca deveria ocorrer) não lançam — trata como 0B', () => {
    expect(() => humanizeFileSize(-10)).not.toThrow();
    expect(humanizeFileSize(-10)).toBe('0B');
  });
});

it('quase-1024 escala para a unidade seguinte (1048575B → 1MB, nunca 1024KB)', () => {
  expect(humanizeFileSize(1048575)).toBe('1MB');
  expect(humanizeFileSize(1024 * 1024 * 1024 - 1)).toBe('1GB');
  expect(humanizeFileSize(1023 * 1024 + 1000)).toBe('1MB');
});
