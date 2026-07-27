/**
 * Testes dos glyphs "common" fora de `figures` (M5-09, #84) — hardening do
 * terminal LEGADO do Windows. Cobrem: (1) a detecção de suporte a Unicode
 * espelhada de `is-unicode-supported` (mesma que `figures` usa), incluindo o
 * caso do cmd.exe/PowerShell legado; (2) o fallback ASCII PURO (sem nenhum
 * codepoint > 127, o que causaria mojibake); (3) a coerência do conjunto
 * resolvido para o ambiente atual.
 */
import { describe, expect, it } from 'vitest';

import {
  ASCII_GLYPHS,
  UNICODE_GLYPHS,
  glyphs,
  isUnicodeSupported,
  resolveGlyphs,
  type Glyphs,
} from '../../../src/surfaces/tui/glyphs.js';

/** `true` se TODA a string é ASCII puro (nenhum caractere fora de 0x00–0x7F). */
function isPureAscii(value: string): boolean {
  for (const char of value) {
    if (char.codePointAt(0)! > 0x7f) return false;
  }
  return true;
}

describe('TUI: isUnicodeSupported (detecção de terminal legado)', () => {
  it('cmd.exe/PowerShell legado (win32 sem variáveis relevantes) → false', () => {
    expect(isUnicodeSupported({}, 'win32')).toBe(false);
  });

  it.each([
    ['WT_SESSION', { WT_SESSION: '1' }],
    ['ConEmu/cmder', { ConEmuTask: '{cmd::Cmder}' }],
    ['VS Code', { TERM_PROGRAM: 'vscode' }],
    ['xterm-256color', { TERM: 'xterm-256color' }],
  ] as const)('win32 com %s → true', (_label, env) => {
    expect(isUnicodeSupported(env, 'win32')).toBe(true);
  });

  it('não-Windows com TERM comum (xterm) → true', () => {
    expect(isUnicodeSupported({ TERM: 'xterm-256color' }, 'darwin')).toBe(true);
    expect(isUnicodeSupported({ TERM: 'xterm' }, 'linux')).toBe(true);
  });

  it('console do kernel Linux (TERM=linux) → false', () => {
    expect(isUnicodeSupported({ TERM: 'linux' }, 'linux')).toBe(false);
  });

  it('não-Windows sem TERM definido → true (só o console do kernel degrada)', () => {
    expect(isUnicodeSupported({}, 'darwin')).toBe(true);
  });
});

describe('TUI: resolveGlyphs', () => {
  it('unicode=true retorna o conjunto Unicode', () => {
    expect(resolveGlyphs(true)).toBe(UNICODE_GLYPHS);
    expect(resolveGlyphs(true).ellipsis).toBe('…');
    expect(resolveGlyphs(true).arrowUp).toBe('↑');
    expect(resolveGlyphs(true).maskBullet).toBe('•');
  });

  it('unicode=false retorna o conjunto ASCII', () => {
    expect(resolveGlyphs(false)).toBe(ASCII_GLYPHS);
  });
});

describe('TUI: ASCII_GLYPHS (fallback sem mojibake)', () => {
  const scalarEntries = Object.entries(ASCII_GLYPHS).filter(
    ([key]) => key !== 'spinnerFrames',
  ) as ReadonlyArray<[keyof Glyphs, string]>;

  it.each(scalarEntries)('%s é ASCII puro e não-vazio', (_key, value) => {
    expect(value.length).toBeGreaterThan(0);
    expect(isPureAscii(value)).toBe(true);
  });

  it('todos os frames do spinner ASCII são ASCII puro e não-vazios', () => {
    expect(ASCII_GLYPHS.spinnerFrames.length).toBeGreaterThan(0);
    for (const frame of ASCII_GLYPHS.spinnerFrames) {
      expect(frame.length).toBeGreaterThan(0);
      expect(isPureAscii(frame)).toBe(true);
    }
  });

  it('a máscara ASCII cabe em 1 coluna (não infla campos de senha)', () => {
    expect(ASCII_GLYPHS.maskBullet).toHaveLength(1);
  });
});

describe('TUI: UNICODE_GLYPHS e ASCII_GLYPHS têm as mesmas chaves', () => {
  it('nenhuma chave presente em um conjunto e ausente no outro', () => {
    expect(Object.keys(ASCII_GLYPHS).sort()).toEqual(Object.keys(UNICODE_GLYPHS).sort());
  });
});

describe('TUI: glyphs (conjunto resolvido para o ambiente atual)', () => {
  it('é exatamente resolveGlyphs(isUnicodeSupported()) — coerente com figures', () => {
    expect(glyphs).toBe(resolveGlyphs(isUnicodeSupported()));
  });
});
