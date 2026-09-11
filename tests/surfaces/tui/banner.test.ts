import { describe, expect, it } from 'vitest';

import { bannerLines, selectBanner } from '../../../src/surfaces/tui/banner.js';

describe('selectBanner: escolha por largura e suporte a Unicode', () => {
  // Caso esperado: terminal largo com Unicode ganha a arte de uma linha.
  it('usa a wide quando cabe e há Unicode', () => {
    expect(selectBanner(121, true)).toBe('wide');
    expect(selectBanner(200, true)).toBe('wide');
  });

  // Edge case: uma coluna abaixo do necessário já derruba para a empilhada —
  // sem isso a arte quebraria a linha e o logo sairia deformado.
  it('cai para stacked uma coluna antes do limite da wide', () => {
    expect(selectBanner(120, true)).toBe('stacked');
    expect(selectBanner(61, true)).toBe('stacked');
  });

  // Sem Unicode, os blocos do ANSI Shadow viram mojibake no Windows legado
  // (mesmo motivo do fallback do spinner, M5-09 #84).
  it('ignora as variantes Unicode quando o terminal não as suporta', () => {
    expect(selectBanner(200, false)).toBe('ascii');
    expect(selectBanner(63, false)).toBe('ascii');
  });

  // Failure case: terminal estreito demais não recebe arte nenhuma; a tela
  // cai no nome em texto, em vez de renderizar um logo cortado.
  it('devolve plain quando nem a arte ASCII cabe', () => {
    expect(selectBanner(62, false)).toBe('plain');
    expect(selectBanner(60, true)).toBe('plain');
    expect(selectBanner(0, true)).toBe('plain');
  });
});

describe('bannerLines: integridade da arte', () => {
  it('plain não tem linhas', () => {
    expect(bannerLines('plain')).toEqual([]);
  });

  // A largura declarada em MIN_WIDTH precisa bater com a arte real, senão a
  // seleção autoriza uma variante que não cabe.
  it.each([
    ['wide' as const, 121],
    ['stacked' as const, 61],
    ['ascii' as const, 63],
  ])('%s cabe exatamente na largura mínima declarada (%i)', (variant, min) => {
    const width = Math.max(...bannerLines(variant).map((line) => [...line].length));
    expect(width).toBeLessThanOrEqual(min);
    expect(selectBanner(min, true)).toBeTruthy();
  });

  it('nenhuma variante tem linhas vazias no meio da arte', () => {
    for (const variant of ['wide', 'stacked', 'ascii'] as const) {
      const lines = bannerLines(variant);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => line.trim().length > 0)).toBe(true);
    }
  });

  // A variante ASCII existe justamente para o terminal sem Unicode: se um
  // caractere não-ASCII escapar para ela, o fallback não serve para nada.
  it('a variante ascii contém APENAS caracteres ASCII', () => {
    for (const line of bannerLines('ascii')) {
      expect(/^[\x20-\x7e]*$/.test(line)).toBe(true);
    }
  });
});
