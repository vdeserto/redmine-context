/**
 * Implementação em DISCO do {@link CacheStore} (M3-02, ADR-004).
 *
 * Persiste cada entrada como um arquivo JSON num layout isolado por instância:
 *
 * - attachment: `<cache_dir>/<instance_hash>/attachments/<id>-<digest8>/<hash>.json`
 * - issue:      `<cache_dir>/issues/<issue_id>/<hash>.json`
 *
 * O `<id>-<digest8>/` segue exatamente o path do ADR-004; `<hash>` é o SHA-256
 * (hex) da chave serializada, garantindo que configurações de extrator distintas
 * (versão/modelo/params) coexistam sob o mesmo anexo sem colidir. Nomes de
 * arquivo/diretório derivam APENAS de `id`/`digest`/`hash` — nunca de conteúdo
 * externo não sanitizado — pois todos esses campos são hex ou inteiros do
 * contrato ({@link serializeCacheKey}).
 *
 * O `cache_dir` padrão vem de `env-paths` (diretório de cache do usuário por SO),
 * com override pela opção {@link DiskCacheStoreOptions.cacheDir} (que o config/a
 * CLI pode preencher). Diretórios são criados SOB DEMANDA no primeiro `put`.
 *
 * Atomicidade: cada `put` escreve num arquivo `.tmp` único e só então faz
 * `rename` para o destino — o `rename` é atômico no mesmo filesystem, de modo que
 * um leitor nunca observa um JSON parcial (crash-safety intra-arquivo).
 *
 * ESCOPO (nota da suíte de contrato, review #129): o lock por chave é HERDADO da
 * implementação in-memory ({@link InMemoryCacheStore}) e vale apenas INTRA-processo
 * — locking CROSS-processo NÃO é escopo desta issue (fica para uma issue de lock
 * de disco). GC/LRU e índice de entradas são #45/#46: {@link gc} apenas aciona o
 * hook configurado (no-op quando ausente).
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import envPaths from 'env-paths';

import {
  serializeCacheKey,
  type CacheKey,
  type CacheStore,
  type CacheStoreOptions,
  type GcHook,
} from './contract.js';
import { InMemoryCacheStore } from './memory.js';
import { DiskCacheIndex, INDEX_FILE_NAME, type CacheEntryType } from './disk-index.js';

/** Comprimento (chars hex) do digest usado no path do anexo (ADR-004). */
const DIGEST_PATH_LENGTH = 8;

/** Subdiretório da camada de issue (bundle/metadados baratos). */
const ISSUES_DIR = 'issues';

/** Subdiretório da camada de attachment sob cada instância. */
const ATTACHMENTS_DIR = 'attachments';

/** Extensão dos arquivos de valor persistidos. */
const VALUE_EXTENSION = '.json';

/** Opções do {@link DiskCacheStore}. */
export interface DiskCacheStoreOptions extends CacheStoreOptions {
  /**
   * Raiz do cache em disco. Default: diretório de cache do usuário via
   * `env-paths` ({@link defaultCacheDir}). Preenchível por config/CLI ou testes.
   */
  cacheDir?: string;
}

/**
 * Raiz de cache padrão do projeto (diretório de cache do usuário por SO, via
 * `env-paths`). Ex.: `~/Library/Caches/redmine-context` no macOS.
 *
 * @returns Caminho absoluto do diretório de cache padrão.
 */
export function defaultCacheDir(): string {
  return envPaths('redmine-context').cache;
}

/**
 * {@link CacheStore} persistente em disco (ADR-004). Entradas sobrevivem à
 * reinicialização do processo: uma nova instância apontando para o mesmo
 * `cacheDir` enxerga tudo o que foi gravado.
 *
 * @typeParam V - Tipo do valor cacheado (serializado como JSON).
 */
export class DiskCacheStore<V = unknown> implements CacheStore<V> {
  private readonly root: string;
  private readonly onGc: GcHook | undefined;
  /**
   * Provedor de lock por chave — HERDADO do in-memory (intra-processo). Não é
   * usado para armazenar valores, apenas para serializar seções críticas por
   * chave com o mesmo comportamento (stale-lock TTL, aviso) do contrato.
   */
  private readonly locks: InMemoryCacheStore<never>;
  private readonly logger: { warn(message: string): void };
  /** Índice por instância (M3-05.1) — alimenta o GC/LRU (#47). */
  private readonly index: DiskCacheIndex;

  /** @param options - Ver {@link DiskCacheStoreOptions}. */
  constructor(options: DiskCacheStoreOptions = {}) {
    this.root = options.cacheDir ?? defaultCacheDir();
    this.onGc = options.onGc;
    this.logger = options.logger ?? { warn: () => undefined };
    this.index = new DiskCacheIndex(this.root, this.logger);
    // Repassa apenas as opções de lock; o GC é responsabilidade deste store.
    this.locks = new InMemoryCacheStore<never>({
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
      ...(options.staleLockTtlMs !== undefined ? { staleLockTtlMs: options.staleLockTtlMs } : {}),
    });
  }

  /** @inheritdoc */
  async get(key: CacheKey): Promise<V | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(key), 'utf8');
    } catch (cause) {
      if (isNotFound(cause)) {
        return undefined;
      }
      throw cause;
    }
    if (key.kind === 'attachment') {
      const parts = this.attachmentParts(key);
      this.index.recordAccess(key.instanceHash, join(parts.dirName, parts.fileName));
    }
    try {
      return JSON.parse(raw) as V;
    } catch {
      // Arquivo corrompido (ex.: crash antes de um rename antigo): trata como
      // cache-miss auto-curável — o próximo put sobrescreve. Nunca crasha nem
      // se confunde com erro de IO real (fix review #131).
      this.logger.warn(`cache: entrada corrompida ignorada (${this.pathFor(key)})`);
      return undefined;
    }
  }

  /**
   * @inheritdoc
   * @param options - `type` classifica a entrada no índice por instância
   *   (`extraction` default; `original` para bytes baixados) — quotas do GC #47.
   */
  async put(key: CacheKey, value: V, options: { type?: CacheEntryType } = {}): Promise<void> {
    const filePath = this.pathFor(key);
    await mkdir(dirname(filePath), { recursive: true });
    // Escreve-e-renomeia: o destino só passa a existir de forma completa após o
    // rename atômico; leitores nunca observam um JSON pela metade.
    const serialized = JSON.stringify(value);
    const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmpPath, serialized);
    await rename(tmpPath, filePath);
    if (key.kind === 'attachment') {
      const parts = this.attachmentParts(key);
      await this.index.recordPut(key.instanceHash, join(parts.dirName, parts.fileName), {
        key: serializeCacheKey(key),
        size: Buffer.byteLength(serialized),
        type: options.type ?? 'extraction',
        lastAccessedAt: new Date().toISOString(),
      });
    }
    await this.runGc('put');
  }

  /** @inheritdoc */
  async invalidate(key: CacheKey): Promise<void> {
    await rm(this.pathFor(key), { force: true });
    if (key.kind === 'attachment') {
      const parts = this.attachmentParts(key);
      await this.index.remove(key.instanceHash, join(parts.dirName, parts.fileName));
    }
  }

  /** @inheritdoc */
  async lock<T>(key: CacheKey, critical: () => Promise<T>): Promise<T> {
    return this.locks.lock(key, critical);
  }

  /** @inheritdoc */
  async gc(): Promise<void> {
    // Flush do buffer de last_accessed_at (M3-05.1) antes de observar o estado.
    await this.index.flushAll();
    await this.runGc('manual');
  }

  /**
   * Resolve o caminho absoluto do arquivo de valor de uma chave, seguindo o
   * layout do ADR-004. O nome do arquivo é o SHA-256 hex da chave serializada,
   * distinguindo configurações de extrator sob o mesmo `<id>-<digest8>/`.
   */
  /** Partes do caminho de uma chave attachment: dir `<id>-<digest8>` e arquivo. */
  private attachmentParts(key: Extract<CacheKey, { kind: 'attachment' }>): { dirName: string; fileName: string } {
    const fileName = createHash('sha256').update(serializeCacheKey(key)).digest('hex') + VALUE_EXTENSION;
    const hexDigest = /^[0-9a-fA-F]{8,64}$/.test(key.digest)
      ? key.digest.toLowerCase()
      : createHash('sha256').update(key.digest).digest('hex');
    return { dirName: `${key.attachmentId}-${hexDigest.slice(0, DIGEST_PATH_LENGTH)}`, fileName };
  }

  private pathFor(key: CacheKey): string {
    const fileName = createHash('sha256').update(serializeCacheKey(key)).digest('hex') + VALUE_EXTENSION;
    if (key.kind === 'attachment') {
      // O digest vem da API (conteúdo EXTERNO): só entra no path se for hex
      // puro; qualquer outra forma (fallback id+filesize+created_on de
      // Redmine antigo, ou valor malicioso com `../`) é normalizada por
      // sha256 — traversal impossível por construção (fix review #131).
      const hexDigest = /^[0-9a-fA-F]{8,64}$/.test(key.digest)
        ? key.digest.toLowerCase()
        : createHash('sha256').update(key.digest).digest('hex');
      const digest8 = hexDigest.slice(0, DIGEST_PATH_LENGTH);
      const dir = join(this.root, key.instanceHash, ATTACHMENTS_DIR, `${key.attachmentId}-${digest8}`);
      return join(dir, fileName);
    }
    return join(this.root, ISSUES_DIR, String(key.issueId), fileName);
  }

  /**
   * Aciona o hook de GC, se configurado, com a contagem REAL de entradas em
   * disco. Nesta issue não há despejo (GC/LRU é #45/#46): o hook apenas observa.
   */
  private async runGc(reason: 'put' | 'manual'): Promise<void> {
    if (this.onGc === undefined) {
      return;
    }
    await this.onGc({ reason, entryCount: await this.countEntries(this.root) });
  }

  /** Conta recursivamente os arquivos de valor (`.json`) sob `dir`. */
  private async countEntries(dir: string): Promise<number> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (cause) {
      if (isNotFound(cause)) {
        return 0;
      }
      throw cause;
    }
    let count = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += await this.countEntries(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(VALUE_EXTENSION) && entry.name !== INDEX_FILE_NAME) {
        count += 1;
      }
    }
    return count;
  }
}

/** Verifica se um erro do fs é "arquivo não encontrado" (ENOENT). */
function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: string }).code === 'ENOENT'
  );
}
