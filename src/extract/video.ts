/**
 * Extração da faixa de áudio de VÍDEO + pipeline vídeo→áudio→transcrição
 * (M4-07, #63, ADR-002) + keyframe representativo (M4-08, #64).
 *
 * KEYFRAME (M4-08, #64): {@link extractVideoKeyframe} grava 1 frame JPEG no DIR DO
 * ANEXO (ao lado do `original`, ADR-004), reusando o MESMO subprocesso seguro
 * (sem shell, `-protocol_whitelist file`, env sanitizado, watchdog) — o keyframe é
 * um EXTRA: sua falha (ffmpeg ausente/erro/timeout) NUNCA afeta a transcrição
 * (degradação graciosa). O bundle apenas REFERENCIA o keyframe pelo cache path (via
 * {@link ExtractionArtifact}); o binário jamais é embutido (o MCP é read-only/texto).
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

import { mkdir as fsMkdir, rm as fsRm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Logger } from '../client/index.js';
import type { ExtractionArtifact, ExtractionResult } from '../contract.js';

import {
  convertAudioToWav,
  type ConvertAudioToWavOptions,
  type FfmpegInvocation,
  type FfmpegRunner,
  type WavConversionFailure,
  type WavConversionResult,
} from './audio.js';
import type { ExtractOptions, Extractor } from './dispatcher.js';
import { findFfmpeg } from './ffmpeg.js';
import { runWithWatchdog, sanitizedEnv } from './subprocess.js';

/** Identificador do pipeline (entra em metadados de resultados de falha da conversão). */
const PIPELINE_EXTRACTOR_ID = 'video-transcribe';

/** Nome-base fixo do keyframe gravado no dir do anexo (ADR-004: 1 por id+digest). */
const KEYFRAME_BASENAME = 'keyframe.jpg';

/** MIME do keyframe extraído (JPEG) — vira o `mime` do artefato no bundle. */
const KEYFRAME_MIME = 'image/jpeg';

/** Tipo do artefato de keyframe no {@link ExtractionArtifact} (referência no bundle). */
const KEYFRAME_ARTIFACT_KIND = 'keyframe';

/** Timeout default da extração do keyframe (ms) — 1 frame é rápido. */
const DEFAULT_KEYFRAME_TIMEOUT_MS = 30_000;

/** Graça entre `SIGTERM` e `SIGKILL` do keyframe (ms). */
const KEYFRAME_KILL_GRACE_MS = 2_000;

/** Teto do stdout/stderr do ffmpeg do keyframe (2 MiB) — conciso em `-loglevel error`. */
const KEYFRAME_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

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

/** Sucesso da extração do keyframe: caminho da imagem gravada no dir do anexo. */
export interface KeyframeSuccess {
  readonly status: 'done';
  /** Caminho absoluto do keyframe (`.../attachments/<id>-<digest8>/keyframe.jpg`). */
  readonly keyframePath: string;
}

/** Falha graciosa da extração do keyframe (ADR-002) — nunca lança, sempre traz motivo. */
export interface KeyframeFailure {
  readonly status: 'failed';
  /** Motivo canônico (`ffmpeg-nao-instalado` | `erro-keyframe` | `timeout`). */
  readonly reason: string;
  /** Mensagem de erro subjacente, quando houver. */
  readonly error?: string;
  /** Dica de remediação (ex.: como instalar o ffmpeg). */
  readonly hint?: string;
}

/** Resultado tipado da extração do keyframe. */
export type KeyframeResult = KeyframeSuccess | KeyframeFailure;

/** Opções (todas injetáveis para testes herméticos) de {@link extractVideoKeyframe}. */
export interface ExtractKeyframeOptions {
  /** Localizador do `ffmpeg`; default {@link findFfmpeg}. */
  readonly findFfmpegBinary?: () => string | undefined;
  /** Executor do subprocesso; default: watchdog real com `execFile`. */
  readonly run?: FfmpegRunner;
  /**
   * Caminho de saída do keyframe; default: `keyframe.jpg` no MESMO dir do anexo de
   * entrada (`dirname(inputPath)`), coexistindo com o `original` do anexo (ADR-004).
   */
  readonly outputPath?: string;
  /** Criador de diretório (recursivo); default: `fs/promises.mkdir`. */
  readonly mkdir?: (dir: string) => Promise<void>;
  /** Remove o `.jpg` parcial na falha (best-effort); default: `fs/promises.rm` com `force`. */
  readonly rm?: (path: string) => Promise<void>;
  /** Timeout antes do `SIGTERM` (ms); default {@link DEFAULT_KEYFRAME_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Graça `SIGTERM` → `SIGKILL` (ms); default {@link KEYFRAME_KILL_GRACE_MS}. */
  readonly killGraceMs?: number;
  /** Logger para o aviso de binário ausente; sem default de lib (ADR-003). */
  readonly logger?: Logger;
}

/** Erro interno: o watchdog matou o ffmpeg do keyframe por estourar o timeout. */
class KeyframeTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`ffmpeg (keyframe) excedeu o timeout de ${timeoutMs}ms e foi encerrado`);
    this.name = 'FfmpegTimeoutError';
  }
}

/**
 * Monta os argumentos do ffmpeg para extrair 1 frame representativo de `inputPath`
 * como JPEG em `outputPath`. `-protocol_whitelist file` (opção de INPUT) precede o
 * `-i` (ADR-002); `-frames:v 1` limita a saída a um único frame e `-q:v 2` fixa alta
 * qualidade JPEG.
 *
 * Reason: extraímos o PRIMEIRO frame decodável (sem `-ss`) porque um seek a um ponto
 * arbitrário falharia em vídeos muito curtos; 1 frame no início é suficiente como
 * referência visual (MVP, ADR-002), sem sondar a duração (over-engineering).
 *
 * @param inputPath - Caminho absoluto do vídeo de entrada.
 * @param outputPath - Caminho absoluto do keyframe JPEG de saída.
 * @returns Lista de argumentos, na ordem exigida pelo ffmpeg.
 */
function buildKeyframeArgs(inputPath: string, outputPath: string): readonly string[] {
  return [
    '-nostdin', // não consome stdin (execução headless)
    '-loglevel',
    'error', // silencioso, exceto erros
    '-protocol_whitelist',
    'file', // ADR-002: só o arquivo local dado, nada remoto
    '-i',
    inputPath,
    '-frames:v',
    '1', // exatamente 1 frame
    '-q:v',
    '2', // alta qualidade JPEG
    '-y', // sobrescreve o destino (nome fixo por anexo)
    outputPath,
  ];
}

/**
 * Executor default do keyframe: delega ao watchdog compartilhado
 * ({@link runWithWatchdog}) — ffmpeg SEM shell, env sanitizado e escalonamento
 * `SIGTERM` → graça → `SIGKILL`. O estouro de timeout é sinalizado com
 * {@link KeyframeTimeoutError} (nome `FfmpegTimeoutError`) para classificar a falha.
 *
 * @param invocation - Ver {@link FfmpegInvocation}.
 * @returns Promessa resolvida no sucesso do ffmpeg.
 */
function defaultKeyframeRun(invocation: FfmpegInvocation): Promise<void> {
  const { bin, args, env, timeoutMs, killGraceMs } = invocation;
  return runWithWatchdog(
    { bin, args, env, timeoutMs, killGraceMs, maxBuffer: KEYFRAME_MAX_BUFFER_BYTES },
    { makeTimeoutError: (ms) => new KeyframeTimeoutError(ms) },
  ).then(() => undefined);
}

/** `true` se o erro sinaliza estouro de timeout do watchdog (por nome, robusto a DI). */
function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'FfmpegTimeoutError';
}

/**
 * Extrai 1 keyframe representativo de um vídeo como JPEG no DIR DO ANEXO (ao lado do
 * `original`, ADR-004), REUSANDO o subprocesso seguro compartilhado (sem shell,
 * `-protocol_whitelist file`, env sanitizado, watchdog `SIGTERM`→`SIGKILL`). NUNCA
 * lança (degradação graciosa, ADR-002): binário ausente, exit != 0 ou timeout viram
 * `{ status: 'failed', reason }`. O keyframe é um EXTRA — sua falha jamais derruba o
 * pipeline de transcrição (ver {@link extractVideoTranscript}).
 *
 * @param inputPath - Caminho absoluto do vídeo já baixado no cache (`.../original.mp4`).
 * @param options - Deps injetáveis + timeouts + logger — ver {@link ExtractKeyframeOptions}.
 * @returns `done` com `keyframePath` no sucesso; `failed` com motivo claro na falha.
 * @example
 * const kf = await extractVideoKeyframe('/cache/att/12-ab/original.mp4');
 * if (kf.status === 'done') referenceInBundle(kf.keyframePath);
 */
export async function extractVideoKeyframe(
  inputPath: string,
  options: ExtractKeyframeOptions = {},
): Promise<KeyframeResult> {
  const findBinary = options.findFfmpegBinary ?? (() => findFfmpeg()?.path);
  const bin = findBinary();
  if (bin === undefined) {
    options.logger?.warn(
      'ffmpeg: binário não encontrado; keyframe do vídeo não será extraído ' +
        '(a transcrição segue normalmente) — instale o ffmpeg (ver doctor)',
    );
    return {
      status: 'failed',
      reason: 'ffmpeg-nao-instalado',
      hint: 'instale o ffmpeg; o keyframe é opcional e não bloqueia a transcrição',
    };
  }

  const run = options.run ?? defaultKeyframeRun;
  const outputPath = options.outputPath ?? join(dirname(inputPath), KEYFRAME_BASENAME);
  const mkdir =
    options.mkdir ?? ((dir: string): Promise<void> => fsMkdir(dir, { recursive: true }).then(() => undefined));
  const rm = options.rm ?? ((path: string): Promise<void> => fsRm(path, { force: true }));
  const timeoutMs = options.timeoutMs ?? DEFAULT_KEYFRAME_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? KEYFRAME_KILL_GRACE_MS;
  const args = buildKeyframeArgs(inputPath, outputPath);

  try {
    await mkdir(dirname(outputPath));
    await run({ bin, args, env: sanitizedEnv(), timeoutMs, killGraceMs });
    return { status: 'done', keyframePath: outputPath };
  } catch (error) {
    // O ffmpeg com `-y` pode ter criado um JPEG parcial; descarta-o (best-effort).
    await rm(outputPath).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      reason: isTimeoutError(error) ? 'timeout' : 'erro-keyframe',
      error: message,
    };
  }
}

/**
 * Anexa o resultado do keyframe a um {@link ExtractionResult} da transcrição SEM
 * jamais alterar seu `status`/`text` (o keyframe é um EXTRA, ADR-002). No sucesso,
 * adiciona um {@link ExtractionArtifact} `keyframe` (cache path + mime) que o bundle
 * REFERENCIA — o binário nunca é embutido. Na falha, registra `keyframeReason` em
 * `metadata` como sinal diagnóstico, preservando o resultado da transcrição intacto.
 *
 * @param result - Resultado da transcrição (ou da falha de conversão) a enriquecer.
 * @param keyframe - Desfecho da extração do keyframe.
 * @returns Um novo {@link ExtractionResult} com o keyframe referenciado/anotado.
 */
function attachKeyframe(result: ExtractionResult, keyframe: KeyframeResult): ExtractionResult {
  if (keyframe.status === 'done') {
    const artifact: ExtractionArtifact = {
      kind: KEYFRAME_ARTIFACT_KIND,
      path: keyframe.keyframePath,
      mime: KEYFRAME_MIME,
    };
    return { ...result, artifacts: [...(result.artifacts ?? []), artifact] };
  }
  return {
    ...result,
    metadata: { ...(result.metadata ?? {}), keyframeReason: keyframe.reason },
  };
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
  /**
   * Extração do keyframe (EXTRA do vídeo); default: {@link extractVideoKeyframe} com
   * o `logger` repassado. Injetável para testes herméticos. Nunca afeta a transcrição.
   */
  readonly extractKeyframe?: (inputPath: string) => Promise<KeyframeResult>;
  /** Opções repassadas à extração default do keyframe (binário, timeouts, outputPath). */
  readonly keyframeOptions?: ExtractKeyframeOptions;
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

  // O keyframe é um EXTRA independente da transcrição (ADR-002): é extraído mesmo
  // quando o vídeo não tem áudio (um frame ainda é uma referência visual útil) e
  // JAMAIS derruba o pipeline — `extractVideoKeyframe` é gracioso e o `.catch`
  // blinda contra um extrator injetado hostil que lance.
  const extractKeyframe =
    options.extractKeyframe ??
    ((path: string): Promise<KeyframeResult> =>
      extractVideoKeyframe(path, {
        ...(options.keyframeOptions ?? {}),
        ...(options.logger !== undefined ? { logger: options.logger } : {}),
      }));
  const keyframe = await extractKeyframe(inputPath).catch(
    (error: unknown): KeyframeResult => ({
      status: 'failed',
      reason: 'erro-keyframe',
      error: error instanceof Error ? error.message : String(error),
    }),
  );

  const conversion = await convert(inputPath);
  if (conversion.status === 'failed') {
    return attachKeyframe(conversionFailure(mime, conversion), keyframe);
  }

  const rm = options.rm ?? ((path: string): Promise<void> => fsRm(path, { force: true }));
  const wavPath = conversion.wavPath;
  const extractOptions: ExtractOptions = {
    mime,
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  };

  try {
    const transcript = await options.transcriber.extract(wavPath, extractOptions);
    return attachKeyframe(transcript, keyframe);
  } catch (error) {
    // Reason: o extrator whisper é gracioso por contrato, mas um transcritor
    // hostil/quebrado não pode derrubar o bundle — degrada para failed (ADR-002).
    return attachKeyframe(
      {
        status: 'failed',
        mime,
        metadata: {
          extractorId: PIPELINE_EXTRACTOR_ID,
          reason: 'erro-transcricao',
          error: error instanceof Error ? error.message : String(error),
        },
      },
      keyframe,
    );
  } finally {
    // O WAV é um artefato intermediário do cache temp; descarta em qualquer
    // desfecho para não acumular lixo (convenção de `audio.ts`/`download.ts`).
    await rm(wavPath).catch(() => undefined);
  }
}
