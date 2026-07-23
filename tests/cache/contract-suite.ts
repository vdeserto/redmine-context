/**
 * Suíte de contrato REUTILIZÁVEL do módulo Cache (M3-01, ADR-004).
 *
 * `runCacheContractSuite(makeStore)` recebe uma fábrica de {@link CacheStore} e
 * exercita o comportamento observável do contrato — get/put/invalidate, lock por
 * chave (exclusão mútua, chaves distintas não bloqueiam, release em erro) e hook
 * de GC. QUALQUER implementação (memória nesta issue, disco nas seguintes) deve
 * passar nesta mesma suíte; ela não conhece detalhes de implementação.
 */

import { describe, expect, it } from 'vitest';

import {
  serializeCacheKey,
  type AttachmentCacheKey,
  type CacheKey,
  type CacheStore,
  type CacheStoreOptions,
  type GcContext,
  type IssueCacheKey,
} from '../../src/cache/index.js';

/** Fábrica de store sob teste: opcionalmente recebe as opções do contrato. */
export type CacheStoreFactory = (options?: CacheStoreOptions) => CacheStore<string>;

/** Chave issue-level de exemplo. */
function issueKey(overrides: Partial<IssueCacheKey> = {}): IssueCacheKey {
  return { kind: 'issue', issueId: 42, updatedOn: '2026-07-20T00:00:00Z', ...overrides };
}

/** Chave attachment-level de exemplo. */
function attachmentKey(overrides: Partial<AttachmentCacheKey> = {}): AttachmentCacheKey {
  return {
    kind: 'attachment',
    instanceHash: 'a1b2c3d4e5f60718',
    attachmentId: 7,
    digest: 'deadbeef',
    extractorVersion: '1.0.0',
    model: 'whisper-large-v3',
    params: { language: 'pt', beam_size: 5 },
    ...overrides,
  };
}

/** Cede o event loop, permitindo que microtasks pendentes resolvam. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Um "portão" manual: uma promise que só resolve quando `open()` é chamado. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * Registra a suíte de contrato do cache contra a fábrica fornecida.
 *
 * @param makeStore - Fábrica que cria um {@link CacheStore} vazio a cada chamada.
 * @example
 * runCacheContractSuite((options) => new InMemoryCacheStore(options));
 */
export function runCacheContractSuite(makeStore: CacheStoreFactory): void {
  describe('contrato: get/put/invalidate', () => {
    it('devolve undefined para chave ausente (issue e attachment)', async () => {
      const store = makeStore();
      expect(await store.get(issueKey())).toBeUndefined();
      expect(await store.get(attachmentKey())).toBeUndefined();
    });

    it('grava e recupera valores em ambas as camadas', async () => {
      const store = makeStore();
      await store.put(issueKey(), 'bundle-42');
      await store.put(attachmentKey(), 'extracao-7');
      expect(await store.get(issueKey())).toBe('bundle-42');
      expect(await store.get(attachmentKey())).toBe('extracao-7');
    });

    it('substitui o valor de uma chave existente', async () => {
      const store = makeStore();
      await store.put(issueKey(), 'v1');
      await store.put(issueKey(), 'v2');
      expect(await store.get(issueKey())).toBe('v2');
    });

    it('invalida uma entrada e é idempotente para chave ausente', async () => {
      const store = makeStore();
      await store.put(issueKey(), 'v1');
      await store.invalidate(issueKey());
      expect(await store.get(issueKey())).toBeUndefined();
      await expect(store.invalidate(issueKey())).resolves.toBeUndefined();
    });

    it('trata chaves distintas como namespaces separados', async () => {
      const store = makeStore();
      await store.put(issueKey({ issueId: 1 }), 'a');
      await store.put(issueKey({ issueId: 2 }), 'b');
      // updated_on distinto invalida (ADR-004): é outra entrada, não sobrescreve.
      await store.put(issueKey({ issueId: 1, updatedOn: '2026-07-21T00:00:00Z' }), 'c');
      expect(await store.get(issueKey({ issueId: 1 }))).toBe('a');
      expect(await store.get(issueKey({ issueId: 2 }))).toBe('b');
    });

    it('trata parâmetros de extrator distintos como chaves distintas (ADR-004)', async () => {
      const store = makeStore();
      await store.put(attachmentKey({ model: 'whisper-small' }), 'small');
      await store.put(attachmentKey({ model: 'whisper-large-v3' }), 'large');
      expect(await store.get(attachmentKey({ model: 'whisper-small' }))).toBe('small');
      expect(await store.get(attachmentKey({ model: 'whisper-large-v3' }))).toBe('large');
    });
  });

  describe('contrato: lock por chave', () => {
    it('serializa a segunda aquisição da MESMA chave (exclusão mútua)', async () => {
      const store = makeStore();
      const key = attachmentKey();
      const order: string[] = [];
      const first = gate();

      const p1 = store.lock(key, async () => {
        order.push('1-start');
        await first.promise;
        order.push('1-end');
      });
      const p2 = store.lock(key, async () => {
        order.push('2-run');
      });

      await tick();
      // Enquanto o primeiro segura, o segundo não pode ter rodado.
      expect(order).toEqual(['1-start']);

      first.open();
      await Promise.all([p1, p2]);
      expect(order).toEqual(['1-start', '1-end', '2-run']);
    });

    it('não bloqueia chaves DISTINTAS entre si', async () => {
      const store = makeStore();
      const held = gate();
      let bRan = false;

      const pA = store.lock(attachmentKey({ attachmentId: 1 }), async () => {
        await held.promise;
      });
      const pB = store.lock(attachmentKey({ attachmentId: 2 }), async () => {
        bRan = true;
      });

      // B resolve sem esperar A liberar.
      await pB;
      expect(bRan).toBe(true);

      held.open();
      await pA;
    });

    it('libera o lock mesmo quando a seção crítica lança (release em erro)', async () => {
      const store = makeStore();
      const key = issueKey();

      await expect(
        store.lock(key, async () => {
          throw new Error('falha na seção crítica');
        }),
      ).rejects.toThrow('falha na seção crítica');

      // A chave não ficou travada: a próxima aquisição roda normalmente.
      let ran = false;
      await store.lock(key, async () => {
        ran = true;
      });
      expect(ran).toBe(true);
    });

    it('propaga o valor de retorno da seção crítica', async () => {
      const store = makeStore();
      const result = await store.lock(issueKey(), async () => 'ok');
      expect(result).toBe('ok');
    });

    it('assume lock estagnado após o TTL e prossegue (sem deadlock)', async () => {
      const warnings: string[] = [];
      const store = makeStore({ staleLockTtlMs: 20, logger: { warn: (m) => warnings.push(m) } });
      const key = issueKey();
      const stuck = gate();

      // Primeiro detentor nunca libera dentro do TTL.
      const p1 = store.lock(key, async () => {
        await stuck.promise;
      });
      let secondRan = false;
      const p2 = store.lock(key, async () => {
        secondRan = true;
      });

      await p2;
      expect(secondRan).toBe(true);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(serializeCacheKey(key));

      stuck.open();
      await p1;
    });
  });

  describe('contrato: hook de GC', () => {
    it('aciona o hook após cada put com reason "put"', async () => {
      const calls: GcContext[] = [];
      const store = makeStore({ onGc: (ctx) => void calls.push(ctx) });
      await store.put(issueKey(), 'v');
      expect(calls).toEqual([{ reason: 'put', entryCount: 1 }]);
    });

    it('aciona o hook em gc() manual com a contagem de entradas', async () => {
      const calls: GcContext[] = [];
      const store = makeStore({ onGc: (ctx) => void calls.push(ctx) });
      await store.put(issueKey(), 'v');
      await store.put(attachmentKey(), 'e');
      calls.length = 0;
      await store.gc();
      expect(calls).toEqual([{ reason: 'manual', entryCount: 2 }]);
    });

    it('gc() é no-op quando nenhum hook foi configurado', async () => {
      const store = makeStore();
      await expect(store.gc()).resolves.toBeUndefined();
    });
  });
}

/** Reexporta os helpers de chave para testes específicos de implementação. */
export const contractKeys: {
  issue: (overrides?: Partial<IssueCacheKey>) => IssueCacheKey;
  attachment: (overrides?: Partial<AttachmentCacheKey>) => AttachmentCacheKey;
} = { issue: issueKey, attachment: attachmentKey };

/** Reexporta o tipo de chave para conveniência de testes específicos. */
export type { CacheKey };
