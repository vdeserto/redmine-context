/**
 * Núcleo da fila de jobs de extração (#67 / M4-10.1, ADR-005).
 *
 * A extração de mídia é longa (minutos) e há vários anexos por issue; esta fila
 * roda os jobs com **concorrência limitada** (`os.cpus().length − 1`, piso de 1),
 * expõe as **transições de estado de forma observável** e **isola falhas** — um
 * job que rejeita vira `failed` sem derrubar os demais.
 *
 * ## Observabilidade — contrato do core (ADR-005)
 *
 * A fila é consumida como `AsyncIterable<QueueEvent<T>>`, o mesmo padrão
 * `AsyncIterable<ProgressEvent | Result>` que as superfícies já usam: cada
 * transição de um job é um item da sequência, e o iterável termina quando a fila
 * drena. O status REUSA o vocabulário canônico {@link ExtractionStatus}
 * (`pending → processing → done | failed | cancelled`) — sem status paralelo.
 *
 * ## Cancelamento (#69)
 *
 * A fila aceita um `AbortSignal` opcional ({@link RunQueueOptions.signal}) e o
 * propaga a cada job via {@link JobContext.signal}. Ao abortar: os jobs em
 * execução recebem o signal (o extrator o repassa ao `runWithWatchdog`, que MATA
 * o subprocesso) e são observados como `cancelled`; os jobs `pending` que ainda
 * não iniciaram são marcados `cancelled` sem iniciar. Cada transição emite UM
 * evento — as superfícies consomem só o `AsyncIterable`, sem API de cancelamento
 * acoplada.
 *
 * ## Fronteira e escopo
 *
 * Módulo de core (pipeline de extração): não importa de `src/surfaces/**` e não
 * usa `console.*` — falhas são reportadas via {@link Logger} injetado. O
 * {@link JobContext} passado a cada job é o ponto de extensão do timeout/kill de
 * subprocesso (#68, `timeoutMs`) e do cancelamento (#69, `signal`), sem quebrar a
 * assinatura de {@link QueueJob}.
 */

import os from 'node:os';

import type { Logger } from '../client/index.js';
import type { ExtractionStatus } from '../contract.js';

/**
 * Estado observável de um job da fila — subconjunto do vocabulário canônico
 * {@link ExtractionStatus}. Derivado por `Extract<>` para que qualquer mudança
 * no contrato do core se propague aqui (sem status paralelo).
 */
export type QueueJobStatus = Extract<
  ExtractionStatus,
  'pending' | 'processing' | 'done' | 'failed' | 'cancelled'
>;

/**
 * Contexto passado ao {@link QueueJob.run} de cada job.
 *
 * Carrega o `jobId` (útil para logs/telemetria do próprio job) e, opcionalmente,
 * o `timeoutMs` — o ORÇAMENTO DE TEMPO que um job de extração deve repassar ao
 * watchdog do subprocesso (#68), que o encerra com `SIGTERM`→`SIGKILL` no estouro.
 * A fila NÃO cancela o job por conta própria (o kill correto vive no subprocesso);
 * ela só PROPAGA o orçamento. É o seam reservado ao `AbortSignal` do cancelamento
 * (#69), que entra aqui como mais um campo OPCIONAL — aditivo, sem quebrar jobs
 * existentes.
 */
export interface JobContext {
  /** Id do job em execução (o mesmo de {@link QueueJob.id}). */
  readonly jobId: string;
  /**
   * Orçamento de tempo (ms) que o job deve aplicar ao seu subprocesso, quando a
   * fila é criada com {@link RunQueueOptions.jobTimeoutMs}. Ausente = o job usa seu
   * próprio default. Respeita `exactOptionalPropertyTypes` (nunca `undefined`).
   */
  readonly timeoutMs?: number;
  /**
   * Sinal de CANCELAMENTO (#69, ADR-005) propagado a cada job em execução quando
   * a fila é criada com {@link RunQueueOptions.signal}. O job de extração o repassa
   * ao `runWithWatchdog`, que MATA o subprocesso (`SIGTERM`→`SIGKILL`) ao abortar;
   * a fila então observa o job como `cancelled`. Ausente = a fila não é cancelável.
   * Presente só quando a fila recebe um signal (respeita `exactOptionalPropertyTypes`).
   */
  readonly signal?: AbortSignal;
}

/**
 * Uma unidade de trabalho da fila. `run` é uma função async qualquer — nos
 * testes, um job FAKE controlável via Promise; em produção, a extração de um
 * anexo.
 *
 * @typeParam T - Tipo do resultado produzido pelo job em caso de sucesso.
 */
export interface QueueJob<T> {
  /** Identificador único da execução (escolhido por quem enfileira). */
  readonly id: string;
  /**
   * Executa o trabalho.
   *
   * @param context - Contexto da execução — ver {@link JobContext}.
   * @returns O resultado do job; a rejeição vira uma transição `failed`.
   */
  run(context: JobContext): Promise<T>;
}

/**
 * Uma transição de estado observável de um job (item do `AsyncIterable`).
 *
 * Respeita `exactOptionalPropertyTypes`: `result` só aparece em `done`,
 * `reason`/`error` só aparecem em `failed` — nunca com valor `undefined`.
 *
 * @typeParam T - Tipo do resultado do job (presente em `status === 'done'`).
 */
export interface QueueEvent<T> {
  /** Id do job ({@link QueueJob.id}) a que esta transição se refere. */
  readonly id: string;
  /** Novo estado do job. */
  readonly status: QueueJobStatus;
  /** Resultado do job — presente apenas quando `status === 'done'`. */
  readonly result?: T;
  /** Motivo legível da falha — presente apenas quando `status === 'failed'`. */
  readonly reason?: string;
  /** Erro bruto que causou a falha — presente apenas quando `status === 'failed'`. */
  readonly error?: unknown;
}

/** Opções de {@link runQueue}. */
export interface RunQueueOptions {
  /**
   * Número máximo de jobs em `processing` ao mesmo tempo. Injetável para testes
   * determinísticos; valores `< 1` são elevados ao piso de 1. Default:
   * {@link defaultConcurrency}.
   */
  readonly concurrency?: number;
  /** Logger para avisar sobre jobs que falharam (boundary ADR-005; sem `console.*`). */
  readonly logger?: Logger;
  /**
   * Orçamento de tempo (ms) propagado a cada job via {@link JobContext.timeoutMs}
   * (#68) — os jobs de extração o repassam ao watchdog do subprocesso. Omitido =
   * cada job usa seu próprio default. A fila NÃO cancela o job por conta própria.
   */
  readonly jobTimeoutMs?: number;
  /**
   * Sinal de CANCELAMENTO da fila inteira (#69, ADR-005). Ao disparar: os jobs em
   * execução recebem o signal via {@link JobContext.signal} (matam o subprocesso e
   * rejeitam) e são observados como `cancelled`; os jobs `pending` que ainda NÃO
   * iniciaram são marcados `cancelled` sem iniciar. Cada transição emite UM evento.
   * Omitido = a fila não é cancelável (comportamento #67/#68 inalterado).
   */
  readonly signal?: AbortSignal;
}

/**
 * Limite de concorrência padrão da fila: `os.cpus().length − 1`, com piso de 1
 * para máquinas de 1 núcleo (ADR-005 — deixa um núcleo livre para a UI/event
 * loop enquanto o binário externo trabalha).
 *
 * @returns O número máximo de jobs simultâneos recomendado para esta máquina.
 */
export function defaultConcurrency(): number {
  return Math.max(1, os.cpus().length - 1);
}

/** Converte um erro arbitrário em uma mensagem legível para o `reason`. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Canal assíncrono push→pull: o scheduler EMPURRA transições conforme os jobs
 * progridem (mesmo entre pulls do consumidor) e o consumidor as PUXA via
 * `AsyncIterable`. Desacopla a execução dos jobs do ritmo de consumo.
 */
interface Channel<T> {
  emit(value: T): void;
  close(): void;
  stream(): AsyncGenerator<T, void, void>;
}

function createChannel<T>(): Channel<T> {
  const buffer: T[] = [];
  let closed = false;
  let wake: (() => void) | undefined;

  const notify = (): void => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };

  return {
    emit(value: T): void {
      buffer.push(value);
      notify();
    },
    close(): void {
      closed = true;
      notify();
    },
    async *stream(): AsyncGenerator<T, void, void> {
      for (;;) {
        if (buffer.length > 0) {
          yield buffer.shift() as T;
          continue;
        }
        if (closed) {
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

/**
 * Roda uma coleção de jobs com concorrência limitada, expondo cada transição de
 * estado como um `AsyncIterable<QueueEvent<T>>` (contrato do core, ADR-005).
 *
 * Garantias:
 * - **Concorrência**: nunca há mais que `concurrency` jobs em `processing` ao
 *   mesmo tempo; os excedentes ficam em `pending` até um slot liberar (FIFO —
 *   a ordem de enfileiramento é respeitada).
 * - **Observabilidade**: todo job emite `pending` (no enfileiramento), depois
 *   `processing` (ao iniciar) e por fim `done` (com `result`) ou `failed` (com
 *   `reason`/`error`).
 * - **Isolamento de falha**: um job que rejeita vira `failed` e NÃO interrompe
 *   os demais — a fila continua até drenar. `runQueue` nunca rejeita por causa
 *   de um job.
 *
 * @typeParam T - Tipo do resultado dos jobs em caso de sucesso.
 * @param jobs - Jobs a executar, na ordem de prioridade (FIFO).
 * @param options - Concorrência e logger — ver {@link RunQueueOptions}.
 * @returns Sequência assíncrona de transições, terminada quando a fila drena.
 * @example
 * for await (const event of runQueue(jobs, { concurrency: 2 })) {
 *   if (event.status === 'failed') logger.warn(event.reason ?? 'falhou');
 * }
 */
export function runQueue<T>(
  jobs: Iterable<QueueJob<T>>,
  options: RunQueueOptions = {},
): AsyncIterable<QueueEvent<T>> {
  const concurrency = Math.max(1, options.concurrency ?? defaultConcurrency());
  const logger = options.logger;
  const jobTimeoutMs = options.jobTimeoutMs;
  const signal = options.signal;
  const channel = createChannel<QueueEvent<T>>();
  const pending = [...jobs];

  // Todos os jobs são observados como `pending` já no enfileiramento (ordem FIFO).
  for (const job of pending) {
    channel.emit({ id: job.id, status: 'pending' });
  }

  let active = 0;
  let next = 0;

  // Reason: fecha o canal E remove o listener de abort — evita vazar a inscrição
  // num `AbortSignal` de vida longa quando a fila drena sem cancelamento.
  const closeChannel = (): void => {
    signal?.removeEventListener('abort', onAbort);
    channel.close();
  };

  /**
   * Marca como `cancelled` todo job `pending` que ainda NÃO iniciou (índice a
   * partir de `next`), impedindo que o `pump` os inicie, e fecha o canal se não há
   * mais nada em execução. Os jobs em execução NÃO são tocados aqui: eles recebem
   * o `signal` (matam o subprocesso) e viram `cancelled` no `catch` de {@link settle}.
   */
  const cancelRemaining = (): void => {
    while (next < pending.length) {
      const job = pending[next];
      next += 1;
      if (job === undefined) {
        continue; // Inalcançável dado o bound; satisfaz noUncheckedIndexedAccess.
      }
      channel.emit({ id: job.id, status: 'cancelled' });
    }
    if (active === 0) {
      closeChannel();
    }
  };

  // Reason: função (hoisted) para que `closeChannel` possa desinscrevê-la.
  function onAbort(): void {
    cancelRemaining();
  }

  const settle = async (job: QueueJob<T>): Promise<void> => {
    try {
      // `processing` dentro do try: se a emissão falhar, o finally ainda roda e o
      // slot é liberado (sem leak). Cobre também `job.run` que lança SÍNCRONO.
      channel.emit({ id: job.id, status: 'processing' });
      // Reason: só inclui `timeoutMs`/`signal` quando a fila os tem — nunca injeta
      // `undefined` (exactOptionalPropertyTypes) no contexto do job.
      const context: JobContext = {
        jobId: job.id,
        ...(jobTimeoutMs !== undefined ? { timeoutMs: jobTimeoutMs } : {}),
        ...(signal !== undefined ? { signal } : {}),
      };
      const result = await job.run(context);
      channel.emit({
        id: job.id,
        status: 'done',
        ...(result !== undefined ? { result } : {}),
      });
    } catch (error) {
      // Cancelamento vence a falha: uma vez abortada, a rejeição do job (subprocesso
      // morto) é uma transição `cancelled`, não `failed` — um evento por transição.
      if (signal?.aborted === true) {
        channel.emit({ id: job.id, status: 'cancelled' });
      } else {
        // Isolamento de falha: reporta, mas a fila segue com os demais jobs.
        const reason = describeError(error);
        logger?.warn(`queue: job "${job.id}" falhou — ${reason}`);
        channel.emit({ id: job.id, status: 'failed', reason, ...(error !== undefined ? { error } : {}) });
      }
    } finally {
      active -= 1;
      // Fora da pilha do `pump`: um job que lança SÍNCRONO rodaria o finally de
      // forma reentrante, gerando recursão O(N) (risco de stack overflow) e
      // `close()` redundante. O microtask serializa as continuações.
      queueMicrotask(pump);
    }
  };

  /** Preenche slots livres respeitando o limite; fecha o canal quando drena. */
  function pump(): void {
    // Após um abort, não inicia novos jobs: drena os pendentes como `cancelled`.
    if (signal?.aborted === true) {
      cancelRemaining();
      return;
    }
    while (active < concurrency && next < pending.length) {
      const job = pending[next];
      next += 1;
      if (job === undefined) {
        break; // Inalcançável dado o bound; satisfaz noUncheckedIndexedAccess.
      }
      active += 1;
      void settle(job);
    }
    if (active === 0 && next >= pending.length) {
      closeChannel();
    }
  }

  // O cancelamento é observado por evento (contrato AsyncIterable) — sem API
  // especial acoplada às superfícies (TUI/CLI consomem só o iterável).
  if (signal !== undefined && !signal.aborted) {
    signal.addEventListener('abort', onAbort);
  }

  pump();
  return channel.stream();
}
