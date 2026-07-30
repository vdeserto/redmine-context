/**
 * Testes das cores default do terminal via OSC (#190).
 */
import { describe, expect, it, vi } from 'vitest';

import { applyTerminalColors, resetTerminalColors } from '../../../src/surfaces/tui/terminal-colors.js';
import type { Theme } from '../../../src/surfaces/tui/theme.js';

const out = (): { stream: NodeJS.WriteStream; write: ReturnType<typeof vi.fn>; text(): string } => {
  const write = vi.fn();
  return {
    stream: { write } as unknown as NodeJS.WriteStream,
    write,
    text: () => write.mock.calls.map((c) => String(c[0])).join(''),
  };
};

const baseTheme: Theme = {
  primary: '#89b4fa',
  accent: '#f5c2e7',
  muted: '#9399b2',
  success: '#a6e3a1',
  warning: '#f9e2af',
  danger: '#f38ba8',
  border: '#585b70',
};

describe('applyTerminalColors', () => {
  it('escreve OSC 11 (fundo) e OSC 10 (texto) quando definidos', () => {
    const o = out();
    applyTerminalColors(o.stream, {
      ...baseTheme,
      background: '#1e1e2e',
      text: '#cdd6f4',
    });
    expect(o.text()).toContain('\x1b]11;#1e1e2e\x07');
    expect(o.text()).toContain('\x1b]10;#cdd6f4\x07');
  });

  it('não escreve nada quando background/text ausentes (ex.: DEFAULT_THEME)', () => {
    const o = out();
    applyTerminalColors(o.stream, baseTheme);
    expect(o.write).not.toHaveBeenCalled();
  });
});

describe('resetTerminalColors', () => {
  it('escreve OSC 110/111 (reset de texto/fundo)', () => {
    const o = out();
    resetTerminalColors(o.stream);
    expect(o.text()).toContain('\x1b]110\x07');
    expect(o.text()).toContain('\x1b]111\x07');
  });
});
