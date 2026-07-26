/**
 * Testes de `shouldRenderTui` (M2-03) — decisão pura e centralizada de quando
 * a TUI Ink pode abrir. Escritos antes da implementação (TDD): cobrem as 3
 * condições de degradação isoladas e em combinação.
 */
import { describe, expect, it } from 'vitest';

import { shouldRenderTui } from '../../../src/surfaces/cli/tty.js';

/** Env "limpo": nenhuma variável de degradação definida, só para reduzir ruído nos casos. */
function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe('CLI: shouldRenderTui', () => {
  it('permite a TUI quando isTTY é true e o ambiente está limpo', () => {
    expect(shouldRenderTui(env(), true)).toBe(true);
  });

  it('nunca permite a TUI quando isTTY é false, mesmo com ambiente limpo', () => {
    expect(shouldRenderTui(env(), false)).toBe(false);
  });

  it.each(['1', '0', 'true', 'false', ''])(
    'NO_COLOR=%s degrada mesmo com isTTY true (qualquer valor conta)',
    (value) => {
      expect(shouldRenderTui(env({ NO_COLOR: value }), true)).toBe(false);
    },
  );

  it('CI=true degrada mesmo com isTTY true', () => {
    expect(shouldRenderTui(env({ CI: 'true' }), true)).toBe(false);
  });

  it('CI com outro valor (ex.: "false") não degrada por si só', () => {
    expect(shouldRenderTui(env({ CI: 'false' }), true)).toBe(true);
  });

  it('combinação: NO_COLOR e CI=true e isTTY false — continua false', () => {
    expect(shouldRenderTui(env({ NO_COLOR: '1', CI: 'true' }), false)).toBe(false);
  });

  it('combinação: apenas CI=true com isTTY true degrada', () => {
    expect(shouldRenderTui(env({ CI: 'true' }), true)).toBe(false);
  });

  it('combinação: apenas NO_COLOR com isTTY true degrada', () => {
    expect(shouldRenderTui(env({ NO_COLOR: '1' }), true)).toBe(false);
  });

  it('não é afetado por outras variáveis de ambiente irrelevantes', () => {
    expect(shouldRenderTui(env({ PATH: '/usr/bin', REDMINE_URL: 'https://x' }), true)).toBe(true);
  });
});

it('CI=1 (provedores que não usam "true") também degrada', () => {
  expect(shouldRenderTui({ CI: '1' }, true)).toBe(false);
});

/**
 * HARDENING WINDOWS LEGADO (M5-09, #84): a degradação NO_COLOR/não-TTY é
 * decidida por `shouldRenderTui`, que é AGNÓSTICA de plataforma — logo o
 * caminho de texto puro vale igual no Windows. Estes casos travam a invariante
 * simulando o ambiente típico do cmd.exe/PowerShell legado (sem `WT_SESSION`).
 */
describe('CLI: degradação no Windows legado (NO_COLOR / não-TTY)', () => {
  it('NO_COLOR degrada mesmo em TTY do Windows legado', () => {
    expect(shouldRenderTui({ NO_COLOR: '1', ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, true)).toBe(
      false,
    );
  });

  it('não-TTY (pipe/redirect) degrada no Windows legado', () => {
    expect(shouldRenderTui({ ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, false)).toBe(false);
  });

  it('TTY do Windows legado sem sinal de degradação ainda abre a TUI', () => {
    expect(shouldRenderTui({ ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, true)).toBe(true);
  });
});
