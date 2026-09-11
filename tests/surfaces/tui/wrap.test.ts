import { describe, expect, it } from 'vitest';

import { wrapLine, wrapText } from '../../../src/surfaces/tui/wrap.js';

describe('wrapLine', () => {
  // Caso esperado: quebra entre palavras, respeitando a largura.
  it('quebra sem cortar palavras', () => {
    expect(wrapLine('uma frase bem comprida', 10)).toEqual(['uma frase', 'bem', 'comprida']);
  });

  it('devolve a linha intacta quando cabe', () => {
    expect(wrapLine('curta', 10)).toEqual(['curta']);
    // Exatamente na largura não quebra.
    expect(wrapLine('1234567890', 10)).toEqual(['1234567890']);
  });

  // Edge case: palavra maior que a largura (URL, hash, caminho) precisa quebrar
  // à força — deixá-la passar estouraria o viewport, que é o bug de origem.
  it('quebra à força palavra maior que a largura', () => {
    expect(wrapLine('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
  });

  it('mistura palavra longa com palavras normais', () => {
    expect(wrapLine('ok abcdefghijkl fim', 5)).toEqual(['ok', 'abcde', 'fghij', 'kl', 'fim']);
  });

  // Failure case: largura inválida não pode gerar laço infinito nem array vazio.
  it.each([0, -5])('devolve o texto inteiro para largura %i', (width) => {
    expect(wrapLine('qualquer coisa', width)).toEqual(['qualquer coisa']);
  });

  it('preserva a linha vazia', () => {
    expect(wrapLine('', 10)).toEqual(['']);
  });

  // Conta code points, como `./truncate.ts` — acento não pode contar dobrado.
  it('mede acentuação como um caractere', () => {
    expect(wrapLine('ação', 4)).toEqual(['ação']);
  });
});

describe('wrapText', () => {
  it('quebra cada linha e preserva as linhas em branco', () => {
    expect(wrapText('uma frase longa\n\nfim', 9)).toEqual(['uma frase', 'longa', '', 'fim']);
  });

  // O caso real que motivou o wrap: parágrafo único de descrição de chamado.
  it('divide um parágrafo longo em linhas do tamanho pedido', () => {
    const paragrafo =
      'exibida com a separação de milhares por ponto e das casas decimais por vírgula conforme o padrão';
    const lines = wrapText(paragrafo, 40);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(40);
    // Nenhum caractere se perde na quebra.
    expect(lines.join(' ')).toBe(paragrafo);
  });
});
