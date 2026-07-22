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
