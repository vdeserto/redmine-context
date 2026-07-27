/**
 * Teste do wire `runTui()`: mocka `ink` e `app.js` para validar apenas a
 * orquestração (renderiza o roteador, aguarda a saída) sem depender de um
 * terminal real.
 */
import { describe, expect, it, vi } from 'vitest';

// vi.mock é hoisted para o topo do arquivo — as mocks referenciadas pela
// factory precisam ser criadas via vi.hoisted() para existir nesse ponto.
const { render, waitUntilExit } = vi.hoisted(() => {
  const waitUntilExit = vi.fn().mockResolvedValue(undefined);
  const render = vi.fn().mockReturnValue({ waitUntilExit });
  return { render, waitUntilExit };
});

vi.mock('ink', () => ({ render }));
vi.mock('../../../src/surfaces/tui/app.js', () => ({ App: (): null => null }));

import type { SettingsStore } from '../../../src/index.js';
import { runTui } from '../../../src/surfaces/tui/index.js';

/** Settings em memória — isola do arquivo real e da mutação de `process.env` (#187). */
const settings: SettingsStore = {
  getInstanceUrl: vi.fn().mockResolvedValue(undefined),
  setInstanceUrl: vi.fn().mockResolvedValue(undefined),
  clearInstanceUrl: vi.fn().mockResolvedValue(undefined),
  getPaletteId: vi.fn().mockResolvedValue(undefined),
  setPaletteId: vi.fn().mockResolvedValue(undefined),
};

/** Stdout não-TTY: desliga o full-screen (alt-screen) e não escreve escape codes. */
const stdout = { isTTY: false, write: vi.fn() } as unknown as NodeJS.WriteStream;

describe('TUI: runTui', () => {
  it('renderiza o roteador e resolve 0 quando o app sai', async () => {
    // Injeta env/settings próprios: sem isso `runTui()` tocaria o settings.json
    // REAL do usuário e mutaria o `process.env.REDMINE_URL` do processo de teste.
    const code = await runTui({ env: {} as NodeJS.ProcessEnv, settings, stdout });
    expect(render).toHaveBeenCalledTimes(1);
    expect(waitUntilExit).toHaveBeenCalledTimes(1);
    expect(code).toBe(0);
  });

  it('em TTY: entra no alt-screen no boot e restaura ao sair (#190)', async () => {
    const write = vi.fn();
    const ttyOut = { isTTY: true, write } as unknown as NodeJS.WriteStream;

    await runTui({ env: {} as NodeJS.ProcessEnv, settings, stdout: ttyOut });

    const written = write.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('\x1b[?1049h'); // entra no buffer alternativo
    expect(written).toContain('\x1b[?1049l'); // restaura o buffer principal ao sair
    // A ordem: entrar ANTES de restaurar.
    expect(written.indexOf('\x1b[?1049h')).toBeLessThan(written.indexOf('\x1b[?1049l'));
  });

  it('fora de TTY: NÃO escreve escape codes de alt-screen', async () => {
    const write = vi.fn();
    const pipeOut = { isTTY: false, write } as unknown as NodeJS.WriteStream;

    await runTui({ env: {} as NodeJS.ProcessEnv, settings, stdout: pipeOut });

    expect(write).not.toHaveBeenCalled();
  });
});
