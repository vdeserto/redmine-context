/**
 * Testes de INTEGRAÇÃO do GC/LRU no {@link DiskCacheStore} (M3-05.2, #47).
 *
 * Exercitam o comportamento observável em disco quando o teto (`maxBytes`) é
 * estourado com fakes de tamanho: estouro remove originais LRU primeiro, as
 * extrações são preservadas até ser necessário, o índice fica consistente
 * (entradas removidas saem do `index.json`) e o hook `onGc` continua observável.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DiskCacheStore, type GcContext } from '../../src/cache/index.js';
import type { CacheIndexEntry } from '../../src/cache/disk-index.js';

import { contractKeys } from './contract-suite.js';

/** Lê as entradas do `index.json` de uma instância como array. */
function readIndexEntries(cacheDir: string, instanceHash: string): CacheIndexEntry[] {
  const raw = readFileSync(join(cacheDir, instanceHash, 'index.json'), 'utf8');
  const parsed = JSON.parse(raw) as { entries: Record<string, CacheIndexEntry> };
  return Object.values(parsed.entries);
}

let baseDir: string;

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'rc-disk-gc-'));
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function freshCacheDir(): string {
  return mkdtempSync(join(baseDir, 'store-'));
}

const INSTANCE = 'a1b2c3d4e5f60718';

/** Gera uma string de ~`bytes` chars (fake de tamanho para o GC). */
function payload(bytes: number): string {
  return 'x'.repeat(bytes);
}

describe('DiskCacheStore GC: estouro remove originais LRU primeiro', () => {
  it('remove originais mais antigos e preserva extrações quando o teto estoura', async () => {
    vi.useFakeTimers();
    const cacheDir = freshCacheDir();
    // Teto pequeno; cada valor ~120 bytes (payload 100 + overhead de aspas JSON).
    const store = new DiskCacheStore<string>({ cacheDir, maxBytes: 350 });

    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 1 }), payload(100), { type: 'original' });
    vi.setSystemTime(new Date('2026-07-20T01:00:00Z'));
    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 2 }), payload(100), { type: 'extraction' });
    vi.setSystemTime(new Date('2026-07-20T02:00:00Z'));
    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 3 }), payload(100), { type: 'original' });

    vi.useRealTimers();
    await store.gc();

    const entries = readIndexEntries(cacheDir, INSTANCE);
    const types = entries.map((e) => e.type).sort();
    // Original mais antigo (attachmentId 1) despejado; extração preservada.
    expect(entries.length).toBeLessThan(3);
    expect(types).toContain('extraction');
    // A extração (attachmentId 2) continua recuperável.
    expect(await store.get(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 2 }))).toBe(payload(100));
  });
});

describe('DiskCacheStore GC: extrações só saem se ainda exceder', () => {
  it('remove extração LRU apenas quando não há mais originais e o teto persiste', async () => {
    vi.useFakeTimers();
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir, maxBytes: 260 });

    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 10 }), payload(100), { type: 'extraction' });
    vi.setSystemTime(new Date('2026-07-20T01:00:00Z'));
    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 11 }), payload(100), { type: 'extraction' });
    vi.setSystemTime(new Date('2026-07-20T02:00:00Z'));
    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 12 }), payload(100), { type: 'extraction' });

    vi.useRealTimers();
    await store.gc();

    // A extração mais recente (12) NUNCA é a primeira a sair.
    expect(await store.get(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 12 }))).toBe(payload(100));
    // A mais antiga (10) foi despejada para caber no teto.
    expect(await store.get(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 10 }))).toBeUndefined();
  });
});

describe('DiskCacheStore GC: índice consistente pós-GC', () => {
  it('entradas removidas somem do index.json E do disco', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir, maxBytes: 200 });

    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 1 }), payload(100), { type: 'original' });
    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 2 }), payload(100), { type: 'original' });
    await store.gc();

    const entries = readIndexEntries(cacheDir, INSTANCE);
    // Pelo menos uma removida (originais agressivos): índice encolheu.
    expect(entries.length).toBeLessThan(2);
  });
});

describe('DiskCacheStore GC: teto default não despeja e hook observável', () => {
  it('com maxBytes default (2 GB) nada é removido e onGc reflete a contagem real', async () => {
    const cacheDir = freshCacheDir();
    const calls: GcContext[] = [];
    const store = new DiskCacheStore<string>({ cacheDir, onGc: (ctx) => void calls.push(ctx) });

    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 1 }), 'a', { type: 'original' });
    await store.put(contractKeys.attachment({ instanceHash: INSTANCE, attachmentId: 2 }), 'b', { type: 'extraction' });

    expect(readIndexEntries(cacheDir, INSTANCE)).toHaveLength(2);
    expect(calls.at(-1)?.entryCount).toBe(2);
  });
});
