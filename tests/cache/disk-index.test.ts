/**
 * Testes do ÍNDICE por instância da {@link DiskCacheStore} (M3-05.1, ADR-004).
 *
 * O índice (`<cache_dir>/<instance_hash>/index.json`) alimenta o futuro GC/LRU
 * (#47): registra, por entrada da camada de attachment, a chave serializada, o
 * tamanho em bytes, o tipo (`original` | `extraction`) e o `last_accessed_at`.
 * Estes testes exercitam o comportamento OBSERVÁVEL no disco: atualização em
 * get/put, throttle da escrita em leitura, reconstrução pós-corrupção/ausência,
 * isolamento multi-instância e exclusão do próprio índice da contagem de GC.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DiskCacheStore, serializeCacheKey, type GcContext } from '../../src/cache/index.js';
import type { CacheIndexEntry } from '../../src/cache/disk-index.js';

import { contractKeys } from './contract-suite.js';

let baseDir: string;

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'rc-disk-index-'));
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Cria um diretório de cache limpo e isolado para um único store/teste. */
function freshCacheDir(): string {
  return mkdtempSync(join(baseDir, 'store-'));
}

/** Formato do arquivo `index.json` como persistido em disco. */
interface IndexFileShape {
  version: number;
  entries: Record<string, CacheIndexEntry>;
}

/** Lê e faz parse do `index.json` de uma instância no disco. */
function readIndex(cacheDir: string, instanceHash: string): IndexFileShape {
  return JSON.parse(readFileSync(join(cacheDir, instanceHash, 'index.json'), 'utf8')) as IndexFileShape;
}

/** Devolve as entradas do índice como array (ordem irrelevante). */
function entriesOf(cacheDir: string, instanceHash: string): CacheIndexEntry[] {
  return Object.values(readIndex(cacheDir, instanceHash).entries);
}

const INSTANCE = 'a1b2c3d4e5f60718';

describe('DiskCacheStore índice: registro em put', () => {
  it('registra chave serializada, tamanho, tipo (extraction default) e last_accessed_at', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<{ text: string }>({ cacheDir });
    const key = contractKeys.attachment({ instanceHash: INSTANCE });

    await store.put(key, { text: 'olá' });

    const entries = entriesOf(cacheDir, INSTANCE);
    expect(entries).toHaveLength(1);
    const entry = entries[0] as CacheIndexEntry;
    expect(entry.key).toBe(serializeCacheKey(key));
    expect(entry.size).toBe(Buffer.byteLength(JSON.stringify({ text: 'olá' })));
    expect(entry.type).toBe('extraction');
    expect(() => new Date(entry.lastAccessedAt).toISOString()).not.toThrow();
    expect(Number.isNaN(Date.parse(entry.lastAccessedAt))).toBe(false);
  });

  it('classifica como original quando put recebe { type: "original" }', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.attachment({ instanceHash: INSTANCE });

    await store.put(key, 'binario', { type: 'original' });

    expect((entriesOf(cacheDir, INSTANCE)[0] as CacheIndexEntry).type).toBe('original');
  });

  it('substituir o valor atualiza tamanho e last_accessed_at sem duplicar entrada', async () => {
    vi.useFakeTimers();
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.attachment({ instanceHash: INSTANCE });

    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
    await store.put(key, 'v1');
    const first = entriesOf(cacheDir, INSTANCE)[0] as CacheIndexEntry;

    vi.setSystemTime(new Date('2026-07-20T00:05:00Z'));
    await store.put(key, 'valor-bem-maior');
    const entries = entriesOf(cacheDir, INSTANCE);

    expect(entries).toHaveLength(1);
    const second = entries[0] as CacheIndexEntry;
    expect(second.size).toBeGreaterThan(first.size);
    expect(Date.parse(second.lastAccessedAt)).toBeGreaterThan(Date.parse(first.lastAccessedAt));
  });

  it('entradas issue-level (sem instance_hash) não entram no índice por instância', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });

    await store.put(contractKeys.issue({ issueId: 42 }), 'bundle');

    expect(existsSync(join(cacheDir, 'issues', 'index.json'))).toBe(false);
    // Nenhum diretório de instância foi criado para uma entrada issue-level.
    expect(readdirSync(cacheDir)).toEqual(['issues']);
  });
});

describe('DiskCacheStore índice: atualização em get e throttle', () => {
  it('get atualiza last_accessed_at (flush no gc)', async () => {
    vi.useFakeTimers();
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.attachment({ instanceHash: INSTANCE });

    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
    await store.put(key, 'v');
    const t0 = (entriesOf(cacheDir, INSTANCE)[0] as CacheIndexEntry).lastAccessedAt;

    vi.setSystemTime(new Date('2026-07-20T01:00:00Z'));
    expect(await store.get(key)).toBe('v');
    await store.gc(); // flush do buffer de last_accessed_at

    const t1 = (entriesOf(cacheDir, INSTANCE)[0] as CacheIndexEntry).lastAccessedAt;
    expect(Date.parse(t1)).toBeGreaterThan(Date.parse(t0));
  });

  it('get é throttled: não persiste no disco a cada leitura, só no próximo put/gc', async () => {
    vi.useFakeTimers();
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.attachment({ instanceHash: INSTANCE });

    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
    await store.put(key, 'v');
    const t0 = (entriesOf(cacheDir, INSTANCE)[0] as CacheIndexEntry).lastAccessedAt;

    vi.setSystemTime(new Date('2026-07-20T02:00:00Z'));
    await store.get(key);
    // Sem flush: o disco ainda reflete o instante do put (janela de perda aceita).
    expect((entriesOf(cacheDir, INSTANCE)[0] as CacheIndexEntry).lastAccessedAt).toBe(t0);

    await store.gc();
    expect((entriesOf(cacheDir, INSTANCE)[0] as CacheIndexEntry).lastAccessedAt).not.toBe(t0);
  });
});

describe('DiskCacheStore índice: reconstrução resiliente', () => {
  it('índice corrompido é reconstruído a partir do disco sem crash', async () => {
    const cacheDir = freshCacheDir();
    const warn = vi.fn();
    const store = new DiskCacheStore<string>({ cacheDir, logger: { warn } });
    const keyA = contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 1 });
    const keyB = contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 2 });
    await store.put(keyA, 'a');
    await store.put(keyB, 'b');

    // Corrompe o índice em disco (crash no meio de um rename antigo, p.ex.).
    writeFileSync(join(cacheDir, INSTANCE, 'index.json'), '{ nao é json', 'utf8');

    // Novo processo: nova instância que carrega o índice corrompido.
    const reopened = new DiskCacheStore<string>({ cacheDir, logger: { warn } });
    expect(await reopened.get(keyA)).toBe('a'); // não crasha
    await reopened.gc(); // flush da reconstrução

    const entries = entriesOf(cacheDir, INSTANCE);
    expect(entries).toHaveLength(2); // ambos os arquivos varridos do disco
    for (const entry of entries) {
      expect(entry.size).toBeGreaterThan(0);
      expect(entry.type).toBe('extraction');
      expect(Number.isNaN(Date.parse(entry.lastAccessedAt))).toBe(false);
    }
    expect(warn).toHaveBeenCalled();
  });

  it('índice ausente com arquivos preexistentes é reconstruído no primeiro acesso', async () => {
    const cacheDir = freshCacheDir();
    const writer = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 9 });
    await store_put(writer, key, 'extraido');

    // Remove o índice, preservando os arquivos de valor.
    await rm(join(cacheDir, INSTANCE, 'index.json'), { force: true });
    expect(existsSync(join(cacheDir, INSTANCE, 'index.json'))).toBe(false);

    const reader = new DiskCacheStore<string>({ cacheDir });
    expect(await reader.get(key)).toBe('extraido');
    await reader.gc();

    const entries = entriesOf(cacheDir, INSTANCE);
    expect(entries).toHaveLength(1);
    expect((entries[0] as CacheIndexEntry).size).toBeGreaterThan(0);
  });

  async function store_put(store: DiskCacheStore<string>, key: ReturnType<typeof contractKeys.attachment>, value: string): Promise<void> {
    await store.put(key, value);
  }
});

describe('DiskCacheStore índice: isolamento multi-instância', () => {
  it('cada instance_hash mantém seu próprio índice, sem vazamento entre instâncias', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const hashA = 'aaaa000011112222';
    const hashB = 'bbbb333344445555';
    const keyA = contractKeys.attachment({ instanceHash: hashA });
    const keyB = contractKeys.attachment({ instanceHash: hashB });

    await store.put(keyA, 'a');
    await store.put(keyB, 'b');

    const entriesA = entriesOf(cacheDir, hashA);
    const entriesB = entriesOf(cacheDir, hashB);
    expect(entriesA).toHaveLength(1);
    expect(entriesB).toHaveLength(1);
    expect((entriesA[0] as CacheIndexEntry).key).toBe(serializeCacheKey(keyA));
    expect((entriesB[0] as CacheIndexEntry).key).toBe(serializeCacheKey(keyB));
  });
});

describe('DiskCacheStore índice: invalidate e contagem de GC', () => {
  it('invalidate remove a entrada do índice', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.attachment({ instanceHash: INSTANCE });
    await store.put(key, 'v');
    expect(entriesOf(cacheDir, INSTANCE)).toHaveLength(1);

    await store.invalidate(key);

    expect(entriesOf(cacheDir, INSTANCE)).toHaveLength(0);
  });

  it('o próprio index.json não é contado como entrada pelo hook de GC', async () => {
    const cacheDir = freshCacheDir();
    const calls: GcContext[] = [];
    const store = new DiskCacheStore<string>({ cacheDir, onGc: (ctx) => void calls.push(ctx) });

    await store.put(contractKeys.attachment({ instanceHash: INSTANCE }), 'v');

    // Uma única entrada de valor — o index.json ao lado não infla a contagem.
    expect(calls.at(-1)).toEqual({ reason: 'put', entryCount: 1 });
  });
});
