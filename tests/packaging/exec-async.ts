import { spawn } from 'node:child_process';

/**
 * Helpers assíncronos de subprocesso para os testes de PACKAGING (#77).
 *
 * Operações pesadas de packaging (npm build/pack/install, tar, npm ls) rodam por
 * dezenas de segundos. Feitas de forma SÍNCRONA (`execFileSync`/`spawnSync`), elas
 * BLOQUEIAM o event loop do worker do Vitest — com `fileParallelism: false` (worker
 * único) o worker deixa de responder ao RPC `onTaskUpdate` do reporter e o run
 * falha com `Timeout calling "onTaskUpdate"`, mesmo com todos os testes verdes.
 * Rodar esses subprocessos via `spawn` (async, `await`) mantém o event loop vivo.
 *
 * A lint rule anti-shell do #83 proíbe `shell: true`; nenhum helper aqui usa shell.
 */

/** Resultado de um subprocesso: saída capturada + exit code. */
export interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
}

/** Opções aceitas pelos helpers (subconjunto seguro, sem `shell`). */
export interface SpawnOptions {
  readonly cwd?: string;
  readonly maxBuffer?: number;
}

/**
 * Executa um binário de forma assíncrona e SEM rejeitar em exit code != 0.
 *
 * Ao contrário de `promisify(execFile)`, resolve sempre com `{ stdout, stderr,
 * status }` — necessário para os call sites que precisam do LOG e do status mesmo
 * quando o processo falha (ex.: `npm install` do clean-install). Nunca usa shell.
 *
 * @param bin Caminho/nome do executável (nunca interpretado por shell).
 * @param args Argumentos do processo.
 * @param options `cwd` e `maxBuffer` (limite de bytes por stream; padrão 64 MiB).
 * @returns Promessa que resolve com stdout, stderr e o exit code (`status`).
 * @throws {Error} Somente se o processo não puder ser iniciado (evento `error`).
 */
export async function runCapture(
  bin: string,
  args: readonly string[],
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
  return new Promise<SpawnResult>((resolve, reject) => {
    const child =
      options.cwd === undefined
        ? spawn(bin, [...args])
        : spawn(bin, [...args], { cwd: options.cwd });

    let stdout = '';
    let stderr = '';
    let outLen = 0;
    let errLen = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(error);
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      outLen += Buffer.byteLength(chunk);
      if (outLen > maxBuffer) {
        fail(new Error(`maxBuffer excedido em stdout de ${bin}`));
        return;
      }
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      errLen += Buffer.byteLength(chunk);
      if (errLen > maxBuffer) {
        fail(new Error(`maxBuffer excedido em stderr de ${bin}`));
        return;
      }
      stderr += chunk;
    });

    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ stdout, stderr, status: code });
    });
  });
}

/**
 * Executa um binário de forma assíncrona e REJEITA se o exit code != 0.
 *
 * Equivalente async de `execFileSync` (que lança em falha) mas sem bloquear o event
 * loop. Use nos call sites onde uma falha do processo deve derrubar o teste.
 *
 * @param bin Caminho/nome do executável (nunca interpretado por shell).
 * @param args Argumentos do processo.
 * @param options `cwd` e `maxBuffer`.
 * @returns Promessa que resolve com `{ stdout, stderr, status }` (status === 0).
 * @throws {Error} Se o processo terminar com exit code != 0 ou não puder iniciar.
 */
export async function runOrThrow(
  bin: string,
  args: readonly string[],
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  const result = await runCapture(bin, args, options);
  if (result.status !== 0) {
    throw new Error(
      `comando falhou (exit ${String(result.status)}): ${bin} ${args.join(' ')}\n${result.stderr}`,
    );
  }
  return result;
}
