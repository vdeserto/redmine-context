import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { GradientBanner } from '../../../../src/surfaces/tui/components/gradient-banner.js';

const LINES = ['ab', 'cd'];

describe('GradientBanner', () => {
  // Caso esperado: a arte sai inteira, linha a linha.
  it('renderiza todas as linhas recebidas', () => {
    const { lastFrame } = render(<GradientBanner lines={LINES} colors={['#ff0000', '#0000ff']} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('ab');
    expect(frame).toContain('cd');
  });

  // Edge case: sem arte (variante `plain`) o componente some, em vez de deixar
  // um Box vazio ocupando linha na tela.
  it('não renderiza nada sem linhas', () => {
    const { lastFrame } = render(<GradientBanner lines={[]} colors={['#ff0000']} />);
    expect(lastFrame()).toBe('');
  });

  // Failure case: tema sem ramp de gradiente (ou ramp inválida) não pode
  // derrubar a tela inicial — degrada para texto sem cor.
  it('degrada para texto simples quando a ramp é vazia ou inválida', () => {
    const semRamp = render(<GradientBanner lines={LINES} colors={[]} />);
    expect(semRamp.lastFrame()).toContain('ab');

    const invalida = render(<GradientBanner lines={LINES} colors={['não-é-cor']} />);
    expect(invalida.lastFrame()).toContain('cd');
  });
});
