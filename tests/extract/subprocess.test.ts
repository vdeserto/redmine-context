/**
 * Testes unitários do utilitário compartilhado de subprocesso (M4-10.2, #68,
 * ADR-002). Consolida (a) o ENV SANITIZADO e (b) o WATCHDOG de timeout
 * (`SIGTERM` → graça → `SIGKILL`) antes duplicados em audio/whisper/tesseract.
 *
 * HERMÉTICOS: o `execFile` é INJETADO (nenhum subprocesso real é criado) e o
 * watchdog é exercitado com FAKE TIMERS — determinístico. Provam: o env NUNCA
 * carrega `REDMINE_API_KEY` nem outros segredos; no Windows preserva variáveis
 * essenciais não-secretas (SystemRoot/windir); o timeout dispara `SIGTERM` e,
 * após a graça, `SIGKILL`, rejeitando com o erro de timeout — e SEM ZUMBI (o
 * child é efetivamente encerrado pelo `kill`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runWithWatchdog,
  sanitizedEnv,
  SubprocessAbortedError,
  SubprocessTimeoutError,
  type ExecFileLike,
  type WatchdogChild,
} from '../../src/extract/subprocess.js';

/** Child fake: registra os sinais recebidos e marca-se como encerrado (anti-zumbi). */
interface FakeChild extends WatchdogChild {
  readonly signals: NodeJS.Signals[];
  killed: boolean;
}

/** Callback do execFile na forma (error, stdout, stderr). */
type ExecCb = (error: Error | null, stdout: string, stderr: string) => void;

/** Captura da última invocação do execFile injetado. */
interface ExecCapture {
  file?: string;
  args?: readonly string[];
  options?: { env: NodeJS.ProcessEnv; maxBuffer: number; windowsHide: boolean };
  child?: FakeChild;
}

/**
 * Monta um `execFile` fake que chama o callback via `behavior` e devolve um child
 * que registra os sinais de `kill` (e marca `killed = true` — prova de encerramento).
 */
function fakeExec(capture: ExecCapture, behavior: (cb: ExecCb) => void): ExecFileLike {
  return ((file, args, options, callback) => {
    const child: FakeChild = {
      signals: [],
      killed: false,
      kill(signal: NodeJS.Signals): boolean {
        this.signals.push(signal);
        this.killed = true;
        return true;
      },
    };
    capture.file = file;
    capture.args = args;
    capture.options = options;
    capture.child = child;
    behavior(callback);
    return child;
  }) as ExecFileLike;
}

const BASE = { timeoutMs: 1_000, killGraceMs: 500, maxBuffer: 1024 } as const;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sanitizedEnv', () => {
  it('repassa PATH mas NUNCA segredos do pai (REDMINE_API_KEY e afins)', () => {
    const env = sanitizedEnv({
      platform: 'linux',
      source: {
        PATH: '/usr/bin:/bin',
        REDMINE_API_KEY: 'super-secreto',
        AWS_SECRET_ACCESS_KEY: 'x',
        GITHUB_TOKEN: 'y',
      },
    });

    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.REDMINE_API_KEY).toBeUndefined();
    expect(Object.keys(env)).toEqual(['PATH']);
  });

  it('usa um PATH de fallback quando a origem não define PATH', () => {
    const env = sanitizedEnv({ platform: 'linux', source: {} });
    expect(env.PATH).toBe('/usr/bin:/bin');
  });

  it('propaga apenas as chaves explicitamente permitidas, quando definidas', () => {
    const env = sanitizedEnv({
      platform: 'linux',
      allow: ['TESSDATA_PREFIX'],
      source: { PATH: '/bin', TESSDATA_PREFIX: '/opt/tessdata', REDMINE_API_KEY: 'z' },
    });
    expect(env.TESSDATA_PREFIX).toBe('/opt/tessdata');
    expect(env.REDMINE_API_KEY).toBeUndefined();
  });

  it('não injeta a chave permitida se ela estiver ausente na origem (exactOptional)', () => {
    const env = sanitizedEnv({ platform: 'linux', allow: ['TESSDATA_PREFIX'], source: { PATH: '/bin' } });
    expect('TESSDATA_PREFIX' in env).toBe(false);
  });

  it('no Windows preserva SystemRoot/windir (não-secretos, essenciais) mas exclui segredos', () => {
    const env = sanitizedEnv({
      platform: 'win32',
      source: {
        PATH: 'C:\\bin',
        SystemRoot: 'C:\\Windows',
        windir: 'C:\\Windows',
        REDMINE_API_KEY: 'super-secreto',
      },
    });
    expect(env.SystemRoot).toBe('C:\\Windows');
    expect(env.windir).toBe('C:\\Windows');
    expect(env.REDMINE_API_KEY).toBeUndefined();
  });
});

describe('runWithWatchdog: sucesso e falha imediata', () => {
  it('sucesso (exit 0): resolve o stdout, chama execFile SEM shell e NÃO mata o child', async () => {
    const capture: ExecCapture = {};
    const exec = fakeExec(capture, (cb) => queueMicrotask(() => cb(null, 'saida ok', '')));

    const stdout = await runWithWatchdog(
      { bin: '/opt/bin', args: ['-a', 'b'], env: { PATH: '/bin' }, ...BASE },
      { execFile: exec },
    );

    expect(stdout).toBe('saida ok');
    expect(capture.file).toBe('/opt/bin');
    // Sem shell: os args vão como LISTA (não interpolados numa string).
    expect(capture.args).toEqual(['-a', 'b']);
    expect(capture.options?.env).toEqual({ PATH: '/bin' });
    // Nenhum kill no caminho feliz — o processo saiu sozinho.
    expect(capture.child?.signals).toEqual([]);
    expect(capture.child?.killed).toBe(false);
  });

  it('exit != 0: rejeita com o erro bruto do execFile (não é timeout)', async () => {
    const capture: ExecCapture = {};
    const exec = fakeExec(capture, (cb) => queueMicrotask(() => cb(new Error('exit 1: boom'), '', '')));

    await expect(
      runWithWatchdog({ bin: '/opt/bin', args: [], env: { PATH: '/bin' }, ...BASE }, { execFile: exec }),
    ).rejects.toThrow('exit 1: boom');
    expect(capture.child?.signals).toEqual([]);
  });
});

describe('runWithWatchdog: timeout → SIGTERM → (graça) → SIGKILL, sem zumbi', () => {
  it('mata o processo travado com SIGTERM e depois SIGKILL e rejeita com timeout', async () => {
    vi.useFakeTimers();
    const capture: ExecCapture = {};
    // Nunca chama o callback: simula um binário travado.
    const exec = fakeExec(capture, () => undefined);

    const promise = runWithWatchdog(
      { bin: '/opt/bin', args: [], env: { PATH: '/bin' }, timeoutMs: 1_000, killGraceMs: 500, maxBuffer: 1024 },
      { execFile: exec },
    );
    // Sem isto, uma rejeição não-observada quebraria o teste antes do await final.
    const settled = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(capture.child?.signals).toEqual(['SIGTERM']);

    await vi.advanceTimersByTimeAsync(500);
    // Ordem exata: SIGTERM primeiro, SIGKILL após a graça (prova do escalonamento).
    expect(capture.child?.signals).toEqual(['SIGTERM', 'SIGKILL']);
    // ANTI-ZUMBI: o child foi efetivamente encerrado pelo kill.
    expect(capture.child?.killed).toBe(true);

    const error = await settled;
    expect(error).toBeInstanceOf(SubprocessTimeoutError);
    expect((error as SubprocessTimeoutError).timeoutMs).toBe(1_000);
  });

  it('usa o construtor de erro de timeout injetado (makeTimeoutError)', async () => {
    vi.useFakeTimers();
    const capture: ExecCapture = {};
    const exec = fakeExec(capture, () => undefined);

    class CustomTimeout extends Error {
      constructor() {
        super('custom');
        this.name = 'CustomTimeout';
      }
    }

    const promise = runWithWatchdog(
      { bin: '/opt/bin', args: [], env: { PATH: '/bin' }, ...BASE },
      { execFile: exec, makeTimeoutError: () => new CustomTimeout() },
    );
    const settled = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_500);
    const error = await settled;
    expect(error).toBeInstanceOf(CustomTimeout);
  });

  it('se o callback chegar DEPOIS do timeout, ainda resolve como timeout (uma única settle)', async () => {
    vi.useFakeTimers();
    const capture: ExecCapture = {};
    let late: ExecCb | undefined;
    const exec = fakeExec(capture, (cb) => {
      late = cb;
    });

    const promise = runWithWatchdog(
      { bin: '/opt/bin', args: [], env: { PATH: '/bin' }, ...BASE },
      { execFile: exec },
    );
    const settled = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(capture.child?.signals).toEqual(['SIGTERM']);
    // O processo "responde" tarde demais, já sob SIGTERM: não deve virar sucesso.
    late?.(null, 'tarde', '');

    await vi.advanceTimersByTimeAsync(500);
    // ANTI-PID-RECICLADO: como o processo respondeu ao SIGTERM durante a graça, o
    // timer de SIGKILL foi limpo — nenhum SIGKILL é disparado depois (senão
    // poderíamos matar um pid já reciclado pelo SO).
    expect(capture.child?.signals).toEqual(['SIGTERM']);
    const error = await settled;
    expect(error).toBeInstanceOf(SubprocessTimeoutError);
  });
});

describe('runWithWatchdog: cancelamento via AbortSignal (#69), matando o subprocesso', () => {
  it('ao abortar: SIGTERM → (graça) → SIGKILL, rejeita com SubprocessAbortedError, sem zumbi', async () => {
    vi.useFakeTimers();
    const capture: ExecCapture = {};
    // Nunca chama o callback: simula um binário longo que precisa ser morto.
    const exec = fakeExec(capture, () => undefined);
    const controller = new AbortController();

    const promise = runWithWatchdog(
      { bin: '/opt/bin', args: [], env: { PATH: '/bin' }, ...BASE, signal: controller.signal },
      { execFile: exec },
    );
    const settled = promise.catch((error: unknown) => error);

    controller.abort();
    // O abort mata o processo imediatamente com SIGTERM.
    expect(capture.child?.signals).toEqual(['SIGTERM']);

    await vi.advanceTimersByTimeAsync(500);
    // Escalonamento igual ao timeout: SIGKILL após a graça.
    expect(capture.child?.signals).toEqual(['SIGTERM', 'SIGKILL']);
    // ANTI-ZUMBI: o child foi efetivamente encerrado.
    expect(capture.child?.killed).toBe(true);

    const error = await settled;
    expect(error).toBeInstanceOf(SubprocessAbortedError);
  });

  it('se o signal JÁ está aborted na chamada, mata o processo de imediato', async () => {
    vi.useFakeTimers();
    const capture: ExecCapture = {};
    const exec = fakeExec(capture, () => undefined);
    const controller = new AbortController();
    controller.abort();

    const promise = runWithWatchdog(
      { bin: '/opt/bin', args: [], env: { PATH: '/bin' }, ...BASE, signal: controller.signal },
      { execFile: exec },
    );
    const settled = promise.catch((error: unknown) => error);

    expect(capture.child?.signals).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(500);
    const error = await settled;
    expect(error).toBeInstanceOf(SubprocessAbortedError);
  });

  it('se o processo responde ao SIGTERM durante a graça pós-abort, uma única settle (sem SIGKILL)', async () => {
    vi.useFakeTimers();
    const capture: ExecCapture = {};
    let late: ExecCb | undefined;
    const exec = fakeExec(capture, (cb) => {
      late = cb;
    });
    const controller = new AbortController();

    const promise = runWithWatchdog(
      { bin: '/opt/bin', args: [], env: { PATH: '/bin' }, ...BASE, signal: controller.signal },
      { execFile: exec },
    );
    const settled = promise.catch((error: unknown) => error);

    controller.abort();
    expect(capture.child?.signals).toEqual(['SIGTERM']);
    // O processo responde ao SIGTERM: não deve virar sucesso, e o SIGKILL é cancelado.
    late?.(null, 'tarde', '');

    await vi.advanceTimersByTimeAsync(500);
    expect(capture.child?.signals).toEqual(['SIGTERM']);
    const error = await settled;
    expect(error).toBeInstanceOf(SubprocessAbortedError);
  });

  it('sem abort, o listener não interfere no caminho feliz (exit 0 resolve o stdout)', async () => {
    const capture: ExecCapture = {};
    const exec = fakeExec(capture, (cb) => queueMicrotask(() => cb(null, 'ok', '')));
    const controller = new AbortController();

    const stdout = await runWithWatchdog(
      { bin: '/opt/bin', args: [], env: { PATH: '/bin' }, ...BASE, signal: controller.signal },
      { execFile: exec },
    );

    expect(stdout).toBe('ok');
    expect(capture.child?.signals).toEqual([]);
    expect(capture.child?.killed).toBe(false);
  });
});
