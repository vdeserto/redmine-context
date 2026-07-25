/**
 * Testes unitários do extrator de transcrição whisper.cpp (M4-05, #61, ADR-002).
 * Escritos ANTES da implementação (TDD). HERMÉTICOS: o executor do subprocesso, o
 * localizador do binário e o do modelo GGUF são INJETADOS — nenhum whisper real,
 * nenhum modelo/FS real é tocado aqui (o teste de integração REAL, opt-in por
 * `WHISPER_INTEGRATION`, vive em `whisper-extract.integration.test.ts`).
 *
 * Provam: os args do spawn são `-m <modelo GGUF> -f <wav> -nt` SEM shell (asserção
 * explícita, ADR-002); env SANITIZADO (sem `REDMINE_API_KEY`); binário ausente →
 * `failed` sem lançar; modelo GGUF ausente → `failed` com motivo gracioso; timeout
 * → `SIGTERM`+`SIGKILL` → `failed` reason `timeout`; erro de execução → `failed`; a
 * saída conhecida do whisper.cpp é parseada em `{ text }` (o texto derivado é o que
 * o bundle marca UNTRUSTED); parse resiliente a timestamps.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock do child_process: só o runner DEFAULT o usa. Os testes por INJEÇÃO passam
// seu próprio `run` e não tocam este mock.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'node:child_process';

import {
  WhisperExtractor,
  createWhisperExtractor,
  parseWhisperOutput,
  WHISPER_MIMES,
  type WhisperInvocation,
} from '../../src/extract/whisper-extract.js';

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

/** Captura a invocação passada ao runner injetado para asserção de args/env. */
interface Captured {
  invocation?: WhisperInvocation;
}

/** Options herméticas com binário e modelo fixos e um runner que captura + responde. */
function hermetic(
  captured: Captured,
  behavior: (invocation: WhisperInvocation) => Promise<string>,
  overrides: { readonly binaryPath?: string | undefined; readonly modelPath?: string | undefined } = {},
): WhisperExtractor {
  return new WhisperExtractor({
    binaryPath: 'binaryPath' in overrides ? overrides.binaryPath : '/opt/homebrew/bin/whisper-cli',
    modelPath: 'modelPath' in overrides ? overrides.modelPath : '/cache/models/ggml-tiny.bin',
    version: 'whisper-integration-1',
    run: async (invocation) => {
      captured.invocation = invocation;
      return behavior(invocation);
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('WhisperExtractor.extract: sucesso e argumentos', () => {
  it('invoca o runner com -m <modelo GGUF> -f <wav> -nt e devolve done com o texto', async () => {
    const captured: Captured = {};
    const extractor = hermetic(captured, async () => 'Olá mundo, isto é um teste.\n');

    const result = await extractor.extract('/cache/tmp/audio.wav', { mime: 'audio/wav' });

    expect(result.status).toBe('done');
    expect(result.text).toBe('Olá mundo, isto é um teste.');
    expect(result.mime).toBe('audio/wav');
    expect(result.metadata?.extractorId).toBe('whisper-transcribe');

    const args = captured.invocation?.args ?? [];
    expect(args).toEqual(['-m', '/cache/models/ggml-tiny.bin', '-f', '/cache/tmp/audio.wav', '-nt']);
    // ADR-002 / #62: idioma NÃO é forçado aqui (auto-detect é o default do whisper).
    expect(args).not.toContain('-l');
    expect(args).not.toContain('--language');
  });

  it('o texto transcrito é exposto em `text` — é o conteúdo que o bundle marca UNTRUSTED', async () => {
    const captured: Captured = {};
    const extractor = hermetic(captured, async () => 'conteúdo derivado do áudio');

    const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav' });

    // O extrator NÃO reembrulha: expõe `text` cru; a fence <untrusted-content> /
    // `{untrusted:true}` é aplicada pela camada bundle (src/bundle/json.ts) sobre
    // `result.text`, igual ao tesseract. Aqui garantimos que há `text` para marcar.
    expect(result.status).toBe('done');
    expect(typeof result.text).toBe('string');
    expect(result.text).toBe('conteúdo derivado do áudio');
  });
});

describe('WhisperExtractor.extract: falhas graciosas', () => {
  it('binário ausente → failed com reason whisper-nao-instalado, avisa e NÃO chama o runner', async () => {
    const captured: Captured = {};
    const runner = vi.fn(async () => 'nunca');
    const extractor = new WhisperExtractor({
      binaryPath: undefined,
      modelPath: '/cache/models/ggml-tiny.bin',
      version: 'whisper-integration-1',
      run: runner,
    });
    const logger = { warn: vi.fn() };

    const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav', logger });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('whisper-nao-instalado');
    expect(result.metadata?.hint).toBeDefined();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(runner).not.toHaveBeenCalled();
    expect(captured.invocation).toBeUndefined();
  });

  it('modelo GGUF ausente → failed com reason modelo-nao-encontrado, avisa e NÃO chama o runner', async () => {
    const runner = vi.fn(async () => 'nunca');
    const extractor = new WhisperExtractor({
      binaryPath: '/opt/homebrew/bin/whisper-cli',
      modelPath: undefined,
      version: 'whisper-integration-1',
      run: runner,
    });
    const logger = { warn: vi.fn() };

    const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav', logger });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('modelo-nao-encontrado');
    expect(result.metadata?.hint).toBeDefined();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(runner).not.toHaveBeenCalled();
  });

  it('erro de execução (runner rejeita) → failed com reason erro-transcricao', async () => {
    const captured: Captured = {};
    const extractor = hermetic(captured, async () => {
      throw new Error('exit 1: boom');
    });

    const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav' });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('erro-transcricao');
    expect(result.metadata?.error).toContain('exit 1');
  });

  it('timeout (runner rejeita com erro nomeado WhisperTimeoutError) → failed com reason timeout', async () => {
    const captured: Captured = {};
    const extractor = hermetic(captured, async () => {
      const err = new Error('estourou');
      err.name = 'WhisperTimeoutError';
      throw err;
    });

    const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav' });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('timeout');
  });
});

describe('parseWhisperOutput', () => {
  it('junta as linhas de texto da transcrição e faz trim', () => {
    expect(parseWhisperOutput('  Primeira linha.\nSegunda linha.\n')).toBe('Primeira linha. Segunda linha.');
  });

  it('é resiliente a timestamps do whisper.cpp: remove o prefixo [hh:mm:ss --> hh:mm:ss]', () => {
    const raw =
      '[00:00:00.000 --> 00:00:02.000]   And so my fellow Americans\n' +
      '[00:00:02.000 --> 00:00:05.000]   ask not what your country can do for you\n';
    expect(parseWhisperOutput(raw)).toBe(
      'And so my fellow Americans ask not what your country can do for you',
    );
  });

  it('saída vazia/em branco → string vazia', () => {
    expect(parseWhisperOutput('   \n\n  ')).toBe('');
  });
});

describe('WhisperExtractor: runner DEFAULT (execFile sem shell, env sanitizado, watchdog)', () => {
  it('SANITIZA o env: repassa PATH mas NUNCA segredos do pai; roda execFile sem shell e devolve o texto', async () => {
    const previous = process.env.REDMINE_API_KEY;
    process.env.REDMINE_API_KEY = 'super-secreto';
    try {
      stubExec((cb) => queueMicrotask(() => cb(null, 'transcricao ok\n', '')));
      const extractor = new WhisperExtractor({
        binaryPath: '/opt/whisper-cli',
        modelPath: '/cache/models/ggml-tiny.bin',
        version: 'whisper-integration-1',
      });

      const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav' });

      expect(result.status).toBe('done');
      expect(result.text).toBe('transcricao ok');

      const { file, args, options } = lastExecCall();
      expect(file).toBe('/opt/whisper-cli');
      expect(args).toEqual(['-m', '/cache/models/ggml-tiny.bin', '-f', '/cache/tmp/a.wav', '-nt']);
      const env = options.env ?? {};
      expect(env.PATH).toBeDefined();
      expect(env.REDMINE_API_KEY).toBeUndefined();
      expect(Object.keys(env)).not.toContain('REDMINE_API_KEY');
    } finally {
      if (previous === undefined) delete process.env.REDMINE_API_KEY;
      else process.env.REDMINE_API_KEY = previous;
    }
  });

  it('timeout → SIGTERM e, após a graça, SIGKILL; resultado failed com reason timeout', async () => {
    vi.useFakeTimers();
    const child = stubExec(() => undefined); // nunca chama o callback: whisper travado
    const extractor = new WhisperExtractor({
      binaryPath: '/opt/whisper-cli',
      modelPath: '/cache/models/ggml-tiny.bin',
      version: 'whisper-integration-1',
      timeoutMs: 1_000,
      killGraceMs: 500,
    });

    const promise = extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav' });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    const result = await promise;
    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('timeout');
  });
});

describe('createWhisperExtractor (composição com localizadores injetáveis)', () => {
  it('resolve binário e modelo via localizadores injetados e transcreve com o runner dado', async () => {
    const captured: Captured = {};
    const extractor = await createWhisperExtractor({
      findBinary: () => '/opt/homebrew/bin/whisper-cli',
      findModel: () => '/cache/models/ggml-tiny.bin',
      run: async (invocation) => {
        captured.invocation = invocation;
        return 'ok';
      },
    });

    expect(extractor.version).toBe('whisper-integration-1');
    const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav' });
    expect(result.status).toBe('done');
    expect(captured.invocation?.bin).toBe('/opt/homebrew/bin/whisper-cli');
    expect(captured.invocation?.args).toContain('/cache/models/ggml-tiny.bin');
  });

  it('binário não instalado → extract degrada para failed whisper-nao-instalado', async () => {
    const extractor = await createWhisperExtractor({
      findBinary: () => undefined,
      findModel: () => '/cache/models/ggml-tiny.bin',
    });
    const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav' });
    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('whisper-nao-instalado');
  });

  it('modelo GGUF ausente do cache → extract degrada para failed modelo-nao-encontrado', async () => {
    const extractor = await createWhisperExtractor({
      findBinary: () => '/opt/homebrew/bin/whisper-cli',
      findModel: () => undefined,
    });
    const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav' });
    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('modelo-nao-encontrado');
  });

  it('declara os MIMEs de áudio suportados e o model lógico para a chave de cache', () => {
    expect(WHISPER_MIMES).toContain('audio/wav');
    expect(WHISPER_MIMES).toContain('audio/mpeg');
  });
});
