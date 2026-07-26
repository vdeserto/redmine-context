/**
 * Teste de INTEGRAÇÃO do cache de 2 camadas para VÍDEO (M4-13, #72, ADR-004).
 *
 * É o análogo de {@link cache-two-layers.test.ts} (#54, OCR) para o pipeline de
 * VÍDEO: prova, ponta a ponta e com os componentes REAIS (`DiskCacheStore` sobre
 * um `mkdtemp`, `buildAttachmentKey`, `getOrCompute`, o pipeline
 * `extractVideoTranscript` e o bundle Markdown), que um comentário novo na issue
 * NÃO reprocessa o vídeo. Só as peças CARAS são falsas — o subprocesso do ffmpeg
 * (conversão) e o do whisper.cpp (transcrição) são `vi.fn()` espionados, injetados
 * pelos MESMOS seams de produção (`FfmpegRunner`/`WhisperRunner`) — de modo que
 * "o ffmpeg/whisper NÃO rodou de novo" seja uma asserção direta sobre o spy, não
 * uma inferência.
 *
 * POR QUE não passa por `extractIssueAttachments` (como o #54): o pipeline de
 * vídeo é orquestrado EXPLICITAMENTE ({@link extractVideoTranscript}) porque o
 * `magic.ts` ainda não detecta MIMEs de vídeo (o `dispatchExtraction` por magic
 * bytes não roteia vídeo hoje — ver `src/extract/video.ts`). Este teste, então,
 * exercita as MESMAS primitivas de cache que `extractIssueAttachments` usa por
 * baixo (`buildAttachmentKey` + `getOrCompute` + `DiskCacheStore`), garantindo que
 * a invariante das duas camadas do ADR-004 vale também para a mídia cara.
 *
 * Invariantes exercitadas (ADR-004, AC do #72):
 * 1. A chave attachment-level NÃO depende de `updated_on` da issue: um comentário
 *    novo (novo journal → `updated_on` muda) regenera o bundle (camada de issue)
 *    REUTILIZANDO 100% da transcrição do anexo imutável — ffmpeg e whisper não são
 *    invocados de novo (spies em ZERO chamadas na 2ª vez).
 * 2. A identidade do modelo GGUF participa da chave: trocar o modelo (ex.:
 *    `ggml-base` → `ggml-small`) gera chave attachment-level DISTINTA e força o
 *    reprocessamento (ffmpeg + whisper rodam de novo); o mesmo modelo é cache-hit.
 *
 * Roda na suíte NORMAL (não opt-in, sem `FFMPEG_INTEGRATION`): é DETERMINÍSTICO
 * (bytes/timestamps fixos, `mkdtemp` isolado por teste, subprocessos injetados) e
 * barato — sem binário real, sem sleep, sem rede.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMarkdownBundle } from '../../src/bundle/index.js';
import {
  buildAttachmentKey,
  DiskCacheStore,
  getOrCompute,
  type ExtractorConfig,
} from '../../src/cache/index.js';
import type { Attachment, ExtractionResult, Issue, Journal } from '../../src/contract.js';
import {
  convertVideoToWav,
  extractVideoTranscript,
  WhisperExtractor,
  type DurationProbeResult,
  type KeyframeResult,
  type WhisperInvocation,
} from '../../src/extract/index.js';

const INSTANCE_URL = 'https://redmine.example';
const TOOL_VERSION = '0.1.0-test';

/** Versão de integração do extrator whisper (estável na chave de cache, ADR-004). */
const WHISPER_VERSION = 'whisper-integration-1';
/** Caminhos fixos dos binários injetados (nenhum é executado — os `run` são spies). */
const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';
const FFMPEG_BIN = '/opt/homebrew/bin/ffmpeg';

/** Dois modelos GGUF distintos: trocar de um para o outro deve invalidar a chave. */
const MODEL_A = 'ggml-base.bin';
const MODEL_B = 'ggml-small.bin';

/** `attachment_id` fixo do anexo de vídeo usado em todo o arquivo. */
const VIDEO_ATTACHMENT_ID = 12;

/**
 * Bytes-fixos do "vídeo" baixado (assinatura `ftyp` de um MP4). Nada os lê para
 * detecção de MIME — o pipeline é injetado — mas gravá-los torna `videoPath` um
 * arquivo REAL no cache, fiel a um anexo baixado.
 */
const VIDEO_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

/**
 * Sonda de duração stub DENTRO do limite (M4-09): mantém o pipeline hermético
 * (sem ffprobe real) e representa o vídeo curto normal, que prossegue para a
 * transcrição.
 */
const withinLimit = async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 5 });

/**
 * Keyframe stub que falha graciosamente: o keyframe é um EXTRA (ADR-002) e sua
 * ausência não afeta a transcrição — mantém o pipeline hermético (sem ffmpeg de
 * keyframe real) sem interferir na asserção de reprocessamento.
 */
const noKeyframe = async (): Promise<KeyframeResult> => ({ status: 'failed', reason: 'sem-keyframe' });

/** Anexo de vídeo base (digest hex real ⇒ path direto no DiskCacheStore). */
function videoAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: VIDEO_ATTACHMENT_ID,
    filename: 'screencast.mp4',
    filesize: VIDEO_BYTES.length,
    content_type: 'video/mp4',
    created_on: '2026-07-20T00:00:00Z',
    content_url: `${INSTANCE_URL}/attachments/download/${VIDEO_ATTACHMENT_ID}/screencast.mp4`,
    digest: 'feedface99887766',
    ...overrides,
  };
}

/** Issue mínima parametrizável por anexos, journals e `updated_on`. */
function issueWith(
  attachments: Attachment[],
  journals: Journal[] = [],
  updatedOn = '2026-07-20T00:00:00Z',
): Issue {
  return {
    id: 72,
    subject: 's',
    project: { id: 1, name: 'P' },
    tracker: { id: 1, name: 'T' },
    status: { id: 1, name: 'S' },
    priority: { id: 1, name: 'N' },
    author: { id: 1, name: 'A' },
    created_on: '2026-07-20T00:00:00Z',
    updated_on: updatedOn,
    custom_fields: [],
    journals,
    attachments,
    relations: [],
    children: [],
  };
}

/**
 * Um par de spies de subprocesso (ffmpeg + whisper) atrelado a UM modelo GGUF. O
 * transcritor é um {@link WhisperExtractor} REAL com o `run` (subprocesso)
 * espionado — o stdout embute o modelo + um contador, de modo que transcrições de
 * modelos/execuções distintos sejam observáveis no bundle (como o `ocr-#N` do #54).
 */
interface VideoSpies {
  /** Nome do modelo GGUF (entra na chave attachment-level e no texto transcrito). */
  readonly model: string;
  /** Spy do subprocesso ffmpeg (conversão vídeo→WAV) — prova a invocação/contagem. */
  readonly ffmpegRun: ReturnType<typeof vi.fn>;
  /** Spy do subprocesso whisper.cpp (transcrição) — prova a invocação/contagem. */
  readonly whisperRun: ReturnType<typeof vi.fn>;
  /** Última invocação capturada do whisper (para asserir o modelo em `-m`). */
  readonly lastWhisper: { invocation?: WhisperInvocation };
  /** Extrator whisper real com o `run` acima injetado. */
  readonly transcriber: WhisperExtractor;
}

/**
 * Cria um par de spies FRESCOS para um modelo GGUF. Fresco por geração ⇒ cada
 * chamada tem sua própria contagem, tornando "rodou / não rodou de novo" uma
 * asserção direta.
 *
 * @param model - Nome do modelo GGUF desta geração.
 * @returns Os spies + o extrator whisper real que os usa.
 */
function makeVideoSpies(model: string): VideoSpies {
  let whisperCalls = 0;
  const lastWhisper: { invocation?: WhisperInvocation } = {};
  const ffmpegRun = vi.fn(async (): Promise<void> => undefined);
  const whisperRun = vi.fn(async (invocation: WhisperInvocation): Promise<string> => {
    lastWhisper.invocation = invocation;
    whisperCalls += 1;
    // Prefixo de timestamp incluído de propósito: prova que o parser do whisper o
    // remove; o texto final embute modelo + contador, distinguindo as extrações.
    return `[00:00:00.000 --> 00:00:02.000]  transcricao ${model} #${whisperCalls}\n`;
  });
  const transcriber = new WhisperExtractor({
    binaryPath: WHISPER_BIN,
    modelPath: `/cache/models/${model}`,
    version: WHISPER_VERSION,
    run: whisperRun,
  });
  return { model, ffmpegRun, whisperRun, lastWhisper, transcriber };
}

/** Contexto imutável de FS/cache compartilhado por uma execução de teste. */
interface RunContext {
  readonly store: DiskCacheStore<ExtractionResult>;
  readonly videoPath: string;
  readonly wavTempDir: string;
}

/**
 * Executa a extração de vídeo de UM anexo sob o cache de 2 camadas — a MESMA
 * amarração de `extractIssueAttachments` (chave attachment-level via
 * {@link buildAttachmentKey} + {@link getOrCompute}), com o pipeline de vídeo real
 * ({@link extractVideoTranscript}) e ffmpeg/whisper injetados como spies. Devolve o
 * `Map<attachmentId, ExtractionResult>` que o bundle consome (camada de issue).
 *
 * @param attachment - Anexo de vídeo a processar.
 * @param spies - Spies + transcritor da geração (modelo GGUF) atual.
 * @param ctx - Store/paths compartilhados do teste.
 * @returns Mapa de extrações por anexo (cacheado ou recém-computado).
 */
async function runVideoExtraction(
  attachment: Attachment,
  spies: VideoSpies,
  ctx: RunContext,
): Promise<Map<number, ExtractionResult>> {
  // Config do extrator na chave (ADR-004): trocar `model` invalida corretamente.
  const config: ExtractorConfig = { version: WHISPER_VERSION, model: spies.model, params: {} };
  const key = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment, extractor: config });

  const result = await getOrCompute(ctx.store, key, () =>
    extractVideoTranscript(ctx.videoPath, {
      mime: 'video/mp4',
      // ffmpeg REAL (`convertVideoToWav`) com o subprocesso injetado como spy: prova
      // a conversão no seam de produção, sem ffmpeg real nem escrever o WAV.
      convert: (input) =>
        convertVideoToWav(input, {
          findFfmpegBinary: () => FFMPEG_BIN,
          run: spies.ffmpegRun,
          mkdir: async () => undefined,
          rm: async () => undefined,
          tempDir: ctx.wavTempDir,
        }),
      transcriber: spies.transcriber,
      probeDuration: withinLimit,
      extractKeyframe: noKeyframe,
      // WAV intermediário nunca é escrito (whisper `run` é spy) — `rm` no-op mantém
      // o teste 100% hermético.
      rm: async () => undefined,
    }),
  );
  return new Map([[attachment.id, result]]);
}

/** Monta o bundle Markdown da issue com as extrações (camada de issue). */
function bundleOf(issue: Issue, extractions: Map<number, ExtractionResult>): string {
  return buildMarkdownBundle(issue, {
    baseUrl: INSTANCE_URL,
    toolVersion: TOOL_VERSION,
    extractions,
  });
}

let cacheDir: string;
let ctx: RunContext;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'rc-video-cache-'));
  const videoPath = join(cacheDir, 'screencast.mp4');
  writeFileSync(videoPath, VIDEO_BYTES);
  ctx = {
    store: new DiskCacheStore<ExtractionResult>({ cacheDir }),
    videoPath,
    wavTempDir: join(cacheDir, 'tmp'),
  };
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('cache 2 camadas (vídeo): comentário novo não reprocessa a transcrição', () => {
  it('novo journal (updated_on muda) regenera o bundle sem reinvocar ffmpeg/whisper', async () => {
    const spies = makeVideoSpies(MODEL_A);
    const attachment = videoAttachment();

    // 1ª geração: issue sem comentários. Converte (ffmpeg) e transcreve (whisper) 1x.
    const issueV1 = issueWith([attachment]);
    const extractionsV1 = await runVideoExtraction(attachment, spies, ctx);
    const bundleV1 = bundleOf(issueV1, extractionsV1);

    expect(extractionsV1.get(VIDEO_ATTACHMENT_ID)?.status).toBe('done');
    expect(extractionsV1.get(VIDEO_ATTACHMENT_ID)?.text).toBe(`transcricao ${MODEL_A} #1`);
    expect(bundleV1).toContain(`transcricao ${MODEL_A} #1`);
    expect(spies.ffmpegRun).toHaveBeenCalledTimes(1);
    expect(spies.whisperRun).toHaveBeenCalledTimes(1);
    // O whisper foi invocado com o modelo GGUF via `-m <modelPath>` (ADR-004).
    const whisperArgs = spies.lastWhisper.invocation?.args ?? [];
    expect(whisperArgs).toContain(`/cache/models/${MODEL_A}`);

    // Comentário novo: novo journal ⇒ `updated_on` avança. Mesmo anexo imutável.
    const journal: Journal = {
      id: 900,
      notes: 'comentario recem adicionado',
      created_on: '2026-07-21T09:00:00Z',
      details: [],
    };
    const issueV2 = issueWith([attachment], [journal], '2026-07-21T09:00:00Z');
    const extractionsV2 = await runVideoExtraction(attachment, spies, ctx);
    const bundleV2 = bundleOf(issueV2, extractionsV2);

    // Camada de issue regenerada: o bundle mudou (traz o comentário novo)...
    expect(bundleV2).not.toBe(bundleV1);
    expect(bundleV2).toContain('comentario recem adicionado');
    // ...mas a camada de attachment foi REUTILIZADA: mesma transcrição, sem
    // reconverter nem retranscrever (os spies continuam em 1 chamada cada).
    expect(bundleV2).toContain(`transcricao ${MODEL_A} #1`);
    expect(extractionsV2.get(VIDEO_ATTACHMENT_ID)?.text).toBe(`transcricao ${MODEL_A} #1`);
    expect(spies.ffmpegRun).toHaveBeenCalledTimes(1);
    expect(spies.whisperRun).toHaveBeenCalledTimes(1);
  });
});

describe('cache 2 camadas (vídeo): identidade do modelo GGUF na chave', () => {
  it('trocar o modelo GGUF força reprocessamento; o mesmo modelo é cache-hit', async () => {
    const attachment = videoAttachment();

    // Modelo A: primeira extração (converte + transcreve).
    const spiesA = makeVideoSpies(MODEL_A);
    const extractionsA = await runVideoExtraction(attachment, spiesA, ctx);
    expect(spiesA.ffmpegRun).toHaveBeenCalledTimes(1);
    expect(spiesA.whisperRun).toHaveBeenCalledTimes(1);
    expect(extractionsA.get(VIDEO_ATTACHMENT_ID)?.text).toBe(`transcricao ${MODEL_A} #1`);

    // Troca do modelo GGUF ⇒ chave attachment-level distinta ⇒ REPROCESSA
    // (ffmpeg + whisper rodam de novo); a entrada do modelo A segue intacta.
    const spiesB = makeVideoSpies(MODEL_B);
    const extractionsB = await runVideoExtraction(attachment, spiesB, ctx);
    expect(spiesB.ffmpegRun).toHaveBeenCalledTimes(1);
    expect(spiesB.whisperRun).toHaveBeenCalledTimes(1);
    expect(extractionsB.get(VIDEO_ATTACHMENT_ID)?.text).toBe(`transcricao ${MODEL_B} #1`);
    expect(spiesA.ffmpegRun).toHaveBeenCalledTimes(1);
    expect(spiesA.whisperRun).toHaveBeenCalledTimes(1);

    // Reexecutar o modelo A é cache-hit puro: não reconverte nem retranscreve.
    const spiesA2 = makeVideoSpies(MODEL_A);
    const extractionsA2 = await runVideoExtraction(attachment, spiesA2, ctx);
    expect(spiesA2.ffmpegRun).not.toHaveBeenCalled();
    expect(spiesA2.whisperRun).not.toHaveBeenCalled();
    // E serve o texto originalmente transcrito pelo modelo A (não o do B).
    expect(extractionsA2.get(VIDEO_ATTACHMENT_ID)?.text).toBe(`transcricao ${MODEL_A} #1`);
  });
});
