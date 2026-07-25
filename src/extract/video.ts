/**
 * Extração da faixa de áudio de VÍDEO + pipeline vídeo→áudio→transcrição
 * (M4-07, #63, ADR-002).
 *
 * REUSO (não reimplementação): a extração de áudio de um container de vídeo é a
 * MESMA operação ffmpeg da #60 — o ffmpeg já lida com mp4/mkv/webm e `-vn`
 * descarta a faixa de vídeo, deixando só o áudio → WAV 16 kHz mono. Portanto este
 * módulo NÃO duplica a invocação do subprocesso (sem shell, `-protocol_whitelist
 * file`, env sanitizado, watchdog SIGTERM→SIGKILL, remoção do WAV parcial): ele
 * DELEGA a {@link convertAudioToWav} e apenas:
 *
 * 1. {@link convertVideoToWav} — fino wrapper que roteia a entrada de vídeo para a
 *    conversão da #60 e DETECTA o caso NOVO do vídeo: container SEM faixa de áudio.
 *    O ffmpeg, ao descartar o vídeo com `-vn` sobre um arquivo mudo, falha com
 *    "does not contain any stream" / "matches no streams"; remapeamos essa falha
 *    genérica (`erro-conversao`) para um motivo CLARO, `video-sem-audio`, sem crash.
 *
 * 2. {@link extractVideoTranscript} — orquestra o pipeline em UM job: extrai o
 *    áudio (ffmpeg) → passa o WAV ao extrator whisper da #61. A orquestração é
 *    EXPLÍCITA do chamador porque o `magic.ts` ainda não detecta MIMEs de
 *    áudio/vídeo (então o `dispatchExtraction` por magic bytes não roteia vídeo
 *    hoje) — invocamos os módulos diretamente. Degradação graciosa em toda etapa:
 *    conversão falha → `failed` com motivo (transcritor nem é chamado); whisper
 *    falho (ou que lance) NÃO derruba a extração de áudio já feita, vira `failed`
 *    gracioso; o WAV intermediário é sempre limpo (best-effort).
 *
 * CONTRATO: reusa {@link ExtractionResult}/{@link ExtractionStatus} do core e os
 * resultados de {@link convertAudioToWav}/whisper — sem status paralelo.
 * `exactOptionalPropertyTypes` respeitado (nenhuma chave opcional recebe `undefined`).
 */

import { rm as fsRm } from 'node:fs/promises';

import type { Logger } from '../client/index.js';
import type { ExtractionResult } from '../contract.js';

import {
  convertAudioToWav,
  type ConvertAudioToWavOptions,
  type WavConversionFailure,
  type WavConversionResult,
} from './audio.js';
import type { ExtractOptions, Extractor } from './dispatcher.js';

/** Identificador do pipeline (entra em metadados de resultados de falha da conversão). */
const PIPELINE_EXTRACTOR_ID = 'video-transcribe';

/** MIME default passado ao whisper quando o mime real do vídeo não é informado. */
const DEFAULT_TRANSCRIBE_MIME = 'audio/wav';

/**
 * MIMEs de contêiner de vídeo cuja faixa de áudio este pipeline sabe extrair. Não
 * são roteados pelo `dispatchExtraction` (o `magic.ts` ainda não detecta vídeo,
 * ver #63) — servem ao chamador que orquestra a extração explicitamente e a futura
 * detecção de assinatura.
 */
export const VIDEO_MIMES: readonly string[] = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
  'video/mpeg',
];

/**
 * Assinatura textual do ffmpeg quando o container não tem faixa de áudio para
 * extrair (após `-vn` descartar o vídeo): "Output file does not contain any
 * stream" ou "Stream map '0:a' matches no streams". Robusto a variações de versão.
 */
const NO_AUDIO_STREAM_PATTERN = /does not contain any stream|matches no streams/i;

/**
 * `true` se a mensagem de erro do ffmpeg indica ausência de faixa de áudio no
 * vídeo (o caso NOVO desta issue), e não um erro de conversão genérico.
 *
 * @param error - Mensagem de erro subjacente reportada pela conversão.
 * @returns `true` quando o padrão de "sem stream de áudio" casa.
 */
function isNoAudioStream(error: string | undefined): boolean {
  return error !== undefined && NO_AUDIO_STREAM_PATTERN.test(error);
}

/**
 * Converte a faixa de áudio de um VÍDEO para WAV 16 kHz mono, REUSANDO a conversão
 * ffmpeg da #60 ({@link convertAudioToWav}) — mesma invocação segura (sem shell,
 * `-protocol_whitelist file`, `-vn`, `-ar 16000 -ac 1 -c:a pcm_s16le`, env
 * sanitizado, watchdog). A única diferença é semântica: um vídeo SEM faixa de
 * áudio faz o ffmpeg falhar; essa falha é remapeada de `erro-conversao` para o
 * motivo claro `video-sem-audio`. NUNCA lança (degradação graciosa, ADR-002).
 *
 * @param inputPath - Caminho absoluto do vídeo de entrada já baixado no cache.
 * @param options - Deps injetáveis + timeouts + logger (a mesma superfície da #60).
 * @returns `done` com `wavPath` no sucesso; `failed` com motivo claro na falha
 *   (`video-sem-audio` quando não há áudio; senão o motivo original da #60).
 * @example
 * const wav = await convertVideoToWav('/cache/att/screencast.mp4');
 * if (wav.status === 'done') transcribe(wav.wavPath);
 */
export async function convertVideoToWav(
  inputPath: string,
  options: ConvertAudioToWavOptions = {},
): Promise<WavConversionResult> {
  const result = await convertAudioToWav(inputPath, options);
  if (result.status === 'failed' && result.reason === 'erro-conversao' && isNoAudioStream(result.error)) {
    const failure: WavConversionFailure = {
      status: 'failed',
      reason: 'video-sem-audio',
      hint: 'o vídeo não possui faixa de áudio; não há o que transcrever',
      ...(result.error !== undefined ? { error: result.error } : {}),
    };
    return failure;
  }
  return result;
}

/** Opções de orquestração do pipeline {@link extractVideoTranscript}. */
export interface ExtractVideoTranscriptOptions {
  /**
   * Extrator de transcrição (whisper.cpp da #61) — só o {@link Extractor.extract}
   * é necessário. Injetado para desacoplamento e testes herméticos.
   */
  readonly transcriber: Pick<Extractor, 'extract'>;
  /**
   * Conversão vídeo → WAV; default: {@link convertVideoToWav} (com o `logger`
   * repassado). Injetável para testes sem ffmpeg real.
   */
  readonly convert?: (inputPath: string) => Promise<WavConversionResult>;
  /** Opções repassadas à conversão default (binário, timeouts, tempDir). */
  readonly convertOptions?: ConvertAudioToWavOptions;
  /** Remove o WAV intermediário após a transcrição (best-effort); default `fs.rm` com `force`. */
  readonly rm?: (path: string) => Promise<void>;
  /** MIME REAL do vídeo (para metadados do resultado); default {@link DEFAULT_TRANSCRIBE_MIME}. */
  readonly mime?: string;
  /** Logger para avisos das etapas; sem default de lib (ADR-003). */
  readonly logger?: Logger;
}

/**
 * Monta um {@link ExtractionResult} `failed` a partir de uma falha de conversão,
 * sem injetar chaves `undefined` (respeita `exactOptionalPropertyTypes`).
 *
 * @param mime - MIME real do vídeo.
 * @param failure - Falha devolvida pela conversão vídeo → WAV.
 * @returns Resultado `failed` com `reason`/`error`/`hint` preservados.
 */
function conversionFailure(mime: string, failure: WavConversionFailure): ExtractionResult {
  const metadata: Record<string, unknown> = {
    extractorId: PIPELINE_EXTRACTOR_ID,
    reason: failure.reason,
  };
  if (failure.error !== undefined) metadata.error = failure.error;
  if (failure.hint !== undefined) metadata.hint = failure.hint;
  return { status: 'failed', mime, metadata };
}

/**
 * Orquestra o pipeline vídeo→áudio→transcrição em UM job (M4-07, #63): extrai o
 * áudio do vídeo ({@link convertVideoToWav}) e, no sucesso, passa o WAV ao extrator
 * whisper (#61). Como o `magic.ts` ainda não roteia vídeo, a orquestração é
 * explícita aqui. NUNCA lança: conversão falha (inclusive `video-sem-audio`)
 * curto-circuita com `failed` + motivo; whisper falho (ou que lance) vira `failed`
 * gracioso — a extração do áudio já feita não é derrubada. O WAV intermediário é
 * sempre limpo (best-effort), em qualquer desfecho.
 *
 * @param inputPath - Caminho absoluto do vídeo já baixado no cache.
 * @param options - Transcritor + deps injetáveis + mime/logger — ver {@link ExtractVideoTranscriptOptions}.
 * @returns O {@link ExtractionResult} da transcrição no sucesso; `failed` com motivo
 *   claro em qualquer falha de etapa.
 * @example
 * const extractor = await createWhisperExtractor();
 * const result = await extractVideoTranscript('/cache/att/clip.mp4', {
 *   mime: 'video/mp4',
 *   transcriber: extractor,
 * });
 */
export async function extractVideoTranscript(
  inputPath: string,
  options: ExtractVideoTranscriptOptions,
): Promise<ExtractionResult> {
  const mime = options.mime ?? DEFAULT_TRANSCRIBE_MIME;
  const convert =
    options.convert ??
    ((path: string): Promise<WavConversionResult> =>
      convertVideoToWav(path, {
        ...(options.convertOptions ?? {}),
        ...(options.logger !== undefined ? { logger: options.logger } : {}),
      }));

  const conversion = await convert(inputPath);
  if (conversion.status === 'failed') {
    return conversionFailure(mime, conversion);
  }

  const rm = options.rm ?? ((path: string): Promise<void> => fsRm(path, { force: true }));
  const wavPath = conversion.wavPath;
  const extractOptions: ExtractOptions = {
    mime,
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  };

  try {
    return await options.transcriber.extract(wavPath, extractOptions);
  } catch (error) {
    // Reason: o extrator whisper é gracioso por contrato, mas um transcritor
    // hostil/quebrado não pode derrubar o bundle — degrada para failed (ADR-002).
    return {
      status: 'failed',
      mime,
      metadata: {
        extractorId: PIPELINE_EXTRACTOR_ID,
        reason: 'erro-transcricao',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    // O WAV é um artefato intermediário do cache temp; descarta em qualquer
    // desfecho para não acumular lixo (convenção de `audio.ts`/`download.ts`).
    await rm(wavPath).catch(() => undefined);
  }
}
