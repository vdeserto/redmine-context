/**
 * Utilitário COMPARTILHADO de subprocesso para os extratores de mídia (M4-10.2,
 * #68, ADR-002).
 *
 * Consolida num único lugar as duas garantias de segurança/robustez que antes
 * eram duplicadas (≥3 cópias) em {@link convertAudioToWav}, {@link WhisperExtractor}
 * e {@link TesseractExtractor} — a review do #60 apontou essa duplicação como
 * dívida:
 *
 * 1. **ENV SANITIZADO** ({@link sanitizedEnv}): o subprocesso recebe um env MÍNIMO
 *    e por ALLOWLIST — só `PATH` (com fallback), o que o chamador permitir
 *    explicitamente (ex.: `TESSDATA_PREFIX` do tesseract) e, no Windows, um punhado
 *    de variáveis NÃO-SECRETAS essenciais (`SystemRoot`/`windir`) para robustez
 *    (sugestão da review do #60). Segredos do processo pai (ex.: `REDMINE_API_KEY`)
 *    NUNCA são propagados — o env é montado por inclusão, não por herança.
 *
 * 2. **WATCHDOG DE TIMEOUT + KILL** ({@link runWithWatchdog}): roda o binário SEM
 *    shell (`execFile`) e, se estourar o timeout, envia `SIGTERM` e — após a graça
 *    — `SIGKILL`, rejeitando com um erro de timeout. Um binário travado NUNCA
 *    pendura a fila de jobs nem deixa PROCESSO ZUMBI (o `kill` encerra o child).
 *
 * TESTABILIDADE: `platform`/`source` do env e o `execFile` do watchdog são
 * INJETÁVEIS — os três SOs e o escalonamento `SIGTERM`→`SIGKILL` são testáveis num
 * único host, com fake timers e sem subprocesso real. O erro de timeout é
 * INJETÁVEL (`makeTimeoutError`) para que cada extrator preserve seu tipo de erro
 * canônico (ex.: `FfmpegTimeoutError`) sem duplicar o watchdog.
 *
 * Fronteira: módulo de core (pipeline de extração) — sem `console.*` (ADR-005) e
 * sem importar de `src/surfaces/**`.
 */

import { execFile as nodeExecFile } from 'node:child_process';

/**
 * Variáveis NÃO-SECRETAS essenciais no Windows, preservadas por {@link sanitizedEnv}
 * para robustez (sem elas, alguns binários nativos falham ao resolver caminhos do
 * sistema). Nenhuma carrega segredo — são metadados de instalação do SO.
 */
const WINDOWS_ESSENTIAL_ENV = ['SystemRoot', 'windir', 'SystemDrive', 'PATHEXT'] as const;

/** `PATH` mínimo usado quando a origem não o define (ambientes muito enxutos). */
const FALLBACK_PATH = '/usr/bin:/bin';

/** Opções de {@link sanitizedEnv} — todas injetáveis para testes multi-SO. */
export interface SanitizedEnvOptions {
  /** SO alvo; default `process.platform`. Decide as variáveis essenciais do Windows. */
  readonly platform?: NodeJS.Platform;
  /** Env de origem; default `process.env`. É LIDO por allowlist, nunca herdado inteiro. */
  readonly source?: NodeJS.ProcessEnv;
  /**
   * Chaves adicionais permitidas ALÉM de `PATH` (ex.: `TESSDATA_PREFIX`). Cada
   * chave só entra no resultado se estiver definida na origem (respeita
   * `exactOptionalPropertyTypes`).
   */
  readonly allow?: readonly string[];
}

/**
 * Monta o env MÍNIMO e EXPLÍCITO de um subprocesso por ALLOWLIST (ADR-002). O
 * resultado contém `PATH` (com fallback) mais, apenas se definidas na origem, as
 * chaves de {@link SanitizedEnvOptions.allow} e — no Windows — as variáveis
 * essenciais não-secretas ({@link WINDOWS_ESSENTIAL_ENV}). Nenhum segredo do
 * processo pai (ex.: `REDMINE_API_KEY`) é propagado.
 *
 * @param options - Plataforma, origem e allowlist — ver {@link SanitizedEnvOptions}.
 * @returns Env sanitizado, seguro para passar a `execFile`.
 * @example
 * sanitizedEnv();                              // { PATH } (+ essenciais no Windows)
 * sanitizedEnv({ allow: ['TESSDATA_PREFIX'] }); // + TESSDATA_PREFIX, se definida
 */
export function sanitizedEnv(options: SanitizedEnvOptions = {}): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform;
  const source = options.source ?? process.env;
  const env: NodeJS.ProcessEnv = { PATH: source.PATH ?? FALLBACK_PATH };

  const allowed =
    platform === 'win32'
      ? [...WINDOWS_ESSENTIAL_ENV, ...(options.allow ?? [])]
      : (options.allow ?? []);

  for (const key of allowed) {
    const value = source[key];
    // Reason: só inclui a chave quando há valor — nunca injeta `undefined`
    // (exactOptionalPropertyTypes) e mantém o env estritamente mínimo.
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/** Child mínimo que o watchdog precisa: só a capacidade de enviar um sinal de kill. */
export interface WatchdogChild {
  /** Envia um sinal ao processo; retorna `true` se o sinal foi entregue. */
  kill(signal: NodeJS.Signals): boolean;
}

/** Callback do `execFile` na forma `(error, stdout, stderr)` com `encoding: 'utf8'`. */
type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

/**
 * Forma estrutural do `execFile` que o watchdog usa (sem shell, `encoding: 'utf8'`).
 * Injetável nos testes por um fake determinístico, sem tocar `child_process` real.
 */
export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv; readonly encoding: 'utf8'; readonly maxBuffer: number; readonly windowsHide: boolean },
  callback: ExecFileCallback,
) => WatchdogChild;

/** Invocação concreta de um subprocesso vigiado pelo {@link runWithWatchdog}. */
export interface WatchdogInvocation {
  /** Caminho absoluto do binário já resolvido. */
  readonly bin: string;
  /** Argumentos (sem shell) — lista explícita, nunca interpolada. */
  readonly args: readonly string[];
  /** Env SANITIZADO do subprocesso (ver {@link sanitizedEnv}). */
  readonly env: NodeJS.ProcessEnv;
  /** Timeout antes do `SIGTERM` (ms). */
  readonly timeoutMs: number;
  /** Graça entre `SIGTERM` e `SIGKILL` (ms). */
  readonly killGraceMs: number;
  /** Teto do stdout/stderr capturado (bytes). */
  readonly maxBuffer: number;
  /**
   * Sinal de CANCELAMENTO (#69, ADR-005). Quando dispara, o subprocesso é MORTO
   * com o mesmo escalonamento do timeout (`SIGTERM`→ graça →`SIGKILL`) e a
   * Promise rejeita com {@link SubprocessAbortedError} (ou o erro de
   * {@link WatchdogDeps.makeAbortError}). Se já estiver `aborted` na chamada, o
   * processo é morto de imediato. Campo OPCIONAL e ADITIVO — extratores que não
   * o passam mantêm exatamente o comportamento anterior (#68).
   */
  readonly signal?: AbortSignal;
}

/** Dependências injetáveis de {@link runWithWatchdog} — defaults de produção. */
export interface WatchdogDeps {
  /** Spawner sem shell; default: `execFile` de `node:child_process`. */
  readonly execFile?: ExecFileLike;
  /**
   * Fábrica do erro rejeitado no timeout. Default: {@link SubprocessTimeoutError}.
   * Cada extrator injeta seu erro canônico (ex.: `FfmpegTimeoutError`) para manter
   * a classificação de falha existente sem reimplementar o watchdog.
   */
  readonly makeTimeoutError?: (timeoutMs: number) => Error;
  /**
   * Fábrica do erro rejeitado no cancelamento via `AbortSignal` (#69). Default:
   * {@link SubprocessAbortedError}. Injetável para que um extrator preserve seu
   * tipo de erro canônico ao ser cancelado, sem reimplementar o watchdog.
   */
  readonly makeAbortError?: () => Error;
}

/** Erro default do watchdog: o subprocesso estourou o timeout e foi encerrado. */
export class SubprocessTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`subprocesso excedeu o timeout de ${timeoutMs}ms e foi encerrado`);
    this.name = 'SubprocessTimeoutError';
  }
}

/** Erro default do watchdog quando o subprocesso é MORTO por cancelamento (#69). */
export class SubprocessAbortedError extends Error {
  constructor() {
    super('subprocesso cancelado via AbortSignal e foi encerrado');
    this.name = 'SubprocessAbortedError';
  }
}

/**
 * Roda um binário SEM shell com env sanitizado e um WATCHDOG de timeout: no
 * estouro, envia `SIGTERM` e, após a graça, `SIGKILL` — garantindo que um processo
 * travado seja encerrado (sem zumbi) e não pendure a fila de jobs (ADR-002).
 *
 * Resolve com o `stdout` no exit 0; rejeita com o erro bruto do `execFile` em exit
 * != 0; rejeita com o erro de {@link WatchdogDeps.makeTimeoutError} (default
 * {@link SubprocessTimeoutError}) no timeout. Todas as transições passam por um
 * `settle` idempotente (uma única resolução; timers sempre limpos — sem leak).
 *
 * @param invocation - Binário, args, env e limites — ver {@link WatchdogInvocation}.
 * @param deps - `execFile`/`makeTimeoutError` injetáveis — ver {@link WatchdogDeps}.
 * @returns O `stdout` do processo em caso de sucesso.
 * @example
 * const out = await runWithWatchdog({
 *   bin: '/opt/bin/tesseract', args: ['img.png', 'stdout'],
 *   env: sanitizedEnv(), timeoutMs: 30_000, killGraceMs: 2_000, maxBuffer: 16 << 20,
 * });
 */
export function runWithWatchdog(invocation: WatchdogInvocation, deps: WatchdogDeps = {}): Promise<string> {
  const { bin, args, env, timeoutMs, killGraceMs, maxBuffer, signal } = invocation;
  // Reason: as sobrecargas de `execFile` não colapsam na forma estrutural mínima
  // que usamos (encoding fixo 'utf8'); o cast documentado é seguro — a chamada
  // abaixo respeita exatamente a assinatura real.
  const exec = deps.execFile ?? (nodeExecFile as unknown as ExecFileLike);
  const makeTimeoutError = deps.makeTimeoutError ?? ((ms: number): Error => new SubprocessTimeoutError(ms));
  const makeAbortError = deps.makeAbortError ?? ((): Error => new SubprocessAbortedError());

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    const timers: NodeJS.Timeout[] = [];

    const cleanup = (): void => {
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    /**
     * Mata o child com o escalonamento `SIGTERM`→ graça →`SIGKILL` e, se o
     * processo não responder na graça, resolve a Promise via `onKilled`. Um
     * processo que responde ao SIGTERM (callback do execFile) faz `settle`
     * primeiro, e o `cleanup` limpa o timer do SIGKILL (anti-pid-reciclado).
     */
    const killEscalating = (onKilled: () => void): void => {
      child.kill('SIGTERM');
      // Reason: após a graça, força SIGKILL e desiste — um processo que ignora
      // SIGTERM não pode segurar a fila de jobs indefinidamente (ADR-002).
      timers.push(
        setTimeout(() => {
          child.kill('SIGKILL');
          onKilled();
        }, killGraceMs),
      );
    };

    // Reason: declaração de função (hoisted) para que `cleanup` possa referenciá-la
    // e para que o listener seja registrado só após o child existir.
    function onAbort(): void {
      aborted = true;
      killEscalating(() => settle(() => reject(makeAbortError())));
    }

    const child = exec(
      bin,
      [...args],
      { env, encoding: 'utf8', maxBuffer, windowsHide: true },
      (error, stdout) => {
        // Ordem: um cancelamento/timeout em curso vence o resultado tardio do
        // processo (que respondeu ao SIGTERM) — nunca vira sucesso/erro comum.
        if (aborted) {
          settle(() => reject(makeAbortError()));
          return;
        }
        if (timedOut) {
          settle(() => reject(makeTimeoutError(timeoutMs)));
          return;
        }
        if (error !== null) {
          settle(() => reject(error));
          return;
        }
        settle(() => resolve(stdout));
      },
    );

    timers.push(
      setTimeout(() => {
        timedOut = true;
        killEscalating(() => settle(() => reject(makeTimeoutError(timeoutMs))));
      }, timeoutMs),
    );

    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort);
      }
    }
  });
}
