/**
 * Implementação de REFERÊNCIA em memória do {@link CacheStore} (M3-01, ADR-004).
 *
 * Serve a dois propósitos: (1) fixar o comportamento esperado que a suíte de
 * contrato valida e (2) ser um backend real usável em testes de camadas
 * superiores. A implementação em disco (issues seguintes) satisfará o mesmo
 * contrato e passará na mesma suíte.
 *
 * O lock por chave é promise-based: cada chave mantém a cauda de uma fila
 * encadeada de promises; um novo pretendente espera a cauda atual antes de
 * executar sua seção crítica. Um teto de "stale lock" evita deadlock permanente
 * caso um detentor nunca libere.
 */

import type { Logger } from '../client/index.js';

import {
  DEFAULT_STALE_LOCK_TTL_MS,
  serializeCacheKey,
  type CacheKey,
  type CacheStore,
  type CacheStoreOptions,
  type GcHook,
} from './contract.js';

/** Logger no-op: usado quando nenhum logger é injetado. Nunca `console.*`. */
const noopLogger: Logger = { warn: () => undefined };

/** Resultado da corrida entre "detentor liberou" e "teto de stale estourou". */
type LockWaitOutcome = 'released' | 'stale';

/**
 * {@link CacheStore} em memória (referência do contrato ADR-004). Não persiste
 * entre processos; o isolamento por instância se dá pela própria chave.
 *
 * @typeParam V - Tipo do valor cacheado.
 */
export class InMemoryCacheStore<V = unknown> implements CacheStore<V> {
  private readonly entries = new Map<string, V>();
  /** Cauda da fila de locks por chave serializada. */
  private readonly lockTails = new Map<string, Promise<void>>();
  private readonly logger: Logger;
  private readonly onGc: GcHook | undefined;
  private readonly staleLockTtlMs: number;

  /** @param options - Ver {@link CacheStoreOptions}. */
  constructor(options: CacheStoreOptions = {}) {
    this.logger = options.logger ?? noopLogger;
    this.onGc = options.onGc;
    this.staleLockTtlMs = options.staleLockTtlMs ?? DEFAULT_STALE_LOCK_TTL_MS;
  }

  /** @inheritdoc */
  async get(key: CacheKey): Promise<V | undefined> {
    return this.entries.get(serializeCacheKey(key));
  }

  /** @inheritdoc */
  async put(key: CacheKey, value: V): Promise<void> {
    this.entries.set(serializeCacheKey(key), value);
    await this.runGc('put');
  }

  /** @inheritdoc */
  async invalidate(key: CacheKey): Promise<void> {
    this.entries.delete(serializeCacheKey(key));
  }

  /** @inheritdoc */
  async lock<T>(key: CacheKey, critical: () => Promise<T>): Promise<T> {
    const serial = serializeCacheKey(key);
    const previous = this.lockTails.get(serial);

    // Encadeia esta aquisição na cauda: o próximo pretendente esperará `current`.
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.lockTails.set(serial, current);

    if (previous !== undefined) {
      await this.awaitHolder(previous, serial);
    }

    try {
      return await critical();
    } finally {
      release();
      // Só limpa o mapa se ninguém entrou na fila depois de nós (evita vazar
      // chaves) — caso contrário a cauda ainda é necessária para o próximo.
      if (this.lockTails.get(serial) === current) {
        this.lockTails.delete(serial);
      }
    }
  }

  /** @inheritdoc */
  async gc(): Promise<void> {
    await this.runGc('manual');
  }

  /**
   * Espera o detentor anterior liberar, com teto de stale lock: se o detentor
   * exceder `staleLockTtlMs`, assume-se que ele morreu e a aquisição prossegue
   * (com aviso). `staleLockTtlMs <= 0` desabilita o teto (espera indefinida).
   */
  private async awaitHolder(previous: Promise<void>, serial: string): Promise<void> {
    if (this.staleLockTtlMs <= 0) {
      await previous;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const staleTimeout = new Promise<LockWaitOutcome>((resolve) => {
      timer = setTimeout(() => resolve('stale'), this.staleLockTtlMs);
    });
    const outcome = await Promise.race<LockWaitOutcome>([
      previous.then((): LockWaitOutcome => 'released'),
      staleTimeout,
    ]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (outcome === 'stale') {
      this.logger.warn(
        `Lock estagnado para a chave ${serial} após ${this.staleLockTtlMs}ms; prosseguindo.`,
      );
    }
  }

  /** Aciona o hook de GC, se configurado, com a origem informada. */
  private async runGc(reason: 'put' | 'manual'): Promise<void> {
    if (this.onGc === undefined) {
      return;
    }
    await this.onGc({ reason, entryCount: this.entries.size });
  }
}
