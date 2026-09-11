import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { Gauge, filledCells } from '../../../../src/surfaces/tui/components/gauge.js';
import { UNICODE_GLYPHS } from '../../../../src/surfaces/tui/glyphs.js';

const COLOR = '#ffffff';

describe('filledCells: conversão de fração em células', () => {
  // Caso esperado: metade da barra preenchida.
  it('arredonda a fração para a célula mais próxima', () => {
    expect(filledCells(0.5, 20)).toBe(10);
    expect(filledCells(0.42, 10)).toBe(4);
  });

  // Edge case: as pontas precisam ser exatas — 0 não pode acender célula e 1
  // não pode deixar sobra, senão a barra "nunca completa".
  it('respeita as pontas 0 e 1', () => {
    expect(filledCells(0, 20)).toBe(0);
    expect(filledCells(1, 20)).toBe(20);
  });

  // Failure case: valor fora da faixa (produtor de job com bug) não pode gerar
  // repeat() negativo nem barra maior que a largura.
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'fixa o valor inválido %s dentro de [0, width]',
    (value) => {
      const cells = filledCells(value, 20);
      expect(cells).toBeGreaterThanOrEqual(0);
      expect(cells).toBeLessThanOrEqual(20);
    },
  );
});

describe('Gauge: render', () => {
  it('desenha preenchimento, trilho e percentual', () => {
    const { lastFrame } = render(<Gauge progress={0.5} color={COLOR} trackColor={COLOR} width={10} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain(UNICODE_GLYPHS.gaugeFull.repeat(5));
    expect(frame).toContain(UNICODE_GLYPHS.gaugeEmpty.repeat(5));
    expect(frame).toContain('50%');
  });

  // O percentual é alinhado à direita para a barra não "tremer" quando o
  // número passa de 9 para 10 e de 99 para 100.
  it('alinha o percentual em três colunas', () => {
    const { lastFrame } = render(<Gauge progress={0.05} color={COLOR} trackColor={COLOR} width={10} />);
    expect(lastFrame()).toContain('  5%');
  });

  it('barra cheia não deixa trilho', () => {
    const { lastFrame } = render(<Gauge progress={1} color={COLOR} trackColor={COLOR} width={8} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain(UNICODE_GLYPHS.gaugeFull.repeat(8));
    expect(frame).not.toContain(UNICODE_GLYPHS.gaugeEmpty);
    expect(frame).toContain('100%');
  });
});
