/**
 * Extrator de ÁUDIO que encadeia conversão → transcrição (M4-14, #73, ADR-002).
 *
 * Fecha a lacuna do gap analysis: o whisper.cpp (#61) só consome WAV PCM 16 kHz
 * mono, mas os anexos de áudio chegam crus (MP3/M4A/OGG/WAV arbitrário). Este
 * extrator implementa o contrato {@link Extractor} e orquestra, num único job:
 *
 *   arquivo de áudio cru → {@link convertAudioToWav} (#60) → {@link WhisperExtractor} (#61)
 *
 * Registrá-lo no registry default (em vez do whisper direto — MINOR-2 do QA) faz o
 * `dispatchExtraction` rotear áudio automaticamente por magic bytes, produzindo a
 * transcrição no caminho REAL (`extractIssueAttachments`), não mais `unsupported`.
 *
 * DECISÕES (ADR-002/ADR-004):
 * - CONVERSÃO SEMPRE: mesmo um `.wav` é reprocessado pelo ffmpeg para GARANTIR 16
 *   kHz mono PCM (um WAV 44,1 kHz estéreo transcreveria errado). É a mesma política
 *   do pipeline de vídeo ({@link convertVideoToWav}); o ganho de pular a conversão
 *   de um WAV já-16k não compensa o risco de silenciosamente transcrever mal.
 * - CACHE (ADR-004): `version`/`model`/`params` são DELEGADOS ao transcritor whisper
 *   — a chave attachment-level reflete o modelo GGUF e o idioma, então trocar o
 *   modelo reprocessa e o mesmo modelo é cache-hit (mesma invariante da #72).
 * - DEGRADAÇÃO GRACIOSA: ffmpeg/whisper/modelo ausente ou timeout → `failed` com
 *   motivo, NUNCA lança (o bundle segue). O WAV intermediário é sempre limpo.
 * - SEGURANÇA: reusa a invocação segura da #60/#61 (execFile sem shell,
 *   `-protocol_whitelist file`, env sanitizado, watchdog) — nada de spawn novo aqui.
 */

import { rm as fsRm } from 'node:fs/promises';

import type { ExtractorParams } from '../cache/contract.js';
import type { Logger } from '../client/index.js';
import type { ExtractionResult } from '../contract.js';

import {
  convertAudioToWav,
  type ConvertAudioToWavOptions,
  type WavConversionFailure,
  type WavConversionResult,
} from './audio.js';
import type { ExtractOptions, Extractor } from './dispatcher.js';
import { WHISPER_MIMES } from './whisper-extract.js';

/** Identificador estável do extrator (entra em metadados/cache-key como fallback). */
const EXTRACTOR_ID = 'audio-transcribe';

/**
 * MIMEs REAIS de áudio roteados para este extrator. Reusa a lista do whisper (#61)
 * para cobertura idêntica à que o whisper cobria quando registrado diretamente.
 */
export const AUDIO_MIMES: readonly string[] = WHISPER_MIMES;

/** Opções de construção do {@link AudioExtractor}. */
export interface AudioExtractorOptions {
  /**
   * Extrator whisper (#61) que transcreve o WAV. `version`/`model`/`params` dele
   * definem a identidade de cache deste extrator (ADR-004).
   */
  readonly transcriber: Extractor;
  /**
   * Conversão áudio → WAV; default: {@link convertAudioToWav} (com o `logger`
   * repassado). Injetável para testes herméticos sem ffmpeg real.
   */
  readonly convert?: (inputPath: string) => Promise<WavConversionResult>;
  /** Opções repassadas à conversão default (binário, timeouts, tempDir). */
  readonly convertOptions?: ConvertAudioToWavOptions;
  /** Remove o WAV intermediário após a transcrição (best-effort); default `fs.rm` com `force`. */
  readonly rm?: (path: string) => Promise<void>;
}

/**
 * Extrator de áudio (ADR-002) que converte o anexo para WAV 16 kHz mono e o
 * transcreve via whisper.cpp. Implementa {@link Extractor} e expõe `version`/
 * `model`/`params` do transcritor para {@link buildAttachmentKey} (ADR-004).
 */
export class AudioExtractor implements Extractor {
  readonly id = EXTRACTOR_ID;
  readonly version: string;
  readonly supportedMimes = AUDIO_MIMES;
  /** Modelo lógico da chave de cache — herdado do whisper (GGUF), fallback no id. */
  readonly model: string;
  /** Parâmetros da chave de cache — herdados do whisper (ex.: `{ language }`). */
  readonly params: ExtractorParams;

  private readonly transcriber: Extractor;
  private readonly convert: ((inputPath: string) => Promise<WavConversionResult>) | undefined;
  private readonly convertOptions: ConvertAudioToWavOptions | undefined;
  private readonly rm: (path: string) => Promise<void>;

  /**
   * @param options - Ver {@link AudioExtractorOptions}.
   */
  constructor(options: AudioExtractorOptions) {
    this.transcriber = options.transcriber;
    this.version = options.transcriber.version;
    // Reason (ADR-004): a identidade de cache deste extrator É a do whisper — trocar
    // o GGUF/idioma reprocessa; sem model/params no transcritor, cai no id estável.
    this.model = options.transcriber.model ?? EXTRACTOR_ID;
    this.params = options.transcriber.params ?? {};
    this.convert = options.convert;
    this.convertOptions = options.convertOptions;
    this.rm = options.rm ?? ((path: string): Promise<void> => fsRm(path, { force: true }));
  }

  /**
   * Transcreve o áudio em `filePath`: converte para WAV 16 kHz mono e passa ao
   * whisper. Nunca lança — falha de conversão (ffmpeg ausente/timeout) ou de
   * transcrição vira `{ status: 'failed', reason }` (ADR-002). O WAV intermediário
   * é sempre removido (best-effort).
   *
   * @param filePath - Caminho absoluto do áudio baixado no cache.
   * @param options - MIME real + logger — ver {@link ExtractOptions}.
   * @returns `done` com `text` no sucesso; `failed` com motivo claro na falha.
   */
  async extract(filePath: string, options: ExtractOptions): Promise<ExtractionResult> {
    const conversion = await this.runConvert(filePath, options.logger);
    if (conversion.status === 'failed') {
      return conversionFailure(this.id, options.mime, conversion);
    }

    const wavPath = conversion.wavPath;
    try {
      return await this.transcriber.extract(wavPath, options);
    } catch (error) {
      // Reason: o whisper é gracioso por contrato, mas um transcritor injetado
      // hostil/quebrado não pode derrubar o bundle — degrada para failed (ADR-002).
      return {
        status: 'failed',
        mime: options.mime,
        metadata: {
          extractorId: this.id,
          reason: 'erro-transcricao',
          error: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      // O WAV é um artefato intermediário do cache temp; descarta em qualquer
      // desfecho para não acumular lixo (convenção de `audio.ts`/`video.ts`).
      await this.rm(wavPath).catch(() => undefined);
    }
  }

  /**
   * Roda a conversão áudio → WAV (injetável nos testes; default: ffmpeg real da #60).
   *
   * @param filePath - Caminho do áudio cru.
   * @param logger - Logger repassado à conversão default.
   * @returns Resultado da conversão (`done` com `wavPath` ou `failed` com motivo).
   */
  private runConvert(filePath: string, logger: Logger | undefined): Promise<WavConversionResult> {
    if (this.convert !== undefined) {
      return this.convert(filePath);
    }
    return convertAudioToWav(filePath, {
      ...(this.convertOptions ?? {}),
      ...(logger !== undefined ? { logger } : {}),
    });
  }
}

/**
 * Monta um {@link ExtractionResult} `failed` a partir de uma falha de conversão,
 * sem injetar chaves `undefined` (respeita `exactOptionalPropertyTypes`).
 *
 * @param extractorId - Id do extrator que reporta a falha.
 * @param mime - MIME real do áudio.
 * @param failure - Falha devolvida pela conversão áudio → WAV.
 * @returns Resultado `failed` com `reason`/`error`/`hint` preservados.
 */
function conversionFailure(
  extractorId: string,
  mime: string,
  failure: WavConversionFailure,
): ExtractionResult {
  const metadata: Record<string, unknown> = { extractorId, reason: failure.reason };
  if (failure.error !== undefined) metadata.error = failure.error;
  if (failure.hint !== undefined) metadata.hint = failure.hint;
  return { status: 'failed', mime, metadata };
}

/**
 * Cria um {@link AudioExtractor} a partir de um transcritor whisper. Fino wrapper
 * de composição — ponto de entrada consumido por {@link createDefaultRegistry}.
 *
 * @param options - Transcritor + deps injetáveis — ver {@link AudioExtractorOptions}.
 * @returns O extrator pronto para registro no {@link ExtractorRegistry}.
 * @example
 * const whisper = await createWhisperExtractor();
 * const audio = createAudioExtractor({ transcriber: whisper });
 */
export function createAudioExtractor(options: AudioExtractorOptions): AudioExtractor {
  return new AudioExtractor(options);
}
