/**
 * Sonda de DURAÇÃO de vídeo via `ffprobe` (M4-09, #65, ADR-002).
 *
 * Mede a duração de um vídeo ANTES de convertê-lo/transcrevê-lo, para que o
 * pipeline ({@link extractVideoTranscript}) possa PULAR com aviso os vídeos que
 * excedem o limite configurável (default 20 min, ADR-002) — sem gastar CPU na
 * conversão/transcrição de mídia longa.
 *
 * Extraído de `video.ts` para manter cada módulo sob o limite de tamanho e com um
 * propósito único (Rule #24): aqui vive SÓ a sondagem de duração; a orquestração
 * (skip + preservação do keyframe) permanece em `video.ts`.
 *
 * DECISÕES DE SEGURANÇA/ROBUSTEZ (ADR-002), como no restante da milestone:
 * - INVOCAÇÃO SEM SHELL: reusa {@link runWithWatchdog} (`execFile`), lista de args
 *   explícita — o `inputPath` NUNCA é interpolado numa string de shell.
 * - `-protocol_whitelist file`: o ffprobe só pode abrir o arquivo local dado, nunca
 *   protocolos remotos embutidos em playlists/manifests hostis.
 * - ENV SANITIZADO: só `PATH` — segredos do processo pai não vazam para o ffprobe.
 * - TIMEOUT + KILL: watchdog `SIGTERM`→ graça →`SIGKILL`.
 * - DEGRADAÇÃO GRACIOSA: ffprobe ausente, exit != 0, timeout ou saída não-parseável
 *   NÃO lançam; devolvem `{ status: 'unavailable', reason }` — o chamador decide o
 *   comportamento seguro (o pipeline PROSSEGUE, não bloqueia).
 *
 * Fronteira: módulo de core (pipeline de extração) — sem `console.*` (ADR-005).
 */

import type { Logger } from '../client/index.js';

import { findFfprobe } from './ffmpeg.js';
import { runWithWatchdog, sanitizedEnv } from './subprocess.js';

/** Timeout default da sonda `ffprobe` antes do `SIGTERM` (ms) — a leitura é rápida. */
const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

/** Graça `SIGTERM` → `SIGKILL` da sonda `ffprobe` (ms). */
const PROBE_KILL_GRACE_MS = 2_000;

/** Teto do stdout/stderr do ffprobe (1 MiB) — a saída é uma única linha (a duração). */
const PROBE_MAX_BUFFER_BYTES = 1024 * 1024;

/** Invocação concreta do `ffprobe` passada ao {@link FfprobeRunner}. */
export interface FfprobeInvocation {
  /** Caminho absoluto do binário `ffprobe` já resolvido. */
  readonly bin: string;
  /** Argumentos do ffprobe (sem shell), incluindo `-protocol_whitelist file`. */
  readonly args: readonly string[];
  /** Env SANITIZADO do subprocesso (só `PATH`). */
  readonly env: NodeJS.ProcessEnv;
  /** Timeout antes do `SIGTERM` (ms). */
  readonly timeoutMs: number;
  /** Graça `SIGTERM` → `SIGKILL` (ms). */
  readonly killGraceMs: number;
}

/**
 * Executor injetável do subprocesso ffprobe. Resolve com o `stdout` (a duração
 * crua) no sucesso (exit 0); rejeita em falha — com um erro de nome
 * `FfprobeTimeoutError` para sinalizar estouro de timeout.
 */
export type FfprobeRunner = (invocation: FfprobeInvocation) => Promise<string>;

/** Sonda de duração bem-sucedida: duração do container em segundos. */
export interface DurationProbeOk {
  readonly status: 'ok';
  /** Duração total do vídeo em segundos (float), como reportada pelo ffprobe. */
  readonly seconds: number;
}

/**
 * Sonda de duração INDISPONÍVEL (graciosa, ADR-002): o ffprobe está ausente, falhou,
 * estourou o timeout ou devolveu uma duração não-parseável. O chamador decide o
 * comportamento seguro — o pipeline PROSSEGUE sem bloquear (ver {@link extractVideoTranscript}).
 */
export interface DurationProbeUnavailable {
  readonly status: 'unavailable';
  /** Motivo canônico (`ffprobe-nao-instalado` | `duracao-indisponivel` | `erro-ffprobe` | `timeout`). */
  readonly reason: string;
  /** Mensagem de erro subjacente, quando houver. */
  readonly error?: string;
}

/** Resultado tipado da sonda de duração via ffprobe. */
export type DurationProbeResult = DurationProbeOk | DurationProbeUnavailable;

/** Opções (todas injetáveis para testes herméticos) de {@link probeVideoDuration}. */
export interface ProbeVideoDurationOptions {
  /** Localizador do `ffprobe`; default {@link findFfprobe}. */
  readonly findFfprobeBinary?: () => string | undefined;
  /** Executor do subprocesso; default: watchdog real com `execFile`. */
  readonly run?: FfprobeRunner;
  /** Timeout antes do `SIGTERM` (ms); default {@link DEFAULT_PROBE_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Graça `SIGTERM` → `SIGKILL` (ms); default {@link PROBE_KILL_GRACE_MS}. */
  readonly killGraceMs?: number;
  /** Logger para o aviso de binário ausente; sem default de lib (ADR-003). */
  readonly logger?: Logger;
}

/** Erro interno: o watchdog matou o ffprobe por estourar o timeout. */
class FfprobeTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`ffprobe excedeu o timeout de ${timeoutMs}ms e foi encerrado`);
    this.name = 'FfprobeTimeoutError';
  }
}

/**
 * Monta os argumentos do `ffprobe` para ler SÓ a duração do container em `inputPath`,
 * como um número cru em segundos. `-protocol_whitelist file` precede o arquivo de
 * entrada (ADR-002): o ffprobe só pode abrir o arquivo local dado, nunca protocolos
 * remotos embutidos em playlists/manifests hostis. `-of default=nw=1:nk=1` imprime o
 * valor sem chave nem cabeçalho de seção — só o número.
 *
 * @param inputPath - Caminho absoluto do vídeo de entrada.
 * @returns Lista de argumentos, na ordem exigida pelo ffprobe.
 */
function buildFfprobeArgs(inputPath: string): readonly string[] {
  return [
    '-v',
    'error', // silencioso, exceto erros
    '-protocol_whitelist',
    'file', // ADR-002: só o arquivo local dado, nada remoto
    '-show_entries',
    'format=duration', // só a duração do container
    '-of',
    'default=nw=1:nk=1', // saída crua: sem wrapper, sem chave
    inputPath,
  ];
}

/**
 * Executor default da sonda: delega ao watchdog compartilhado
 * ({@link runWithWatchdog}) — ffprobe SEM shell, env sanitizado e escalonamento
 * `SIGTERM` → graça → `SIGKILL`. Diferente do ffmpeg, aqui o `stdout` IMPORTA (é a
 * duração). O estouro de timeout é sinalizado com {@link FfprobeTimeoutError}.
 *
 * @param invocation - Ver {@link FfprobeInvocation}.
 * @returns O `stdout` do ffprobe (a duração crua) no sucesso.
 */
function defaultProbeRun(invocation: FfprobeInvocation): Promise<string> {
  const { bin, args, env, timeoutMs, killGraceMs } = invocation;
  return runWithWatchdog(
    { bin, args, env, timeoutMs, killGraceMs, maxBuffer: PROBE_MAX_BUFFER_BYTES },
    { makeTimeoutError: (ms) => new FfprobeTimeoutError(ms) },
  );
}

/** `true` se o erro sinaliza estouro de timeout da sonda (por nome, robusto a DI). */
function isProbeTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'FfprobeTimeoutError';
}

/**
 * Parseia a duração (segundos, float) da saída crua do `ffprobe`. Devolve
 * `undefined` para saída vazia, `N/A`, não-numérica ou negativa — sinal de que a
 * duração é INDISPONÍVEL (não presumimos zero nem crashamos).
 *
 * @param stdout - Saída crua do ffprobe (`format=duration`, uma linha).
 * @returns A duração em segundos, ou `undefined` se não parseável.
 * @example
 * parseFfprobeDuration('123.45\n'); // 123.45
 * parseFfprobeDuration('N/A');      // undefined
 */
export function parseFfprobeDuration(stdout: string): number | undefined {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return undefined;
  const seconds = Number.parseFloat(trimmed);
  // Reason: `parseFloat('N/A')` → NaN; duração negativa é dado degenerado. Em ambos,
  // tratamos como indisponível em vez de presumir um valor (degradação graciosa).
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds;
}

/**
 * Mede a duração de um vídeo via `ffprobe` ANTES de convertê-lo/transcrevê-lo
 * (M4-09, #65). REUSA o subprocesso seguro compartilhado (sem shell,
 * `-protocol_whitelist file`, env sanitizado, watchdog `SIGTERM`→`SIGKILL`). NUNCA
 * lança (degradação graciosa, ADR-002): ffprobe ausente, exit != 0, timeout ou
 * saída não-parseável viram `{ status: 'unavailable', reason }` — cabe ao chamador
 * decidir o comportamento seguro (o pipeline PROSSEGUE quando a duração é indisponível).
 *
 * @param inputPath - Caminho absoluto do vídeo já baixado no cache.
 * @param options - Deps injetáveis + timeouts + logger — ver {@link ProbeVideoDurationOptions}.
 * @returns `ok` com `seconds` no sucesso; `unavailable` com motivo caso contrário.
 * @example
 * const probe = await probeVideoDuration('/cache/att/clip.mp4');
 * if (probe.status === 'ok' && probe.seconds > 1200) skipTranscription();
 */
export async function probeVideoDuration(
  inputPath: string,
  options: ProbeVideoDurationOptions = {},
): Promise<DurationProbeResult> {
  const findBinary = options.findFfprobeBinary ?? (() => findFfprobe()?.path);
  const bin = findBinary();
  if (bin === undefined) {
    options.logger?.warn(
      'ffprobe: binário não encontrado; a duração do vídeo não será medida ' +
        '(a transcrição segue sem o limite de duração) — instale o ffmpeg/ffprobe (ver doctor)',
    );
    return { status: 'unavailable', reason: 'ffprobe-nao-instalado' };
  }

  const run = options.run ?? defaultProbeRun;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? PROBE_KILL_GRACE_MS;
  const args = buildFfprobeArgs(inputPath);

  try {
    const stdout = await run({ bin, args, env: sanitizedEnv(), timeoutMs, killGraceMs });
    const seconds = parseFfprobeDuration(stdout);
    if (seconds === undefined) {
      return { status: 'unavailable', reason: 'duracao-indisponivel' };
    }
    return { status: 'ok', seconds };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'unavailable',
      reason: isProbeTimeout(error) ? 'timeout' : 'erro-ffprobe',
      error: message,
    };
  }
}
