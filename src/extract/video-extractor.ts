/**
 * Adaptador do pipeline de VÍDEO ao contrato {@link Extractor} (M4-14, #73, ADR-002).
 *
 * O pipeline vídeo→áudio→WAV→whisper + keyframe + limite de duração já existe em
 * {@link extractVideoTranscript} (#63/#64/#65), mas como FUNÇÃO — não plugável no
 * registry. Este módulo o embrulha num {@link Extractor} para que o
 * `dispatchExtraction` roteie contêineres de vídeo (detectados por magic bytes)
 * automaticamente no caminho REAL (`extractIssueAttachments`), fechando a lacuna do
 * gap analysis (vídeo virava `unsupported`).
 *
 * O extrator NÃO reimplementa nada: apenas repassa `filePath`/`mime`/`logger` ao
 * pipeline e injeta (nos testes) as deps de subprocesso (conversão/keyframe/sonda).
 *
 * CACHE (ADR-004): `version`/`model`/`params` são DELEGADOS ao transcritor whisper
 * — a chave attachment-level reflete o modelo GGUF, então trocar o modelo reprocessa
 * e o mesmo modelo é cache-hit (a MESMA invariante já provada pela #72). O
 * `ExtractionResult` devolvido inclui a transcrição (`text`), o keyframe (`artifacts`)
 * e o status corretos, exatamente como o pipeline os produz.
 */

import type { ExtractorParams } from '../cache/contract.js';
import type { ExtractionResult } from '../contract.js';

import type { ExtractOptions, Extractor } from './dispatcher.js';
import { extractVideoTranscript, VIDEO_MIMES, type ExtractVideoTranscriptOptions } from './video.js';

/** Identificador estável do extrator (coincide com o `extractorId` dos metadados do pipeline). */
const EXTRACTOR_ID = 'video-transcribe';

/**
 * Overrides injetáveis do pipeline de vídeo — tudo de {@link ExtractVideoTranscriptOptions}
 * exceto o que é resolvido por chamada (`transcriber`/`mime`/`logger`). Em produção
 * fica vazio (o pipeline usa ffmpeg/ffprobe reais por default); nos testes carrega
 * conversão/keyframe/sonda falsos para hermetismo.
 */
export type VideoPipelineOverrides = Omit<ExtractVideoTranscriptOptions, 'transcriber' | 'mime' | 'logger'>;

/** Opções de construção do {@link VideoExtractor}. */
export interface VideoExtractorOptions {
  /**
   * Extrator whisper (#61) que transcreve o WAV extraído do vídeo. `version`/`model`/
   * `params` dele definem a identidade de cache deste extrator (ADR-004).
   */
  readonly transcriber: Extractor;
  /** Overrides injetáveis do pipeline (default: vazio → ffmpeg/ffprobe reais). */
  readonly pipeline?: VideoPipelineOverrides;
}

/**
 * Extrator de vídeo (ADR-002) que embrulha {@link extractVideoTranscript} no contrato
 * {@link Extractor}. Expõe `version`/`model`/`params` do transcritor para
 * {@link buildAttachmentKey} (ADR-004).
 */
export class VideoExtractor implements Extractor {
  readonly id = EXTRACTOR_ID;
  readonly version: string;
  readonly supportedMimes = VIDEO_MIMES;
  /** Modelo lógico da chave de cache — herdado do whisper (GGUF), fallback no id. */
  readonly model: string;
  /** Parâmetros da chave de cache — herdados do whisper (ex.: `{ language }`). */
  readonly params: ExtractorParams;

  private readonly transcriber: Extractor;
  private readonly pipeline: VideoPipelineOverrides;

  /**
   * @param options - Ver {@link VideoExtractorOptions}.
   */
  constructor(options: VideoExtractorOptions) {
    this.transcriber = options.transcriber;
    this.version = options.transcriber.version;
    // Reason (ADR-004): identidade de cache = a do whisper (trocar GGUF reprocessa).
    this.model = options.transcriber.model ?? EXTRACTOR_ID;
    this.params = options.transcriber.params ?? {};
    this.pipeline = options.pipeline ?? {};
  }

  /**
   * Extrai a transcrição (e o keyframe) de um vídeo em `filePath`, delegando ao
   * pipeline {@link extractVideoTranscript}. Nunca lança (o pipeline é gracioso por
   * contrato, ADR-002): binário/modelo ausente, vídeo sem áudio, duração acima do
   * limite ou timeout viram `failed`/`skipped` com motivo.
   *
   * @param filePath - Caminho absoluto do vídeo baixado no cache.
   * @param options - MIME real + logger — ver {@link ExtractOptions}.
   * @returns O {@link ExtractionResult} com `text` (transcrição), `artifacts`
   *   (keyframe) e status corretos.
   */
  extract(filePath: string, options: ExtractOptions): Promise<ExtractionResult> {
    return extractVideoTranscript(filePath, {
      transcriber: this.transcriber,
      mime: options.mime,
      ...this.pipeline,
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
      // Cancelamento (#69/#73): o abort do dispatch alcança conversão/whisper/keyframe
      // do pipeline. Só inclui quando dado (exactOptionalPropertyTypes).
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  }
}

/**
 * Cria um {@link VideoExtractor} a partir de um transcritor whisper. Fino wrapper de
 * composição — ponto de entrada consumido por {@link createDefaultRegistry}.
 *
 * @param options - Transcritor + overrides do pipeline — ver {@link VideoExtractorOptions}.
 * @returns O extrator pronto para registro no {@link ExtractorRegistry}.
 * @example
 * const whisper = await createWhisperExtractor();
 * const video = createVideoExtractor({ transcriber: whisper });
 */
export function createVideoExtractor(options: VideoExtractorOptions): VideoExtractor {
  return new VideoExtractor(options);
}
