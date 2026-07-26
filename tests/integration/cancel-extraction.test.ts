/**
 * Teste de INTEGRAÇÃO do fluxo REAL de cancelamento (M4-14, #73, MAJOR-1).
 *
 * Prova, ponta a ponta, o que o gap analysis do QA apontou como quebrado: um
 * `AbortSignal` disparado no TOPO agora atravessa `extractIssueAttachments`
 * (mesmo fluxo de `fetchIssueBundle`/`fetchAttachmentTextCacheFirst`) →
 * `dispatchExtraction` → o extrator de áudio → o `WhisperExtractor` → o
 * `runWithWatchdog` REAL, que MATA o subprocesso whisper (`kill`). Antes o `signal`
 * se perdia na fronteira dos extratores e o ffmpeg/whisper seguia rodando.
 *
 * HERMÉTICO/DETERMINÍSTICO: os bytes do anexo são REAIS (magic bytes de MP3, gravados
 * no cache pelo downloader), a fila e a orquestração são REAIS, e SÓ o `execFile` do
 * whisper é FAKE — um child com `kill` espionável que, ao receber o sinal, "responde"
 * (como um binário que sai no SIGTERM), fazendo o watchdog settle sem timer de graça.
 *
 * Duas provas:
 * 1. Por `extractIssueAttachments` com um signal já abortado: o whisper recebe o
 *    signal e o subprocesso é MORTO (o `kill` é chamado) — a corrente chega ao fim.
 * 2. Pela FILA (`runQueue`, o caminho do background do MCP): o signal da fila
 *    (`JobContext.signal`) atravessa o `compute` real e MATA o subprocesso durante o
 *    job. Como os extratores são graciosos (nunca rejeitam), o job resolve com um
 *    resultado `failed` — a observação de `cancelled` para jobs que REJEITAM já é
 *    coberta por `queue.test.ts` (#69); aqui o foco é o kill do subprocesso no fluxo
 *    real dirigido pela fila.
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
  createAudioExtractor,
  ExtractorRegistry,
  runQueue,
  runWithWatchdog,
  WhisperExtractor,
  type ExecFileLike,
  type QueueEvent,
  type QueueJob,
  type WatchdogChild,
  type WavConversionResult,
  type WhisperInvocation,
} from '../../src/extract/index.js';
import { extractIssueAttachments } from '../../src/index.js';

const INSTANCE_URL = 'https://redmine.example';
const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';

/** Bytes reais de um MP3 com tag ID3 → magic detecta `audio/mpeg` e roteia áudio. */
const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

/** Child fake com `kill` espionável e flag de encerramento (anti-zumbi). */
interface FakeChild extends WatchdogChild {
  readonly signals: NodeJS.Signals[];
  killed: boolean;
}

/** Captura do child fake e do signal que chegou à invocação do whisper. */
interface WhisperCapture {
  child?: FakeChild;
  signal?: AbortSignal;
}

/**
 * `execFile` fake: nunca chama o callback sozinho (whisper "rodando"), mas ao receber
 * QUALQUER sinal de `kill` responde via o callback — como um processo que sai no
 * SIGTERM. `onSpawn` roda no momento em que o subprocesso "inicia" (usado para simular
 * um cancelamento do usuário durante a execução).
 */
function fakeWhisperExec(capture: WhisperCapture, onSpawn: () => void = (): void => undefined): ExecFileLike {
  return ((_file, _args, _options, callback) => {
    const child: FakeChild = {
      signals: [],
      killed: false,
      kill(signal: NodeJS.Signals): boolean {
        this.signals.push(signal);
        this.killed = true;
        queueMicrotask(() => callback(null, '', ''));
        return true;
      },
    };
    capture.child = child;
    onSpawn();
    return child;
  }) as ExecFileLike;
}

/**
 * Registry com o extrator de áudio de produção, mas com o `run` do whisper delegando
 * ao `runWithWatchdog` REAL sobre um `execFile` FAKE — captura o signal recebido e o
 * child, provando o kill. A conversão ffmpeg é stubada (o foco é a corrente do signal).
 */
function registryWithFakeWhisper(capture: WhisperCapture, onSpawn?: () => void): ExtractorRegistry {
  const whisper = new WhisperExtractor({
    binaryPath: WHISPER_BIN,
    modelPath: '/cache/models/ggml-tiny.bin',
    version: 'whisper-integration-1',
    killGraceMs: 5,
    run: (invocation: WhisperInvocation) => {
      capture.signal = invocation.signal;
      return runWithWatchdog(invocation, { execFile: fakeWhisperExec(capture, onSpawn) });
    },
  });
  const audio = createAudioExtractor({
    transcriber: whisper,
    convert: async (): Promise<WavConversionResult> => ({ status: 'done', wavPath: '/cache/tmp/a.wav' }),
    rm: async () => undefined,
  });
  return new ExtractorRegistry().register(audio);
}

/** Client HTTP falso: serve os bytes de áudio conforme o content_url do anexo. */
function fakeHttp(): HttpClient {
  return {
    get: vi.fn(),
    getBinary: vi.fn(async () => streamOf(AUDIO_BYTES)),
  };
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function audioAttachment(): Attachment {
  return {
    id: 34,
    filename: 'voice.mp3',
    filesize: AUDIO_BYTES.length,
    content_type: 'audio/mpeg',
    created_on: '2026-07-20T00:00:00Z',
    content_url: `${INSTANCE_URL}/attachments/download/34/voice.mp3`,
    digest: 'cafe00112233feed',
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

let cacheDir: string;
let store: InMemoryCacheStore<ExtractionResult>;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'rc-cancel-'));
  store = new InMemoryCacheStore<ExtractionResult>();
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('cancelamento ponta a ponta por extractIssueAttachments', () => {
  it('signal abortado alcança o whisper e MATA o subprocesso (kill), extração vira failed', async () => {
    const capture: WhisperCapture = {};
    const controller = new AbortController();
    controller.abort();

    const map = await extractIssueAttachments(fakeHttp(), issueWith([audioAttachment()]), {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry: registryWithFakeWhisper(capture),
      signal: controller.signal,
    });

    // O signal do TOPO chegou até a invocação do whisper (a corrente não quebra).
    expect(capture.signal).toBe(controller.signal);
    // E o subprocesso whisper foi efetivamente MORTO (a prova central do MAJOR-1).
    expect(capture.child?.signals).toContain('SIGTERM');
    expect(capture.child?.killed).toBe(true);
    // A extração degrada graciosamente para failed (o abort não derruba o bundle).
    expect(map.get(34)?.status).toBe('failed');
  });
});

describe('cancelamento pela FILA (caminho de background do MCP)', () => {
  it('o signal da fila atravessa o compute real e mata o whisper durante o job', async () => {
    const capture: WhisperCapture = {};
    const controller = new AbortController();
    // Simula o usuário cancelando DURANTE a execução: aborta no instante em que o
    // subprocesso whisper "inicia" (o execFile fake é invocado).
    const registry = registryWithFakeWhisper(capture, () => controller.abort());

    // O compute REUSA o pipeline real (o mesmo de fetch-attachment-text/-issue-bundle),
    // repassando o signal da fila — exatamente a fiação corrigida no caminho MCP.
    const compute = (signal: AbortSignal | undefined): Promise<ExtractionResult> =>
      extractIssueAttachments(fakeHttp(), issueWith([audioAttachment()]), {
        instanceUrl: INSTANCE_URL,
        cacheDir,
        store,
        registry,
        ...(signal !== undefined ? { signal } : {}),
      }).then((map) => map.get(34) ?? { status: 'failed', metadata: { reason: 'ausente' } });

    const job: QueueJob<ExtractionResult> = {
      id: 'attachment:34',
      run: (context) => compute(context.signal),
    };

    const events: QueueEvent<ExtractionResult>[] = [];
    for await (const event of runQueue([job], { signal: controller.signal })) {
      events.push(event);
    }

    // O subprocesso whisper foi MORTO no cancelamento dirigido pela fila.
    expect(capture.child?.signals).toContain('SIGTERM');
    expect(capture.child?.killed).toBe(true);
    // O signal da fila chegou até a invocação do whisper (a corrente não quebra).
    expect(capture.signal).toBe(controller.signal);
    // Job gracioso: resolve com um resultado `failed` (o abort não relança/derruba).
    const terminal = events.filter((e) => e.id === 'attachment:34').at(-1);
    expect(terminal?.status).toBe('done');
    expect(terminal?.result?.status).toBe('failed');
  });
});
