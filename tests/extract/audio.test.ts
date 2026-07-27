/**
 * Testes unitários da conversão áudio → WAV 16 kHz mono via ffmpeg (M4-04, #60,
 * ADR-002). Escritos ANTES da implementação (TDD). HERMÉTICOS: o executor de
 * subprocesso, o localizador do ffmpeg, o dir temp e o `mkdir` são INJETADOS —
 * nenhum ffmpeg real, nenhum filesystem real é tocado aqui (o teste de
 * integração REAL vive em `audio.integration.test.ts`, opt-in).
 *
 * Provam: os args do spawn incluem `-protocol_whitelist file` e `-ar 16000 -ac 1`
 * (asserção explícita, ADR-002); o WAV é gravado no dir TEMP do cache; env
 * SANITIZADO (sem `REDMINE_API_KEY`); ffmpeg ausente → `failed` sem lançar; exit
 * != 0 → `failed` com motivo; timeout → `failed` com reason `timeout`.
 */

import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock do child_process (só o runner DEFAULT o usa) e do fs/promises (mkdir
// default). Os testes por INJEÇÃO passam seu próprio `run`/`mkdir` e não os tocam.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(async () => undefined), rm: vi.fn(async () => undefined) }));

import { execFile } from 'node:child_process';

import {
  audioTempDir,
  convertAudioToWav,
  type FfmpegInvocation,
} from '../../src/extract/audio.js';

const mockExecFile = vi.mocked(execFile);

/** Child fake com `kill` espionável, devolvido pelo mock de execFile. */
interface FakeChild {
  kill: ReturnType<typeof vi.fn>;
}

/** Callback do execFile na forma (error, stdout, stderr). */
type ExecCb = (error: Error | null, stdout: string, stderr: string) => void;

/** Configura o execFile mockado a chamar o callback via `behavior`; devolve o child. */
function stubExec(behavior: (cb: ExecCb) => void): FakeChild {
  const child: FakeChild = { kill: vi.fn() };
  mockExecFile.mockImplementation(((...args: unknown[]): FakeChild => {
    behavior(args[args.length - 1] as ExecCb);
    return child;
  }) as unknown as typeof execFile);
  return child;
}

/** Última chamada de execFile (file, args, options) para asserção. */
function lastExecCall(): { file: string; args: string[]; options: { env?: NodeJS.ProcessEnv } } {
  const call = mockExecFile.mock.calls.at(-1);
  if (call === undefined) throw new Error('execFile não foi chamado');
  return {
    file: call[0] as string,
    args: call[1] as string[],
    options: call[2] as { env?: NodeJS.ProcessEnv },
  };
}

/** Captura a invocação passada ao runner injetado para asserção dos args/env. */
interface Captured {
  invocation?: FfmpegInvocation;
}

/**
 * Monta options herméticas: binário fixo, `mkdir` no-op (sem FS), tempDir fake e
 * um runner que captura a invocação e resolve/rejeita conforme `behavior`.
 */
function hermeticOptions(
  captured: Captured,
  behavior: (invocation: FfmpegInvocation) => Promise<void>,
  overrides: { readonly binary?: string | undefined; readonly tempDir?: string } = {},
): Parameters<typeof convertAudioToWav>[1] {
  return {
    findFfmpegBinary: () => ('binary' in overrides ? overrides.binary : '/opt/homebrew/bin/ffmpeg'),
    tempDir: overrides.tempDir ?? '/cache/tmp',
    mkdir: async () => undefined,
    run: async (invocation) => {
      captured.invocation = invocation;
      await behavior(invocation);
    },
  };
}

/** Índice do valor imediatamente após uma flag nos args (ou -1 se ausente). */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

describe('convertAudioToWav: sucesso e argumentos do ffmpeg', () => {
  it('invoca o runner SEM shell com -protocol_whitelist file e -ar 16000 -ac 1, gravando o WAV no tempDir', async () => {
    const captured: Captured = {};
    const result = await convertAudioToWav(
      '/cache/att/original.mp3',
      hermeticOptions(captured, async () => undefined),
    );

    expect(result.status).toBe('done');
    if (result.status !== 'done') throw new Error('esperava done');

    const args = captured.invocation?.args ?? [];
    // ADR-002: whitelist de protocolo obrigatória (asserção explícita nos args).
    expect(valueAfter(args, '-protocol_whitelist')).toBe('file');
    // Segurança: a whitelist é opção de INPUT — DEVE preceder o `-i` para valer
    // sobre o arquivo de entrada (senão o ffmpeg poderia abrir protocolos remotos).
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(args.indexOf('-i'));
    // 16 kHz mono, formato WAV PCM (o que o whisper.cpp espera).
    expect(valueAfter(args, '-ar')).toBe('16000');
    expect(valueAfter(args, '-ac')).toBe('1');
    expect(valueAfter(args, '-c:a')).toBe('pcm_s16le');
    expect(valueAfter(args, '-f')).toBe('wav');
    expect(valueAfter(args, '-i')).toBe('/cache/att/original.mp3');

    // O último arg é o caminho de saída, dentro do dir TEMP do cache, .wav, e
    // coincide EXATAMENTE com o wavPath devolvido.
    const output = args.at(-1) ?? '';
    // Produção computa join(tempDir, '<uuid>.wav'); compara o prefixo com join
    // para casar o separador do SO (`\cache\tmp` no Windows, `/cache/tmp` no POSIX).
    expect(output.startsWith(join('/cache/tmp'))).toBe(true);
    expect(output.endsWith('.wav')).toBe(true);
    expect(result.wavPath).toBe(output);
  });

  it('SANITIZA o env do subprocesso: repassa PATH mas NUNCA segredos do pai', async () => {
    const previous = process.env.REDMINE_API_KEY;
    process.env.REDMINE_API_KEY = 'super-secreto';
    try {
      const captured: Captured = {};
      await convertAudioToWav('/cache/x.mp3', hermeticOptions(captured, async () => undefined));

      const env = captured.invocation?.env ?? {};
      expect(env.PATH).toBeDefined();
      expect(env.REDMINE_API_KEY).toBeUndefined();
      expect(Object.keys(env)).not.toContain('REDMINE_API_KEY');
    } finally {
      if (previous === undefined) delete process.env.REDMINE_API_KEY;
      else process.env.REDMINE_API_KEY = previous;
    }
  });

  it('cria o dir TEMP antes de invocar o ffmpeg (mkdir recursivo)', async () => {
    const mkdir = vi.fn(async () => undefined);
    const run = vi.fn(async () => undefined);
    const result = await convertAudioToWav('/cache/x.mp3', {
      findFfmpegBinary: () => '/opt/ffmpeg',
      tempDir: '/cache/tmp',
      mkdir,
      run,
    });

    expect(result.status).toBe('done');
    expect(mkdir).toHaveBeenCalledWith('/cache/tmp');
    expect(mkdir).toHaveBeenCalledBefore(run);
  });
});

describe('convertAudioToWav: degradação graciosa', () => {
  it('ffmpeg ausente (binário undefined) → failed com motivo de instalação, avisa e NÃO invoca o runner', async () => {
    const run = vi.fn(async () => undefined);
    const logger = { warn: vi.fn() };

    const result = await convertAudioToWav('/cache/x.mp3', {
      findFfmpegBinary: () => undefined,
      run,
      mkdir: async () => undefined,
      logger,
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('ffmpeg-nao-instalado');
    expect(result.hint).toBeDefined();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('exit != 0 do ffmpeg → failed com reason erro-conversao e a mensagem de erro', async () => {
    const captured: Captured = {};
    const result = await convertAudioToWav(
      '/cache/x.mp3',
      hermeticOptions(captured, async () => {
        throw new Error('ffmpeg exit 1: Invalid data found');
      }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('erro-conversao');
    expect(result.error).toContain('Invalid data found');
  });

  it('timeout do runner → failed com reason timeout (não quebra o bundle)', async () => {
    const captured: Captured = {};
    const result = await convertAudioToWav(
      '/cache/x.mp3',
      hermeticOptions(captured, async () => {
        // Simula o watchdog: runner rejeita sinalizando timeout via nome do erro.
        const err = new Error('ffmpeg excedeu o timeout de 1000ms e foi encerrado');
        err.name = 'FfmpegTimeoutError';
        throw err;
      }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('timeout');
  });

  it('remove o WAV parcial (best-effort) quando a conversão falha — não deixa lixo no cache', async () => {
    const rm = vi.fn(async () => undefined);
    let outputPath = '';
    const result = await convertAudioToWav('/cache/x.mp3', {
      findFfmpegBinary: () => '/opt/ffmpeg',
      tempDir: '/cache/tmp',
      mkdir: async () => undefined,
      rm,
      run: async (invocation) => {
        outputPath = invocation.args.at(-1) ?? '';
        throw new Error('ffmpeg exit 1');
      },
    });

    expect(result.status).toBe('failed');
    // O `.wav` parcial gerado pelo `-y` é descartado com o MESMO caminho de saída.
    expect(rm).toHaveBeenCalledWith(outputPath);
    expect(outputPath.endsWith('.wav')).toBe(true);
  });

  it('falha ao remover o WAV parcial não mascara o erro original (rm é best-effort)', async () => {
    const rm = vi.fn(async () => {
      throw new Error('EACCES');
    });
    const result = await convertAudioToWav('/cache/x.mp3', {
      findFfmpegBinary: () => '/opt/ffmpeg',
      tempDir: '/cache/tmp',
      mkdir: async () => undefined,
      rm,
      run: async () => {
        throw new Error('ffmpeg exit 1: boom');
      },
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('erro-conversao');
    expect(result.error).toContain('boom');
  });
});

describe('convertAudioToWav: runner DEFAULT (execFile real, binário mockado)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('sucesso (exit 0): execFile SEM shell com args corretos, env sanitizado, e status done', async () => {
    const previous = process.env.REDMINE_API_KEY;
    process.env.REDMINE_API_KEY = 'segredo';
    try {
      stubExec((cb) => queueMicrotask(() => cb(null, '', '')));
      const result = await convertAudioToWav('/cache/x.mp3', {
        findFfmpegBinary: () => '/opt/ffmpeg',
        tempDir: '/cache/tmp',
      });

      expect(result.status).toBe('done');
      const { file, args, options } = lastExecCall();
      expect(file).toBe('/opt/ffmpeg');
      expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file');
      expect(args[args.indexOf('-ar') + 1]).toBe('16000');
      expect(args[args.indexOf('-ac') + 1]).toBe('1');
      expect(options.env?.PATH).toBeDefined();
      expect(options.env?.REDMINE_API_KEY).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.REDMINE_API_KEY;
      else process.env.REDMINE_API_KEY = previous;
    }
  });

  it('exit != 0: erro do execFile → failed com reason erro-conversao', async () => {
    stubExec((cb) => queueMicrotask(() => cb(new Error('Invalid data'), '', '')));
    const result = await convertAudioToWav('/cache/x.mp3', {
      findFfmpegBinary: () => '/opt/ffmpeg',
      tempDir: '/cache/tmp',
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('erro-conversao');
  });

  it('timeout: watchdog envia SIGTERM e, após a graça, SIGKILL; resultado failed/timeout', async () => {
    vi.useFakeTimers();
    const child = stubExec(() => undefined); // ffmpeg travado: nunca chama o cb
    const promise = convertAudioToWav('/cache/x.mp3', {
      findFfmpegBinary: () => '/opt/ffmpeg',
      tempDir: '/cache/tmp',
      timeoutMs: 1_000,
      killGraceMs: 500,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    const result = await promise;
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('timeout');
  });
});

describe('audioTempDir', () => {
  it('deriva um caminho absoluto dentro do cache do app (redmine-context)', () => {
    const dir = audioTempDir();
    expect(dir).toContain('redmine-context');
  });
});
