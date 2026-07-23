/**
 * `getOrCompute` — padrão de acesso ao cache dos extratores (M3-04, ADR-004).
 *
 * Encapsula o fluxo canônico "leia; se faltar, extraia sob lock; grave" que TODOS
 * os extratores do M3/M4 usarão, garantindo que uma extração CARA rode UMA única
 * vez mesmo sob concorrência na mesma chave. O helper depende apenas do contrato
 * {@link CacheStore} (lock por chave + get/put), logo funciona com QUALQUER
 * implementação — memória ou disco — sem alteração.
 *
 * Duas checagens complementares evitam recomputar:
 * - fast-path: um `get` ANTES do lock resolve o caso comum (hit) sem serializar;
 * - double-check: após ADQUIRIR o lock, um novo `get` cobre a corrida em que outro
 *   waiter da mesma chave já gravou o valor enquanto esperávamos — nesse caso
 *   retornamos sem recomputar.
 *
 * POLÍTICA DE ERRO (decisão desta issue): se `compute` lançar, o erro propaga ao
 * DONO do lock (quem chamou `compute`); nada é gravado. Os waiters, ao adquirirem
 * o lock em seguida, veem o miss no double-check e RECOMPUTAM — não herdam a falha
 * do dono. Isso mantém a falha localizada e permite recuperação transparente.
 */

import type { CacheKey, CacheStore } from './contract.js';

/**
 * Retorna o valor cacheado de `key`, computando-o sob lock caso ausente.
 *
 * @typeParam V - Tipo do valor cacheado.
 * @param store - Backend de cache (memória ou disco) — ver {@link CacheStore}.
 * @param key - Chave de qualquer camada (ADR-004).
 * @param compute - Produz o valor quando há cache-miss; roda no máximo uma vez por
 *   vencedor do lock. Sob concorrência na mesma chave, apenas o dono a executa.
 * @returns O valor cacheado (existente ou recém-computado).
 * @throws Propaga qualquer erro lançado por `compute` ao chamador que a executou;
 *   nesse caso nada é gravado e os demais waiters recomputam.
 * @example
 * const extracao = await getOrCompute(store, key, () => extrairAudio(anexo));
 */
export async function getOrCompute<V>(
  store: CacheStore<V>,
  key: CacheKey,
  compute: () => Promise<V>,
): Promise<V> {
  // Fast-path: hit comum não precisa serializar no lock.
  const cached = await store.get(key);
  if (cached !== undefined) {
    return cached;
  }

  return store.lock(key, async () => {
    // Double-check: outro waiter da mesma chave pode ter gravado enquanto
    // esperávamos o lock — reusa o resultado em vez de recomputar.
    const existing = await store.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const value = await compute();
    await store.put(key, value);
    return value;
  });
}
