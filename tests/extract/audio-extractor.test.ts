/**
 * Testes unitários do extrator de ÁUDIO (M4-14, #73, ADR-002). HERMÉTICOS: a
 * conversão áudio→WAV e o transcritor whisper são INJETADOS — nenhum ffmpeg/whisper
 * real, nenhum FS real é tocado.
 *
 * Provam o encadeamento conversão → transcrição: converte o áudio cru, passa o WAV
 * ao whisper e devolve a transcrição; falha de conversão curto-circuita (whisper
 * não é chamado); whisper que lança degrada gracioso; o WAV intermediário é sempre
 * removido; e a identidade de cache (`version`/`model`/`params`) é a do whisper.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ExtractionResult } from '../../src/contract.js';
import type { WavConversionResult } from '../../src/extract/audio.js';
import { AudioExtractor, AUDIO_MIMES, createAudioExtractor } from '../../src/extract/audio-extractor.js';
import type { Extractor } from '../../src/extract/dispatcher.js';
import { WhisperExtractor } from '../../src/extract/whisper-extract.js';

const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';
const MODEL_PATH = '/cache/models/ggml-tiny.bin';

/** WhisperExtractor real com o subprocesso (`run`) espionado — sem whisper real. */
function whisperWith(run: (args: readonly string[]) => Promise<string>): WhisperExtractor {
  return new WhisperExtractor({
    binaryPath: WHISPER_BIN,
    modelPath: MODEL_PATH,
    version: 'whisper-integration-1',
    run: async (invocation) => run(invocation.args),
  });
}

/** Conversão stub bem-sucedida: devolve um wavPath fixo sem tocar o FS. */
const okConvert = (wavPath = '/cache/tmp/out.wav'): ((input: string) => Promise<WavConversionResult>) =>
  vi.fn(async () => ({ status: 'done', wavPath }));

describe('AudioExtractor.extract: encadeamento conversão → transcrição', () => {
  it('converte o áudio cru e transcreve o WAV resultante (done com o texto)', async () => {
    const convert = okConvert('/cache/tmp/a.wav');
    const whisperRun = vi.fn(async () => 'transcricao do audio\n');
    const rm = vi.fn(async () => undefined);
    const extractor = new AudioExtractor({
      transcriber: whisperWith(whisperRun),
      convert,
      rm,
    });

    const result = await extractor.extract('/cache/att/voice.mp3', { mime: 'audio/mpeg' });

    expect(result.status).toBe('done');
    expect(result.text).toBe('transcricao do audio');
    expect(result.mime).toBe('audio/mpeg');
    expect(convert).toHaveBeenCalledWith('/cache/att/voice.mp3');
    // O whisper recebeu o WAV da conversão, não o mp3 cru.
    expect(whisperRun).toHaveBeenCalledOnce();
    expect(whisperRun.mock.calls[0]?.[0]).toContain('/cache/tmp/a.wav');
    // WAV intermediário removido (best-effort).
    expect(rm).toHaveBeenCalledWith('/cache/tmp/a.wav');
  });

  it('conversão falha (ffmpeg ausente) → failed com o motivo; whisper NÃO é chamado', async () => {
    const convert = vi.fn(
      async (): Promise<WavConversionResult> => ({
        status: 'failed',
        reason: 'ffmpeg-nao-instalado',
        hint: 'instale o ffmpeg',
      }),
    );
    const whisperRun = vi.fn(async () => 'nunca');
    const extractor = new AudioExtractor({ transcriber: whisperWith(whisperRun), convert, rm: async () => undefined });

    const result = await extractor.extract('/cache/att/voice.m4a', { mime: 'audio/mp4' });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('ffmpeg-nao-instalado');
    expect(result.metadata?.hint).toBe('instale o ffmpeg');
    expect(result.mime).toBe('audio/mp4');
    expect(whisperRun).not.toHaveBeenCalled();
  });

  it('conversão com erro genérico → failed preservando reason E error (sem hint)', async () => {
    const convert = vi.fn(
      async (): Promise<WavConversionResult> => ({
        status: 'failed',
        reason: 'erro-conversao',
        error: 'ffmpeg exit 1: invalid data',
      }),
    );
    const extractor = new AudioExtractor({
      transcriber: whisperWith(async () => 'nunca'),
      convert,
      rm: async () => undefined,
    });

    const result = await extractor.extract('/cache/att/corrompido.mp3', { mime: 'audio/mpeg' });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('erro-conversao');
    expect(String(result.metadata?.error)).toContain('invalid data');
    expect(result.metadata?.hint).toBeUndefined();
  });

  it('whisper que LANÇA não derruba o extrator → failed gracioso; WAV é removido', async () => {
    const rm = vi.fn(async () => undefined);
    const transcriber: Extractor = {
      id: 'boom',
      version: 'v1',
      supportedMimes: AUDIO_MIMES,
      extract: vi.fn(async (): Promise<ExtractionResult> => {
        throw new Error('whisper explodiu');
      }),
    };
    const extractor = new AudioExtractor({ transcriber, convert: okConvert('/cache/tmp/x.wav'), rm });

    const result = await extractor.extract('/cache/att/a.ogg', { mime: 'audio/ogg' });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('erro-transcricao');
    expect(String(result.metadata?.error)).toContain('whisper explodiu');
    expect(rm).toHaveBeenCalledWith('/cache/tmp/x.wav');
  });

  it('repassa o logger à conversão default quando nenhuma convert é injetada (sem lançar)', async () => {
    // Sem `convert` injetado, cai no ffmpeg real: como não há binário no ambiente de
    // teste, degrada para failed(ffmpeg-nao-instalado) — prova o caminho default.
    const logger = { warn: vi.fn() };
    const extractor = new AudioExtractor({
      transcriber: whisperWith(async () => 'x'),
      convertOptions: { findFfmpegBinary: () => undefined },
    });

    const result = await extractor.extract('/cache/att/a.wav', { mime: 'audio/wav', logger });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('ffmpeg-nao-instalado');
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('AudioExtractor: identidade de cache delegada ao whisper (ADR-004)', () => {
  it('version/model/params espelham o transcritor whisper', () => {
    const transcriber = new WhisperExtractor({
      binaryPath: WHISPER_BIN,
      modelPath: MODEL_PATH,
      version: 'whisper-integration-1',
      language: 'pt',
    });
    const extractor = new AudioExtractor({ transcriber });

    expect(extractor.version).toBe(transcriber.version);
    expect(extractor.model).toBe(transcriber.model); // basename do GGUF
    expect(extractor.params).toEqual({ language: 'pt' });
  });

  it('transcritor sem model/params → cai no id estável e params vazio', () => {
    const transcriber: Extractor = {
      id: 'x',
      version: 'v9',
      supportedMimes: AUDIO_MIMES,
      extract: async () => ({ status: 'done' }),
    };
    const extractor = createAudioExtractor({ transcriber });

    expect(extractor.version).toBe('v9');
    expect(extractor.model).toBe('audio-transcribe');
    expect(extractor.params).toEqual({});
  });

  it('declara os MIMEs de áudio e o id estável', () => {
    const extractor = createAudioExtractor({ transcriber: whisperWith(async () => 'x') });
    expect(extractor.id).toBe('audio-transcribe');
    expect(extractor.supportedMimes).toContain('audio/mpeg');
    expect(extractor.supportedMimes).toContain('audio/wav');
    expect(extractor.supportedMimes).toContain('audio/mp4');
  });
});
