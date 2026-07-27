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
import { installAltScreen, runTui, type AltScreenProc } from '../../../src/surfaces/tui/index.js';

const ALT_ENTER = '\x1b[?1049h';
const ALT_LEAVE = '\x1b[?1049l';

/** `process` fake: registra/dispara listeners e espiona `exit` — para o alt-screen. */
function fakeProc(): AltScreenProc & {
  emit(event: string): void;
  count(event: string): number;
  exit: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, Array<(...a: unknown[]) => void>>();
  return {
    on(event, listener) {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
      return this;
    },
    off(event, listener) {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
      return this;
    },
    exit: vi.fn() as unknown as (code?: number) => never,
    emit(event) {
      for (const l of [...(listeners.get(event) ?? [])]) l();
    },
    count(event) {
      return (listeners.get(event) ?? []).length;
    },
  };
}

const writtenOf = (write: ReturnType<typeof vi.fn>): string =>
  write.mock.calls.map((c) => String(c[0])).join('');

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

describe('installAltScreen (B1: restauração à prova de sinal)', () => {
  it('entra no alt-screen na instalação e RESTAURA em SIGTERM, encerrando o processo', () => {
    const write = vi.fn();
    const out = { write } as unknown as NodeJS.WriteStream;
    const proc = fakeProc();

    const dispose = installAltScreen(out, proc);
    expect(writtenOf(write)).toContain(ALT_ENTER);

    write.mockClear();
    proc.emit('SIGTERM'); // sinal externo (kill / fechar aba / process manager)
    expect(writtenOf(write)).toContain(ALT_LEAVE);
    expect(proc.exit).toHaveBeenCalledWith(143);

    // Idempotente: dispose depois do sinal não escreve a saída de novo.
    write.mockClear();
    dispose();
    expect(write).not.toHaveBeenCalled();
  });

  it('cobre SIGINT e SIGHUP com os códigos convencionais', () => {
    for (const [signal, code] of [
      ['SIGINT', 130],
      ['SIGHUP', 129],
    ] as const) {
      const write = vi.fn();
      const proc = fakeProc();
      installAltScreen({ write } as unknown as NodeJS.WriteStream, proc);
      write.mockClear();
      proc.emit(signal);
      expect(writtenOf(write)).toContain(ALT_LEAVE);
      expect(proc.exit).toHaveBeenCalledWith(code);
    }
  });

  it('dispose (saída normal) restaura uma vez e remove TODOS os listeners', () => {
    const write = vi.fn();
    const proc = fakeProc();
    const dispose = installAltScreen({ write } as unknown as NodeJS.WriteStream, proc);

    write.mockClear();
    dispose();
    expect(writtenOf(write)).toContain(ALT_LEAVE);

    // Sem vazar handlers de sinal/exit no `process`.
    expect(proc.count('SIGTERM')).toBe(0);
    expect(proc.count('SIGINT')).toBe(0);
    expect(proc.count('SIGHUP')).toBe(0);
    expect(proc.count('exit')).toBe(0);

    // Idempotente.
    write.mockClear();
    dispose();
    expect(write).not.toHaveBeenCalled();
  });
});
