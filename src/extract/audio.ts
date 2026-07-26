/**
 * Conversão de áudio para WAV 16 kHz mono via `ffmpeg` (M4-04, #60, ADR-002).
 *
 * Prepara um anexo de áudio para a transcrição pelo whisper.cpp (#61, M4-05), que
 * espera PCM 16-bit, 16 kHz, mono. Esta issue cobre SÓ a conversão áudio → WAV; a
 * extração de faixa de áudio a partir de vídeo é a #63 (M4-07) e o extrator
 * whisper é a #61 — nenhum dos dois é implementado aqui.
 *
 * DECISÕES DE SEGURANÇA/ROBUSTEZ (ADR-002), todas exercitadas por testes:
 *
 * - INVOCAÇÃO SEM SHELL: `execFile` (nunca `exec`/shell) com lista de argumentos
 *   explícita — o `inputPath` NUNCA é interpolado numa string de shell.
 * - `-protocol_whitelist file`: o ffmpeg só pode abrir o arquivo local dado, nunca
 *   protocolos remotos embutidos em playlists/manifests hostis (asserção explícita
 *   nos args pelo teste).
 * - ENV SANITIZADO: o subprocesso recebe um env MÍNIMO (só `PATH`) — segredos do
 *   processo pai (ex.: `REDMINE_API_KEY`) NUNCA vazam para o ffmpeg.
 * - TIMEOUT + KILL: watchdog envia `SIGTERM` no timeout e, após a graça, `SIGKILL`
 *   — um ffmpeg travado não pendura a fila de jobs.
 * - DEGRADAÇÃO GRACIOSA: binário ausente, exit != 0 ou timeout NÃO lançam; devolvem
 *   {@link WavConversionResult} com `status: 'failed'` + motivo legível, sem quebrar
 *   o bundle.
 *
 * TESTABILIDADE: o executor do subprocesso, o localizador do ffmpeg, o dir temp e o
 * `mkdir` são INJETÁVEIS — os testes unitários são herméticos (sem ffmpeg/FS reais)
 * e asseguram os args passados ao executor.
 */

import { randomUUID } from 'node:crypto';
import { mkdir as fsMkdir, rm as fsRm } from 'node:fs/promises';
import { join } from 'node:path';

import envPaths from 'env-paths';

import type { Logger } from '../client/index.js';
import type { ExtractionStatus } from '../contract.js';

import { findFfmpeg } from './ffmpeg.js';
import { runWithWatchdog, sanitizedEnv } from './subprocess.js';

/** Nome da aplicação para `env-paths` — em sincronia com o cache de anexos (ADR-004). */
const APP_NAME = 'redmine-context';

/** Subdiretório TEMP do cache onde os WAVs transcodificados são gravados. */
const TEMP_SUBDIR = 'tmp';

/** Taxa de amostragem alvo (Hz) — o whisper.cpp opera a 16 kHz. */
const TARGET_SAMPLE_RATE = '16000';

/** Número de canais alvo — mono (downmix de estéreo quando necessário). */
const TARGET_CHANNELS = '1';

/** Timeout default de uma conversão antes do `SIGTERM` (ms). */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Graça entre `SIGTERM` e `SIGKILL` (ms) — dá ao ffmpeg chance de sair limpo. */
const DEFAULT_KILL_GRACE_MS = 2_000;

/** Teto do stdout/stderr capturado (8 MiB) — o ffmpeg é conciso em `-loglevel error`. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * Diretório canônico do cache onde os WAVs temporários são gravados — `env-paths`
 * cache do usuário (por SO) + `/tmp`. Mesmo mecanismo dos demais módulos de mídia
 * ({@link whisperModelDir}).
 *
 * @returns Caminho absoluto do dir temp (ex.: `~/Library/Caches/redmine-context/tmp`).
 * @example
 * const dir = audioTempDir();
 */
export function audioTempDir(): string {
  return join(envPaths(APP_NAME).cache, TEMP_SUBDIR);
}

/** Invocação concreta do ffmpeg passada ao {@link FfmpegRunner}. */
export interface FfmpegInvocation {
  /** Caminho absoluto do binário `ffmpeg` já resolvido. */
  readonly bin: string;
  /** Argumentos do ffmpeg (sem shell), incluindo `-protocol_whitelist file`. */
  readonly args: readonly string[];
  /** Env SANITIZADO do subprocesso (só `PATH`). */
  readonly env: NodeJS.ProcessEnv;
  /** Timeout antes do `SIGTERM` (ms). */
  readonly timeoutMs: number;
  /** Graça `SIGTERM` → `SIGKILL` (ms). */
  readonly killGraceMs: number;
  /**
   * Sinal de CANCELAMENTO (#69/#73) repassado ao {@link runWithWatchdog}, que MATA
   * o ffmpeg (`SIGTERM`→`SIGKILL`) ao abortar. Opcional/aditivo (respeita
   * `exactOptionalPropertyTypes` — nunca injetado como `undefined`).
   */
  readonly signal?: AbortSignal;
}

/**
 * Executor injetável do subprocesso ffmpeg. Resolve no sucesso (exit 0); rejeita
 * em falha (exit != 0, binário não-executável em runtime) — rejeitando com um erro
 * de nome `FfmpegTimeoutError` para sinalizar estouro de timeout.
 */
export type FfmpegRunner = (invocation: FfmpegInvocation) => Promise<void>;

/** Sucesso da conversão: caminho do WAV 16 kHz mono gravado no dir temp. */
export interface WavConversionSuccess {
  readonly status: Extract<ExtractionStatus, 'done'>;
  /** Caminho absoluto do WAV produzido no dir temp do cache. */
  readonly wavPath: string;
}

/** Falha graciosa da conversão (ADR-002) — nunca lança, sempre traz um motivo. */
export interface WavConversionFailure {
  readonly status: Extract<ExtractionStatus, 'failed'>;
  /** Motivo canônico da falha (`ffmpeg-nao-instalado` | `erro-conversao` | `timeout`). */
  readonly reason: string;
  /** Mensagem de erro subjacente, quando houver. */
  readonly error?: string;
  /** Dica de remediação (ex.: como instalar o ffmpeg). */
  readonly hint?: string;
}

/**
 * Resultado tipado da conversão áudio → WAV. Reutiliza o vocabulário de status do
 * core ({@link ExtractionStatus}) — sem status paralelo.
 */
export type WavConversionResult = WavConversionSuccess | WavConversionFailure;

/** Opções (todas injetáveis para testes herméticos) de {@link convertAudioToWav}. */
export interface ConvertAudioToWavOptions {
  /**
   * Localizador do binário `ffmpeg`; retorna o caminho absoluto ou `undefined`
   * (não instalado). Default: {@link findFfmpeg} no ambiente real.
   */
  readonly findFfmpegBinary?: () => string | undefined;
  /** Executor do subprocesso; default: watchdog real com `execFile`. */
  readonly run?: FfmpegRunner;
  /** Dir temp de saída; default: {@link audioTempDir}. */
  readonly tempDir?: string;
  /** Criador de diretório (recursivo); default: `fs/promises.mkdir`. */
  readonly mkdir?: (dir: string) => Promise<void>;
  /** Remove o `.wav` parcial na falha (best-effort); default: `fs/promises.rm` com `force`. */
  readonly rm?: (path: string) => Promise<void>;
  /** Timeout antes do `SIGTERM` (ms); default {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Graça `SIGTERM` → `SIGKILL` (ms); default {@link DEFAULT_KILL_GRACE_MS}. */
  readonly killGraceMs?: number;
  /**
   * Sinal de CANCELAMENTO (#69/#73) repassado à invocação/`runWithWatchdog`, que
   * MATA o ffmpeg ao abortar. Opcional/aditivo (respeita `exactOptionalPropertyTypes`).
   */
  readonly signal?: AbortSignal;
  /** Logger para o aviso de binário ausente; sem default de lib (ADR-003). */
  readonly logger?: Logger;
}

/** Erro interno: o watchdog matou o ffmpeg por estourar o timeout. */
class FfmpegTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`ffmpeg excedeu o timeout de ${timeoutMs}ms e foi encerrado`);
    this.name = 'FfmpegTimeoutError';
  }
}

/**
 * Monta os argumentos do ffmpeg para transcodificar `inputPath` → WAV PCM 16-bit,
 * 16 kHz, mono em `outputPath`. `-protocol_whitelist file` (opção de INPUT) precede
 * o `-i`; as opções de saída (`-ar`/`-ac`/`-c:a`/`-f`) vêm depois.
 *
 * @param inputPath - Caminho absoluto do áudio de entrada.
 * @param outputPath - Caminho absoluto do WAV de saída.
 * @returns Lista de argumentos, na ordem exigida pelo ffmpeg.
 */
function buildFfmpegArgs(inputPath: string, outputPath: string): readonly string[] {
  return [
    '-nostdin', // não consome stdin (execução headless)
    '-loglevel',
    'error', // silencioso, exceto erros
    '-protocol_whitelist',
    'file', // ADR-002: só o arquivo local dado, nada remoto
    '-i',
    inputPath,
    '-vn', // descarta qualquer faixa de vídeo do container
    '-ar',
    TARGET_SAMPLE_RATE,
    '-ac',
    TARGET_CHANNELS,
    '-c:a',
    'pcm_s16le', // PCM 16-bit little-endian, o que o whisper.cpp lê
    '-f',
    'wav',
    '-y', // sobrescreve o destino (nome único, mas defensivo)
    outputPath,
  ];
}

/**
 * Executor default: delega ao watchdog compartilhado ({@link runWithWatchdog}) —
 * ffmpeg SEM shell, env sanitizado e escalonamento `SIGTERM` → graça → `SIGKILL`.
 * O stdout é irrelevante para a conversão (o WAV é escrito em disco); só o exit
 * importa. O estouro de timeout é sinalizado com {@link FfmpegTimeoutError} para
 * preservar a classificação de falha (`reason: 'timeout'`).
 *
 * @param invocation - Ver {@link FfmpegInvocation}.
 * @returns Promessa resolvida no sucesso do ffmpeg.
 */
function defaultRun(invocation: FfmpegInvocation): Promise<void> {
  const { bin, args, env, timeoutMs, killGraceMs, signal } = invocation;
  return runWithWatchdog(
    {
      bin,
      args,
      env,
      timeoutMs,
      killGraceMs,
      maxBuffer: MAX_BUFFER_BYTES,
      ...(signal !== undefined ? { signal } : {}),
    },
    { makeTimeoutError: (ms) => new FfmpegTimeoutError(ms) },
  ).then(() => undefined);
}

/** `true` se o erro sinaliza estouro de timeout do watchdog (por nome, robusto a DI). */
function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'FfmpegTimeoutError';
}

/**
 * Converte um arquivo de áudio para WAV PCM 16-bit, 16 kHz, mono no dir temp do
 * cache — o formato que o whisper.cpp (#61) consome. NUNCA lança: binário ausente,
 * exit != 0 ou timeout viram `{ status: 'failed', reason }` (degradação graciosa,
 * ADR-002), preservando o bundle.
 *
 * @param inputPath - Caminho absoluto do áudio de entrada já baixado no cache.
 * @param options - Deps injetáveis + timeouts + logger — ver {@link ConvertAudioToWavOptions}.
 * @returns `done` com `wavPath` no sucesso; `failed` com motivo claro na falha.
 * @example
 * const result = await convertAudioToWav('/cache/att/original.mp3');
 * if (result.status === 'done') transcribe(result.wavPath);
 */
export async function convertAudioToWav(
  inputPath: string,
  options: ConvertAudioToWavOptions = {},
): Promise<WavConversionResult> {
  const findBinary = options.findFfmpegBinary ?? (() => findFfmpeg()?.path);
  const bin = findBinary();
  if (bin === undefined) {
    options.logger?.warn(
      'ffmpeg: binário não encontrado no PATH nem em locais convencionais; ' +
        'instale o ffmpeg (ex.: `brew install ffmpeg`) — veja o doctor',
    );
    return {
      status: 'failed',
      reason: 'ffmpeg-nao-instalado',
      hint: 'instale o ffmpeg; o doctor (#57) valida a instalação e orienta por SO',
    };
  }

  const run = options.run ?? defaultRun;
  const tempDir = options.tempDir ?? audioTempDir();
  const mkdir = options.mkdir ?? ((dir: string): Promise<void> => fsMkdir(dir, { recursive: true }).then(() => undefined));
  const rm = options.rm ?? ((path: string): Promise<void> => fsRm(path, { force: true }));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const signal = options.signal;

  // Nome único evita colisão entre conversões concorrentes no mesmo dir temp.
  const outputPath = join(tempDir, `${randomUUID()}.wav`);
  const args = buildFfmpegArgs(inputPath, outputPath);

  try {
    await mkdir(tempDir);
    await run({
      bin,
      args,
      env: sanitizedEnv(),
      timeoutMs,
      killGraceMs,
      ...(signal !== undefined ? { signal } : {}),
    });
    return { status: 'done', wavPath: outputPath };
  } catch (error) {
    // O ffmpeg com `-y` pode ter criado um WAV parcial/zerado; descarta-o para não
    // acumular lixo no cache temp (convenção de `download.ts`). Best-effort.
    await rm(outputPath).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      reason: isTimeoutError(error) ? 'timeout' : 'erro-conversao',
      error: message,
    };
  }
}
