/**
 * Testes do gradiente zero-dependência (#190): interpolação de cores + render.
 */
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { GradientText, rampColors } from '../../../src/surfaces/tui/components/gradient-text.js';

describe('rampColors', () => {
  it('0 passos → vazio', () => {
    expect(rampColors(['#ffffff'], 0)).toEqual([]);
  });

  it('1 cor → todos os passos iguais a ela', () => {
    expect(rampColors(['#ff0000'], 3)).toEqual(['#ff0000', '#ff0000', '#ff0000']);
  });

  it('interpola linearmente entre extremos (preto → branco)', () => {
    const ramp = rampColors(['#000000', '#ffffff'], 3);
    expect(ramp[0]).toBe('#000000');
    expect(ramp[2]).toBe('#ffffff');
    expect(ramp[1]).toBe('#808080'); // meio: round(127.5) = 128 = 0x80
  });

  it('aceita #rgb curto e várias paradas', () => {
    const ramp = rampColors(['#f00', '#0f0', '#00f'], 3);
    expect(ramp[0]).toBe('#ff0000');
    expect(ramp[1]).toBe('#00ff00');
    expect(ramp[2]).toBe('#0000ff');
  });

  it('cores inválidas são ignoradas (ramp vazia se nenhuma válida)', () => {
    expect(rampColors(['não-é-cor'], 4)).toEqual([]);
  });
});

describe('GradientText', () => {
  it('preserva o texto visível', () => {
    const { lastFrame } = render(<GradientText colors={['#ff0000', '#0000ff']}>redmine-context</GradientText>);
    expect(lastFrame()).toContain('redmine-context');
  });

  it('ramp vazia degrada para texto sólido (sem quebrar)', () => {
    const { lastFrame } = render(<GradientText colors={[]}>oi</GradientText>);
    expect(lastFrame()).toContain('oi');
  });
});
