/**
 * Testes unitários do adaptador de VÍDEO ao contrato Extractor (M4-14, #73). HERMÉTICOS:
 * transcritor whisper, conversão, sonda de duração e keyframe são INJETADOS — nenhum
 * ffmpeg/whisper real. Provam que o extrator delega ao pipeline `extractVideoTranscript`
 * repassando `mime`/`logger`, devolve a transcrição + o keyframe como artifact, degrada
 * (vídeo sem áudio / duração acima do limite) e herda a identidade de cache do whisper.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ExtractionResult } from '../../src/contract.js';
import type { WavConversionResult } from '../../src/extract/audio.js';
import type { Extractor } from '../../src/extract/dispatcher.js';
import type { DurationProbeResult, KeyframeResult } from '../../src/extract/video.js';
import { VideoExtractor, createVideoExtractor } from '../../src/extract/video-extractor.js';
import { WhisperExtractor } from '../../src/extract/whisper-extract.js';

const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';
const MODEL_PATH = '/cache/models/ggml-base.bin';

const withinLimit = async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 5 });
const okKeyframe = async (): Promise<KeyframeResult> => ({ status: 'done', keyframePath: '/cache/att/keyframe.jpg' });
const okConvert = (wavPath = '/cache/tmp/v.wav'): (() => Promise<WavConversionResult>) =>
  vi.fn(async () => ({ status: 'done', wavPath }));

/** WhisperExtractor real com o subprocesso espionado. */
function whisperWith(run: () => Promise<string>): WhisperExtractor {
  return new WhisperExtractor({
    binaryPath: WHISPER_BIN,
    modelPath: MODEL_PATH,
    version: 'whisper-integration-1',
    run,
  });
}

describe('VideoExtractor.extract: delega ao pipeline vídeo→áudio→whisper', () => {
  it('converte, transcreve e devolve done com o texto + keyframe como artifact', async () => {
    const extractor = new VideoExtractor({
      transcriber: whisperWith(async () => 'transcricao do video\n'),
      pipeline: {
        convert: okConvert('/cache/tmp/v.wav'),
        probeDuration: withinLimit,
        extractKeyframe: okKeyframe,
        rm: async () => undefined,
      },
    });

    const result = await extractor.extract('/cache/att/screencast.mp4', { mime: 'video/mp4' });

    expect(result.status).toBe('done');
    expect(result.text).toBe('transcricao do video');
    expect(result.mime).toBe('video/mp4');
    // Keyframe referenciado como artifact (não embutido).
    expect(result.artifacts?.[0]).toEqual({
      kind: 'keyframe',
      path: '/cache/att/keyframe.jpg',
      mime: 'image/jpeg',
    });
  });

  it('vídeo sem faixa de áudio → failed com reason video-sem-audio (não lança)', async () => {
    const extractor = createVideoExtractor({
      transcriber: whisperWith(async () => 'nunca'),
      pipeline: {
        convert: vi.fn(async (): Promise<WavConversionResult> => ({
          status: 'failed',
          reason: 'video-sem-audio',
          hint: 'o vídeo não possui faixa de áudio',
        })),
        probeDuration: withinLimit,
        extractKeyframe: okKeyframe,
        rm: async () => undefined,
      },
    });

    const result = await extractor.extract('/cache/att/mudo.mp4', { mime: 'video/mp4' });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('video-sem-audio');
    // Keyframe preservado mesmo sem áudio (EXTRA independente).
    expect(result.artifacts?.[0]?.kind).toBe('keyframe');
  });

  it('duração acima do limite → skipped (transcrição pulada, keyframe preservado)', async () => {
    const overLimit = async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 9999 });
    const extractor = new VideoExtractor({
      transcriber: whisperWith(async () => 'nunca'),
      pipeline: {
        convert: okConvert(),
        probeDuration: overLimit,
        extractKeyframe: okKeyframe,
        maxDurationSeconds: 1200,
        rm: async () => undefined,
      },
    });

    const result = await extractor.extract('/cache/att/longo.mp4', { mime: 'video/mp4' });

    expect(result.status).toBe('skipped');
    expect(result.metadata?.reason).toBe('video-excede-limite-duracao');
    expect(result.artifacts?.[0]?.kind).toBe('keyframe');
  });

  it('repassa o logger da chamada ao pipeline (aviso de limite emitido)', async () => {
    const logger = { warn: vi.fn() };
    const overLimit = async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 9999 });
    const extractor = new VideoExtractor({
      transcriber: whisperWith(async () => 'x'),
      pipeline: { convert: okConvert(), probeDuration: overLimit, extractKeyframe: okKeyframe, rm: async () => undefined },
    });

    await extractor.extract('/cache/att/longo.mp4', { mime: 'video/mp4', logger });

    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('VideoExtractor: identidade de cache e MIMEs (ADR-004/ADR-005)', () => {
  it('version/model/params espelham o transcritor whisper', () => {
    const transcriber = new WhisperExtractor({
      binaryPath: WHISPER_BIN,
      modelPath: MODEL_PATH,
      version: 'whisper-integration-1',
      language: 'pt',
    });
    const extractor = new VideoExtractor({ transcriber });

    expect(extractor.version).toBe(transcriber.version);
    expect(extractor.model).toBe(transcriber.model);
    expect(extractor.params).toEqual({ language: 'pt' });
  });

  it('transcritor sem model/params → id estável e params vazio', () => {
    const transcriber: Extractor = {
      id: 'x',
      version: 'v9',
      supportedMimes: [],
      extract: async (): Promise<ExtractionResult> => ({ status: 'done' }),
    };
    const extractor = createVideoExtractor({ transcriber });
    expect(extractor.model).toBe('video-transcribe');
    expect(extractor.params).toEqual({});
  });

  it('declara os MIMEs de vídeo e o id estável', () => {
    const extractor = createVideoExtractor({ transcriber: whisperWith(async () => 'x') });
    expect(extractor.id).toBe('video-transcribe');
    expect(extractor.supportedMimes).toContain('video/mp4');
    expect(extractor.supportedMimes).toContain('video/webm');
    expect(extractor.supportedMimes).toContain('video/x-msvideo');
    expect(extractor.supportedMimes).toContain('video/quicktime');
  });
});
