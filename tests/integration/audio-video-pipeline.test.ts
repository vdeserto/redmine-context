/**
 * Teste de INTEGRAÇÃO do caminho REAL de áudio/vídeo (M4-14, #73, BLOCKER-1).
 *
 * Prova, ponta a ponta por {@link extractIssueAttachments} (o MESMO fluxo de
 * `fetchIssueBundle`/`fetchAttachmentTextCacheFirst`), que um anexo de VÍDEO e um de
 * ÁUDIO — roteados por MAGIC BYTES de contêiner (ADR-005) — agora produzem
 * TRANSCRIÇÃO, e não mais `unsupported` como no gap analysis. É a asserção anti-
 * regressão da fiação: `magic.ts` detecta o contêiner → `dispatchExtraction` acha o
 * extrator no registry → o pipeline converte (ffmpeg) → transcreve (whisper).
 *
 * HERMÉTICO: os subprocessos caros (ffmpeg de conversão, whisper de transcrição, a
 * sonda de duração e o keyframe) são INJETADOS via os seams de produção — os bytes
 * do anexo são REAIS (magic bytes de contêiner gravados no cache pelo downloader),
 * mas nenhum binário roda. Assim, "não é mais unsupported" e "roteou pelo magic byte"
 * são asserções diretas, não inferências.
 */

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryCacheStore } from '../../src/cache/index.js';
import type { HttpClient } from '../../src/client/index.js';
import type { Attachment, ExtractionResult, Issue } from '../../src/contract.js';
import {
  ExtractorRegistry,
  createAudioExtractor,
  createVideoExtractor,
  WhisperExtractor,
  type DurationProbeResult,
  type KeyframeResult,
  type WavConversionResult,
} from '../../src/extract/index.js';
import { extractIssueAttachments } from '../../src/index.js';

const INSTANCE_URL = 'https://redmine.example';
const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';

/** Bytes reais de um MP4 (box `ftyp` + brand `isom`) → magic detecta `video/mp4`. */
const VIDEO_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

/** Bytes reais de um MP3 com tag ID3 → magic detecta `audio/mpeg`. */
const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

const withinLimit = async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 5 });
const okKeyframe = async (): Promise<KeyframeResult> => ({ status: 'done', keyframePath: '/cache/att/keyframe.jpg' });

/** ReadableStream a partir de bytes fixos (como o downloader real consome). */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Client HTTP falso: serve os bytes conforme o content_url do anexo. */
function fakeHttp(): HttpClient {
  return {
    get: vi.fn(),
    getBinary: vi.fn(async (url: string) => {
      if (url.includes('/download/12/')) return streamOf(VIDEO_BYTES);
      if (url.includes('/download/34/')) return streamOf(AUDIO_BYTES);
      throw new Error(`url inesperada: ${url}`);
    }),
  };
}

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    id: 0,
    filename: 'x',
    filesize: 1,
    created_on: '2026-07-20T00:00:00Z',
    content_url: `${INSTANCE_URL}/attachments/download/0/x`,
    digest: 'a'.repeat(16),
    ...overrides,
  };
}

function issueWith(attachments: Attachment[]): Issue {
  return {
    id: 73,
    subject: 's',
    project: { id: 1, name: 'P' },
    tracker: { id: 1, name: 'T' },
    status: { id: 1, name: 'S' },
    priority: { id: 1, name: 'N' },
    author: { id: 1, name: 'A' },
    created_on: '2026-07-20T00:00:00Z',
    updated_on: '2026-07-20T00:00:00Z',
    custom_fields: [],
    journals: [],
    attachments,
    relations: [],
    children: [],
  };
}

/**
 * Registry de produção (áudio + vídeo) com os subprocessos INJETADOS: um whisper
 * real por extrator com o `run` espionado, e conversão/sonda/keyframe falsos. É a
 * MESMA composição de `createDefaultRegistry`, só com os seams de subprocesso trocados.
 */
function hermeticRegistry(): ExtractorRegistry {
  const audioWhisper = new WhisperExtractor({
    binaryPath: WHISPER_BIN,
    modelPath: '/cache/models/ggml-tiny.bin',
    version: 'whisper-integration-1',
    run: async () => 'transcricao do audio\n',
  });
  const videoWhisper = new WhisperExtractor({
    binaryPath: WHISPER_BIN,
    modelPath: '/cache/models/ggml-tiny.bin',
    version: 'whisper-integration-1',
    run: async () => 'transcricao do video\n',
  });

  const audioExtractor = createAudioExtractor({
    transcriber: audioWhisper,
    convert: async (): Promise<WavConversionResult> => ({ status: 'done', wavPath: '/cache/tmp/a.wav' }),
    rm: async () => undefined,
  });
  const videoExtractor = createVideoExtractor({
    transcriber: videoWhisper,
    pipeline: {
      convert: async (): Promise<WavConversionResult> => ({ status: 'done', wavPath: '/cache/tmp/v.wav' }),
      probeDuration: withinLimit,
      extractKeyframe: okKeyframe,
      rm: async () => undefined,
    },
  });

  return new ExtractorRegistry().register(audioExtractor).register(videoExtractor);
}

let cacheDir: string;
let store: InMemoryCacheStore<ExtractionResult>;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'rc-av-pipeline-'));
  store = new InMemoryCacheStore<ExtractionResult>();
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('extractIssueAttachments: áudio e vídeo produzem transcrição (BLOCKER-1)', () => {
  it('VÍDEO (mp4) roteia por magic bytes → done com transcrição (não unsupported)', async () => {
    const video = attachment({
      id: 12,
      filename: 'screencast.mp4',
      filesize: VIDEO_BYTES.length,
      content_type: 'video/mp4',
      content_url: `${INSTANCE_URL}/attachments/download/12/screencast.mp4`,
      digest: 'feedface99887766',
    });

    const map = await extractIssueAttachments(fakeHttp(), issueWith([video]), {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry: hermeticRegistry(),
    });

    const result = map.get(12);
    expect(result?.status).toBe('done');
    expect(result?.status).not.toBe('unsupported');
    expect(result?.text).toBe('transcricao do video');
    // Roteado pelo MAGIC BYTE do contêiner (ftyp/isom), não pela extensão.
    expect(result?.mime).toBe('video/mp4');
    // Keyframe referenciado como artifact (o bundle o referencia, não embute).
    expect(result?.artifacts?.[0]?.kind).toBe('keyframe');
  });

  it('ÁUDIO (mp3) roteia por magic bytes → done com transcrição (não unsupported)', async () => {
    const audio = attachment({
      id: 34,
      filename: 'voice.mp3',
      filesize: AUDIO_BYTES.length,
      content_type: 'audio/mpeg',
      content_url: `${INSTANCE_URL}/attachments/download/34/voice.mp3`,
      digest: 'cafe00112233feed',
    });

    const map = await extractIssueAttachments(fakeHttp(), issueWith([audio]), {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry: hermeticRegistry(),
    });

    const result = map.get(34);
    expect(result?.status).toBe('done');
    expect(result?.status).not.toBe('unsupported');
    expect(result?.text).toBe('transcricao do audio');
    expect(result?.mime).toBe('audio/mpeg');
  });

  it('áudio E vídeo na MESMA issue: ambos transcrevem no fluxo real', async () => {
    const video = attachment({
      id: 12,
      filename: 'screencast.mp4',
      filesize: VIDEO_BYTES.length,
      content_type: 'video/mp4',
      content_url: `${INSTANCE_URL}/attachments/download/12/screencast.mp4`,
      digest: 'feedface99887766',
    });
    const audio = attachment({
      id: 34,
      filename: 'voice.mp3',
      filesize: AUDIO_BYTES.length,
      content_type: 'audio/mpeg',
      content_url: `${INSTANCE_URL}/attachments/download/34/voice.mp3`,
      digest: 'cafe00112233feed',
    });

    const map = await extractIssueAttachments(fakeHttp(), issueWith([video, audio]), {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry: hermeticRegistry(),
    });

    expect(map.get(12)?.text).toBe('transcricao do video');
    expect(map.get(34)?.text).toBe('transcricao do audio');
    expect(map.get(12)?.status).toBe('done');
    expect(map.get(34)?.status).toBe('done');
  });
});
