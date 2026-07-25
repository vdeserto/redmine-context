import os from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  defaultConcurrency,
  runQueue,
  type QueueEvent,
  type QueueJob,
} from '../../src/extract/queue.js';

/** Promise controlável manualmente — o coração dos jobs FAKE determinísticos. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drena a fila de microtasks + uma macrotask, deixando o scheduler estabilizar. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Coleta todos os eventos de um `runQueue` até ele completar. */
async function drain<T>(iterable: AsyncIterable<QueueEvent<T>>): Promise<QueueEvent<T>[]> {
  const events: QueueEvent<T>[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

const idsWithStatus = <T>(events: QueueEvent<T>[], status: string): string[] =>
  events.filter((event) => event.status === status).map((event) => event.id);

describe('runQueue — núcleo da fila de jobs (#67)', () => {
  it('completa imediatamente para uma fila vazia', async () => {
    const events = await drain(runQueue<number>([], { concurrency: 2 }));
    expect(events).toEqual([]);
  });

  it('emite as transições pending → processing → done na ordem certa para um job', async () => {
    const jobs: QueueJob<string>[] = [
      { id: 'a', run: () => Promise.resolve('resultado-a') },
    ];

    const events = await drain(runQueue(jobs, { concurrency: 1 }));

    expect(events.map((event) => [event.id, event.status])).toEqual([
      ['a', 'pending'],
      ['a', 'processing'],
      ['a', 'done'],
    ]);
    const done = events.find((event) => event.status === 'done');
    expect(done?.result).toBe('resultado-a');
  });

  it('nunca mantém mais que N jobs em processing simultaneamente', async () => {
    const limit = 2;
    const total = 5;
    const gates = Array.from({ length: total }, () => deferred<void>());

    let active = 0;
    let maxActive = 0;
    const startedOrder: string[] = [];

    const jobs: QueueJob<number>[] = gates.map((gate, index) => ({
      id: `job-${index}`,
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        startedOrder.push(`job-${index}`);
        await gate.promise;
        active -= 1;
        return index;
      },
    }));

    const events: QueueEvent<number>[] = [];
    const consumed = (async () => {
      for await (const event of runQueue(jobs, { concurrency: limit })) {
        events.push(event);
      }
    })();

    // O scheduler deve iniciar exatamente os 2 primeiros; os demais ficam pending.
    await flush();
    expect(active).toBe(2);
    expect(maxActive).toBe(2);
    expect(startedOrder).toEqual(['job-0', 'job-1']);
    expect(idsWithStatus(events, 'processing')).toEqual(['job-0', 'job-1']);
    // Todos os 5 já foram observados como pending logo no enfileiramento.
    expect(idsWithStatus(events, 'pending')).toEqual([
      'job-0',
      'job-1',
      'job-2',
      'job-3',
      'job-4',
    ]);

    // Liberar um slot deve promover o próximo pending — e só ele.
    gates[0]?.resolve();
    await flush();
    expect(active).toBe(2);
    expect(startedOrder).toEqual(['job-0', 'job-1', 'job-2']);
    expect(idsWithStatus(events, 'processing')).toEqual(['job-0', 'job-1', 'job-2']);

    // Libera o restante e deixa a fila drenar.
    for (const gate of gates.slice(1)) {
      gate.resolve();
    }
    await consumed;

    expect(maxActive).toBeLessThanOrEqual(limit);
    expect(idsWithStatus(events, 'done').sort()).toEqual([
      'job-0',
      'job-1',
      'job-2',
      'job-3',
      'job-4',
    ]);
  });

  it('isola falhas: um job que rejeita vira failed e NÃO derruba a fila', async () => {
    const jobs: QueueJob<string>[] = [
      { id: 'ok-1', run: () => Promise.resolve('um') },
      { id: 'boom', run: () => Promise.reject(new Error('explodiu')) },
      { id: 'ok-2', run: () => Promise.resolve('dois') },
    ];

    const events = await drain(runQueue(jobs, { concurrency: 1 }));

    const failed = events.find((event) => event.status === 'failed');
    expect(failed?.id).toBe('boom');
    expect(failed?.reason).toBe('explodiu');

    // Os demais concluíram normalmente — a fila sobreviveu.
    expect(idsWithStatus(events, 'done').sort()).toEqual(['ok-1', 'ok-2']);
  });

  it('isola até um job que LANÇA de forma síncrona (sem recursão reentrante)', async () => {
    // `run` que viola o tipo e lança síncrono aciona o caminho reentrante do
    // finally — com N grande, prova que não estoura a pilha nem derruba a fila.
    const jobs: QueueJob<string>[] = Array.from({ length: 500 }, (_, index) => ({
      id: `sync-${index}`,
      run: (): Promise<string> => {
        throw new Error(`boom-${index}`);
      },
    }));

    const events = await drain(runQueue(jobs, { concurrency: 1 }));

    expect(idsWithStatus(events, 'failed')).toHaveLength(500);
    const first = events.find((event) => event.status === 'failed');
    expect(first?.reason).toBe('boom-0');
  });

  it('descreve falhas que não são Error usando String(error)', async () => {
    const jobs: QueueJob<never>[] = [
      { id: 'raw', run: () => Promise.reject('sem-error-object') },
    ];

    const events = await drain(runQueue(jobs, { concurrency: 1 }));
    const failed = events.find((event) => event.status === 'failed');
    expect(failed?.reason).toBe('sem-error-object');
  });

  it('avisa via logger quando um job falha (boundary ADR-005, sem console.*)', async () => {
    const warnings: string[] = [];
    const logger = { warn: (message: string) => warnings.push(message) };

    const jobs: QueueJob<never>[] = [
      { id: 'bad', run: () => Promise.reject(new Error('falha-x')) },
    ];

    await drain(runQueue(jobs, { concurrency: 1, logger }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('bad');
    expect(warnings[0]).toContain('falha-x');
  });

  it('respeita a ordem de enfileiramento (FIFO) com concorrência 1', async () => {
    const jobs: QueueJob<number>[] = [0, 1, 2].map((index) => ({
      id: `seq-${index}`,
      run: () => Promise.resolve(index),
    }));

    const events = await drain(runQueue(jobs, { concurrency: 1 }));

    expect(idsWithStatus(events, 'processing')).toEqual(['seq-0', 'seq-1', 'seq-2']);
  });

  it('trata concorrência inválida (<1) como piso de 1', async () => {
    const gates = [deferred<void>(), deferred<void>()];
    let active = 0;
    let maxActive = 0;

    const jobs: QueueJob<void>[] = gates.map((gate, index) => ({
      id: `floor-${index}`,
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active -= 1;
      },
    }));

    const consumed = drain(runQueue(jobs, { concurrency: 0 }));
    await flush();
    expect(active).toBe(1);

    gates[0]?.resolve();
    gates[1]?.resolve();
    await consumed;
    expect(maxActive).toBe(1);
  });

  it('passa o jobId no contexto de execução (seam de extensão p/ #68/#69)', async () => {
    const seen: string[] = [];
    const jobs: QueueJob<void>[] = [
      {
        id: 'ctx-job',
        run: (context) => {
          seen.push(context.jobId);
          return Promise.resolve();
        },
      },
    ];

    await drain(runQueue(jobs, { concurrency: 1 }));
    expect(seen).toEqual(['ctx-job']);
  });

  it('propaga o orçamento de timeout aos jobs via context.timeoutMs (#68)', async () => {
    const seen: Array<number | undefined> = [];
    const jobs: QueueJob<void>[] = [
      {
        id: 'budget-job',
        run: (context) => {
          seen.push(context.timeoutMs);
          return Promise.resolve();
        },
      },
    ];

    await drain(runQueue(jobs, { concurrency: 1, jobTimeoutMs: 5_000 }));
    expect(seen).toEqual([5_000]);
  });

  it('sem jobTimeoutMs, o context NÃO carrega timeoutMs (exactOptionalPropertyTypes)', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const jobs: QueueJob<void>[] = [
      {
        id: 'no-budget',
        run: (context) => {
          seen.push({ ...context });
          return Promise.resolve();
        },
      },
    ];

    await drain(runQueue(jobs, { concurrency: 1 }));
    expect(seen).toEqual([{ jobId: 'no-budget' }]);
    expect('timeoutMs' in (seen[0] ?? {})).toBe(false);
  });
});

describe('defaultConcurrency', () => {
  it('usa núcleos − 1 com piso de 1', () => {
    const expected = Math.max(1, os.cpus().length - 1);
    expect(defaultConcurrency()).toBe(expected);
    expect(defaultConcurrency()).toBeGreaterThanOrEqual(1);
  });

  it('runQueue usa defaultConcurrency quando nenhum limite é injetado', async () => {
    const jobs: QueueJob<number>[] = [{ id: 'solo', run: () => Promise.resolve(1) }];
    const events = await drain(runQueue(jobs));
    expect(idsWithStatus(events, 'done')).toEqual(['solo']);
  });
});
