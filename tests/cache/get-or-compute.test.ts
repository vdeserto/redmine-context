/**
 * Testes de {@link getOrCompute} (M3-04, ADR-004) — o padrão de acesso que TODOS
 * os extratores do M3/M4 usarão.
 *
 * A suíte é PARAMETRIZADA sobre qualquer {@link CacheStore}: roda idêntica contra
 * a implementação em memória e a em disco, provando que o helper depende apenas do
 * contrato (lock + get/put), não da implementação. Cobre: compute único sob
 * concorrência na mesma chave (double-check após adquirir o lock), fast-path de
 * hit (compute nunca roda), independência entre chaves distintas e a política de
 * erro documentada — propaga ao DONO do lock, e os waiters RECOMPUTAM.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  DiskCacheStore,
  InMemoryCacheStore,
  getOrCompute,
  type CacheStore,
  type CacheStoreOptions,
  type IssueCacheKey,
} from '../../src/cache/index.js';

/** Fábrica de store vazio sob teste. */
type StoreFactory = (options?: CacheStoreOptions) => CacheStore<string>;

/** Chave issue-level de exemplo. */
function issueKey(overrides: Partial<IssueCacheKey> = {}): IssueCacheKey {
  return { kind: 'issue', issueId: 42, updatedOn: '2026-07-20T00:00:00Z', ...overrides };
}

/** Um "portão" manual: promise que só resolve quando `open()` é chamado. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Cede o event loop, permitindo que microtasks/IO pendentes resolvam. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Registra a suíte de `getOrCompute` contra a fábrica fornecida.
 *
 * @param makeStore - Cria um {@link CacheStore} vazio a cada chamada.
 */
function runGetOrComputeSuite(makeStore: StoreFactory): void {
  it('computa e persiste no miss: compute roda uma vez e o valor fica cacheado', async () => {
    const store = makeStore();
    let calls = 0;
    const value = await getOrCompute(store, issueKey(), async () => {
      calls += 1;
      return 'extraido';
    });

    expect(value).toBe('extraido');
    expect(calls).toBe(1);
    expect(await store.get(issueKey())).toBe('extraido');
  });

  it('fast-path de hit: com valor já cacheado, compute NUNCA roda', async () => {
    const store = makeStore();
    await store.put(issueKey(), 'ja-existe');
    let called = false;

    const value = await getOrCompute(store, issueKey(), async () => {
      called = true;
      return 'nao-deveria';
    });

    expect(value).toBe('ja-existe');
    expect(called).toBe(false);
  });

  it('dois concorrentes na MESMA chave: compute roda UMA vez e ambos recebem o valor', async () => {
    const store = makeStore();
    const key = issueKey();
    const held = gate();
    let calls = 0;

    const compute = async (): Promise<string> => {
      calls += 1;
      await held.promise; // Segura o dono do lock dentro da seção crítica.
      return 'unico';
    };

    // Ambos passam pelo fast-path (miss) antes de qualquer put e enfileiram no lock.
    const p1 = getOrCompute(store, key, compute);
    const p2 = getOrCompute(store, key, compute);
    await tick();

    held.open();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('unico');
    expect(r2).toBe('unico');
    // Double-check após adquirir o lock: o waiter reusa o valor, não recomputa.
    expect(calls).toBe(1);
  });

  it('chaves DISTINTAS não se bloqueiam: compute roda para cada uma', async () => {
    const store = makeStore();
    let calls = 0;
    const [a, b] = await Promise.all([
      getOrCompute(store, issueKey({ issueId: 1 }), async () => {
        calls += 1;
        return 'a';
      }),
      getOrCompute(store, issueKey({ issueId: 2 }), async () => {
        calls += 1;
        return 'b';
      }),
    ]);

    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(calls).toBe(2);
  });

  it('erro no compute propaga ao DONO; o waiter recomputa e obtém o valor', async () => {
    const store = makeStore();
    const key = issueKey();
    let calls = 0;

    // 1ª invocação (dono) falha; a 2ª (waiter, após release em erro) recupera.
    const compute = async (): Promise<string> => {
      calls += 1;
      if (calls === 1) {
        throw new Error('extracao falhou');
      }
      return 'recuperado';
    };

    const settled = await Promise.allSettled([
      getOrCompute(store, key, compute),
      getOrCompute(store, key, compute),
    ]);

    const rejected = settled.filter((s) => s.status === 'rejected');
    const fulfilled = settled.filter(
      (s): s is PromiseFulfilledResult<string> => s.status === 'fulfilled',
    );
    expect(rejected).toHaveLength(1);
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value).toBe('recuperado');
    // Dono falhou sem gravar; waiter recomputou → duas execuções.
    expect(calls).toBe(2);
    expect(await store.get(key)).toBe('recuperado');
  });
}

describe('getOrCompute + InMemoryCacheStore', () => {
  runGetOrComputeSuite((options) => new InMemoryCacheStore<string>(options));
});

describe('getOrCompute + DiskCacheStore', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  runGetOrComputeSuite((options) => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'rc-goc-'));
    dirs.push(cacheDir);
    return new DiskCacheStore<string>({ ...(options ?? {}), cacheDir });
  });
});
