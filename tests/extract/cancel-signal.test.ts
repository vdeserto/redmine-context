/**
 * Testes unitários da FIAÇÃO do `AbortSignal` (#69/#73) do topo até cada runner de
 * subprocesso. Fecham o MAJOR-1 do gap analysis: antes o `signal` se perdia na
 * fronteira dos extratores e o cancelamento NÃO matava o ffmpeg/whisper/tesseract.
 *
 * Duas famílias de prova, todas HERMÉTICAS e determinísticas:
 *
 * 1. FIAÇÃO (threading): um runner INJETADO captura a invocação e asseguramos que
 *    ela carrega o MESMO `signal` recebido no topo — cobre a passagem
 *    `extract(options.signal)` → `run(invocation.signal)` de cada camada.
 * 2. KILL REAL: o runner DEFAULT (o `runWithWatchdog` de verdade) é exercitado com
 *    um `execFile` FAKE (nenhum subprocesso real). Ao abortar, provamos o `kill`
 *    espionado (`SIGTERM`) — o subprocesso é MORTO — e a extração degrada para
 *    `failed`. É a prova de que o abort chega ao watchdog e encerra o processo.
 *
 * O `execFile` fake, ao receber `SIGTERM`, "responde" (chama o callback) — o mesmo
 * comportamento de um processo que sai limpo no sinal — o que faz o watchdog settle
 * de imediato, sem depender do timer de graça (determinístico, sem fake timers).
 */

import { describe, expect, it, vi } from 'vitest';

// Mock do child_process: só os runners DEFAULT o usam (via runWithWatchdog e o
// execFile do tesseract). Os testes de FIAÇÃO passam seu próprio `run` e não o tocam.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { convertAudioToWav, type FfmpegInvocation } from '../../src/extract/audio.js';
import { AudioExtractor } from '../../src/extract/audio-extractor.js';
import { dispatchExtraction, ExtractorRegistry, type Extractor } from '../../src/extract/dispatcher.js';
import { TesseractExtractor } from '../../src/extract/tesseract.js';
import {
  extractVideoKeyframe,
  extractVideoTranscript,
  type KeyframeResult,
  type WavConversionResult,
} from '../../src/extract/video.js';
import { VideoExtractor } from '../../src/extract/video-extractor.js';
import { WhisperExtractor, type WhisperInvocation } from '../../src/extract/whisper-extract.js';

const mockExecFile = vi.mocked(execFile);

/** Callback do execFile na forma (error, stdout, stderr). */
type ExecCb = (error: Error | null, stdout: string, stderr: string) => void;

/** Child fake com `kill` espionável; ao receber um sinal, "responde" via o callback. */
interface FakeChild {
  kill: ReturnType<typeof vi.fn>;
}

/**
 * Stub do execFile DEFAULT: nunca chama o callback por conta própria (processo
 * "travado"), mas ao receber QUALQUER sinal de `kill` responde chamando o callback
 * — como um binário que sai ao SIGTERM. Assim o watchdog settle de imediato no
 * abort, provando o kill sem depender do timer de graça.
 */
function stubExecKillable(): FakeChild {
  let cb: ExecCb | undefined;
  const child: FakeChild = {
    kill: vi.fn((): boolean => {
      queueMicrotask(() => cb?.(null, '', ''));
      return true;
    }),
  };
  mockExecFile.mockImplementation(((...args: unknown[]): FakeChild => {
    cb = args[args.length - 1] as ExecCb;
    return child;
  }) as unknown as typeof execFile);
  return child;
}

const okConvert = (wavPath = '/cache/tmp/x.wav'): (() => Promise<WavConversionResult>) =>
  vi.fn(async () => ({ status: 'done', wavPath }));
const okKeyframe = async (): Promise<KeyframeResult> => ({ status: 'done', keyframePath: '/cache/att/kf.jpg' });

/** Transcritor fake que captura o `signal` recebido em `options`. */
function capturingTranscriber(sink: { signal?: AbortSignal }): Extractor {
  return {
    id: 'cap',
    version: 'v1',
    supportedMimes: ['audio/wav'],
    extract: vi.fn(async (_fp: string, opts) => {
      sink.signal = opts.signal;
      return { status: 'done', text: 'ok', mime: opts.mime } as const;
    }),
  };
}

describe('FIAÇÃO do signal ao runner (threading)', () => {
  it('convertAudioToWav repassa options.signal à invocação do ffmpeg', async () => {
    const controller = new AbortController();
    let captured: FfmpegInvocation | undefined;
    await convertAudioToWav('/cache/att/a.mp3', {
      findFfmpegBinary: () => '/opt/ffmpeg',
      tempDir: '/cache/tmp',
      mkdir: async () => undefined,
      run: async (invocation) => {
        captured = invocation;
      },
      signal: controller.signal,
    });
    expect(captured?.signal).toBe(controller.signal);
  });

  it('WhisperExtractor.extract repassa options.signal à invocação do whisper', async () => {
    const controller = new AbortController();
    let captured: WhisperInvocation | undefined;
    const extractor = new WhisperExtractor({
      binaryPath: '/opt/whisper',
      modelPath: '/cache/models/ggml-tiny.bin',
      version: 'whisper-integration-1',
      run: async (invocation) => {
        captured = invocation;
        return 'texto';
      },
    });

    await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav', signal: controller.signal });
    expect(captured?.signal).toBe(controller.signal);
  });

  it('extractVideoKeyframe repassa options.signal à invocação do ffmpeg', async () => {
    const controller = new AbortController();
    let captured: FfmpegInvocation | undefined;
    await extractVideoKeyframe('/cache/att/v.mp4', {
      findFfmpegBinary: () => '/opt/ffmpeg',
      outputPath: '/cache/att/kf.jpg',
      mkdir: async () => undefined,
      run: async (invocation) => {
        captured = invocation;
      },
      signal: controller.signal,
    });
    expect(captured?.signal).toBe(controller.signal);
  });

  it('extractVideoTranscript fia o signal ao transcritor (whisper) do pipeline', async () => {
    const controller = new AbortController();
    const sink: { signal?: AbortSignal } = {};
    await extractVideoTranscript('/cache/att/v.mp4', {
      transcriber: capturingTranscriber(sink),
      convert: async (): Promise<WavConversionResult> => ({ status: 'done', wavPath: '/cache/tmp/v.wav' }),
      extractKeyframe: okKeyframe,
      probeDuration: async () => ({ status: 'ok', seconds: 5 }),
      rm: async () => undefined,
      signal: controller.signal,
    });
    expect(sink.signal).toBe(controller.signal);
  });

  it('AudioExtractor fia o signal ao transcritor whisper', async () => {
    const controller = new AbortController();
    const sink: { signal?: AbortSignal } = {};
    const extractor = new AudioExtractor({
      transcriber: capturingTranscriber(sink),
      convert: okConvert('/cache/tmp/a.wav'),
      rm: async () => undefined,
    });

    await extractor.extract('/cache/att/a.mp3', { mime: 'audio/wav', signal: controller.signal });
    expect(sink.signal).toBe(controller.signal);
  });

  it('AudioExtractor fia o signal ao ffmpeg da conversão DEFAULT (convertOptions.run)', async () => {
    const controller = new AbortController();
    let convertSignal: AbortSignal | undefined;
    const extractor = new AudioExtractor({
      transcriber: capturingTranscriber({}),
      convertOptions: {
        findFfmpegBinary: () => '/opt/ffmpeg',
        tempDir: '/cache/tmp',
        mkdir: async () => undefined,
        run: async (invocation) => {
          convertSignal = invocation.signal;
        },
      },
    });

    await extractor.extract('/cache/att/a.mp3', { mime: 'audio/wav', signal: controller.signal });
    expect(convertSignal).toBe(controller.signal);
  });

  it('VideoExtractor fia o signal ao pipeline (transcritor)', async () => {
    const controller = new AbortController();
    const sink: { signal?: AbortSignal } = {};
    const extractor = new VideoExtractor({
      transcriber: capturingTranscriber(sink),
      pipeline: {
        convert: async (): Promise<WavConversionResult> => ({ status: 'done', wavPath: '/cache/tmp/v.wav' }),
        extractKeyframe: okKeyframe,
        probeDuration: async () => ({ status: 'ok', seconds: 5 }),
        rm: async () => undefined,
      },
    });

    await extractor.extract('/cache/att/v.mp4', { mime: 'video/mp4', signal: controller.signal });
    expect(sink.signal).toBe(controller.signal);
  });

  it('dispatchExtraction repassa o signal ao extractor.extract', async () => {
    const controller = new AbortController();
    const sink: { signal?: AbortSignal } = {};
    const dir = mkdtempSync(join(tmpdir(), 'rc-dispatch-signal-'));
    const filePath = join(dir, 'img.png');
    // PNG magic bytes → o dispatcher roteia para um extrator de image/png.
    writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const registry = new ExtractorRegistry().register({
      id: 'cap-png',
      version: 'v1',
      supportedMimes: ['image/png'],
      extract: vi.fn(async (_fp: string, opts) => {
        sink.signal = opts.signal;
        return { status: 'done', text: '', mime: opts.mime } as const;
      }),
    });

    await dispatchExtraction(filePath, { registry, signal: controller.signal });
    expect(sink.signal).toBe(controller.signal);
  });
});

describe('KILL REAL: abortar mata o subprocesso via runWithWatchdog (runner DEFAULT)', () => {
  it('ffmpeg (convertAudioToWav): abort → SIGTERM no child, resultado failed', async () => {
    const child = stubExecKillable();
    const controller = new AbortController();
    controller.abort();

    const result = await convertAudioToWav('/cache/att/a.mp3', {
      findFfmpegBinary: () => '/opt/ffmpeg',
      tempDir: '/cache/tmp',
      mkdir: async () => undefined,
      rm: async () => undefined,
      killGraceMs: 5,
      signal: controller.signal,
    });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.status).toBe('failed');
  });

  it('whisper (WhisperExtractor): abort → SIGTERM no child, resultado failed', async () => {
    const child = stubExecKillable();
    const controller = new AbortController();
    controller.abort();
    const extractor = new WhisperExtractor({
      binaryPath: '/opt/whisper',
      modelPath: '/cache/models/ggml-tiny.bin',
      version: 'whisper-integration-1',
      killGraceMs: 5,
    });

    const result = await extractor.extract('/cache/tmp/a.wav', { mime: 'audio/wav', signal: controller.signal });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('erro-transcricao');
  });

  it('tesseract (TesseractExtractor): abort → SIGTERM no child, resultado failed', async () => {
    const child = stubExecKillable();
    const controller = new AbortController();
    controller.abort();
    const extractor = new TesseractExtractor({
      binaryPath: '/opt/tesseract',
      version: 'tesseract-integration-1',
      killGraceMs: 5,
    });

    const result = await extractor.extract('/cache/att/img.png', { mime: 'image/png', signal: controller.signal });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.status).toBe('failed');
  });

  it('ffmpeg (keyframe): abort → SIGTERM no child, resultado failed', async () => {
    const child = stubExecKillable();
    const controller = new AbortController();
    controller.abort();

    const result = await extractVideoKeyframe('/cache/att/v.mp4', {
      findFfmpegBinary: () => '/opt/ffmpeg',
      outputPath: '/cache/att/kf.jpg',
      mkdir: async () => undefined,
      rm: async () => undefined,
      killGraceMs: 5,
      signal: controller.signal,
    });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.status).toBe('failed');
  });
});
