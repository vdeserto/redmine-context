/**
 * Testes da POLÍTICA PURA de GC/LRU (M3-05.2, #47, ADR-004).
 *
 * `planGc` decide QUAIS entradas remover a partir de uma lista de candidatas
 * (tamanho, tipo e `last_accessed_at`), respeitando o teto global (default 2 GB)
 * e as quotas SEPARADAS: originais (recuperáveis do Redmine) removidos de forma
 * AGRESSIVA, extrações (caras) preservadas até ser estritamente necessário.
 * `resolveEvictionTarget` é o guard de path (só remove dentro da instância).
 */

import { resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ORIGINAL_FRACTION,
  planGc,
  resolveEvictionTarget,
  type GcCandidate,
} from '../../src/cache/gc.js';

/** Constrói uma candidata com defaults sensatos para os testes. */
function candidate(overrides: Partial<GcCandidate> = {}): GcCandidate {
  return {
    instanceHash: 'a1b2c3d4e5f60718',
    recordKey: '7-deadbeef/hash.json',
    size: 100,
    type: 'extraction',
    lastAccessedAt: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

/** Conjunto de recordKeys removidos, para asserção independente de ordem. */
function removedKeys(candidates: readonly GcCandidate[], maxBytes: number, fraction?: number): Set<string> {
  const { remove } = planGc(candidates, {
    maxBytes,
    ...(fraction !== undefined ? { maxOriginalFraction: fraction } : {}),
  });
  return new Set(remove.map((c) => c.recordKey));
}

describe('planGc: teto global e ausência de despejo', () => {
  it('não remove nada quando o total cabe no teto', () => {
    const candidates = [
      candidate({ recordKey: 'a', size: 100 }),
      candidate({ recordKey: 'b', size: 100, type: 'original' }),
    ];
    expect(planGc(candidates, { maxBytes: 1000 }).remove).toEqual([]);
  });

  it('lista vazia é no-op', () => {
    expect(planGc([], { maxBytes: 10 }).remove).toEqual([]);
  });

  it('expõe defaults documentados (2 GB e 50%)', () => {
    expect(DEFAULT_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024);
    expect(DEFAULT_MAX_ORIGINAL_FRACTION).toBe(0.5);
  });
});

describe('planGc: quota separada dos originais (máx 50% do teto)', () => {
  it('remove originais LRU quando ultrapassam a quota, mesmo cabendo no teto global', () => {
    // Teto 1000, quota de originais = 500. Originais somam 700 (> 500);
    // total 800 (< 1000). Só a quota de originais é violada.
    const candidates = [
      candidate({ recordKey: 'orig-old', size: 400, type: 'original', lastAccessedAt: '2026-07-20T00:00:00Z' }),
      candidate({ recordKey: 'orig-new', size: 300, type: 'original', lastAccessedAt: '2026-07-20T02:00:00Z' }),
      candidate({ recordKey: 'extr', size: 100, type: 'extraction', lastAccessedAt: '2026-07-20T00:00:00Z' }),
    ];
    const removed = removedKeys(candidates, 1000, 0.5);
    // Remove o original mais ANTIGO até caber em 500 (700-400=300 <= 500).
    expect(removed).toEqual(new Set(['orig-old']));
  });

  it('nunca remove extrações para satisfazer a quota de originais', () => {
    const candidates = [
      candidate({ recordKey: 'orig', size: 900, type: 'original', lastAccessedAt: '2026-07-20T00:00:00Z' }),
      candidate({ recordKey: 'extr', size: 50, type: 'extraction', lastAccessedAt: '2026-07-19T00:00:00Z' }),
    ];
    // Teto 2000 (total 950 cabe), quota originais = 1000; original (900) cabe.
    // Extração antiga NÃO deve sair.
    expect(removedKeys(candidates, 2000, 0.5)).toEqual(new Set());
  });
});

describe('planGc: estouro do teto global remove originais LRU primeiro', () => {
  it('remove originais (LRU) antes de tocar em qualquer extração', () => {
    // Teto 500. Total = 900. Originais 400 (dentro da quota 250? não: quota=250).
    const candidates = [
      candidate({ recordKey: 'extr-old', size: 300, type: 'extraction', lastAccessedAt: '2026-07-19T00:00:00Z' }),
      candidate({ recordKey: 'orig-old', size: 200, type: 'original', lastAccessedAt: '2026-07-20T00:00:00Z' }),
      candidate({ recordKey: 'orig-new', size: 200, type: 'original', lastAccessedAt: '2026-07-20T05:00:00Z' }),
      candidate({ recordKey: 'extr-new', size: 200, type: 'extraction', lastAccessedAt: '2026-07-20T06:00:00Z' }),
    ];
    // Total 900 > 500. Originais primeiro (ambos, LRU): remove os dois originais
    // (900-400=500 <= 500). Extrações preservadas.
    expect(removedKeys(candidates, 500, 0.5)).toEqual(new Set(['orig-old', 'orig-new']));
  });

  it('remove extrações (LRU) SÓ se ainda exceder após remover todos os originais', () => {
    const candidates = [
      candidate({ recordKey: 'orig', size: 200, type: 'original', lastAccessedAt: '2026-07-20T00:00:00Z' }),
      candidate({ recordKey: 'extr-old', size: 300, type: 'extraction', lastAccessedAt: '2026-07-19T00:00:00Z' }),
      candidate({ recordKey: 'extr-mid', size: 300, type: 'extraction', lastAccessedAt: '2026-07-20T03:00:00Z' }),
      candidate({ recordKey: 'extr-new', size: 300, type: 'extraction', lastAccessedAt: '2026-07-20T09:00:00Z' }),
    ];
    // Total 1100, teto 500. Remove original (1100-200=900). Ainda > 500:
    // remove extrações LRU: extr-old (900-300=600 > 500), extr-mid (600-300=300 <= 500).
    // extr-new (mais recente) preservada.
    expect(removedKeys(candidates, 500, 0.5)).toEqual(new Set(['orig', 'extr-old', 'extr-mid']));
  });

  it('preserva a extração mais recente mesmo sob forte pressão', () => {
    const candidates = [
      candidate({ recordKey: 'e1', size: 400, type: 'extraction', lastAccessedAt: '2026-07-19T00:00:00Z' }),
      candidate({ recordKey: 'e2', size: 400, type: 'extraction', lastAccessedAt: '2026-07-20T00:00:00Z' }),
    ];
    // Teto 400. Remove só a mais antiga (e1); e2 fica (800-400=400 <= 400).
    expect(removedKeys(candidates, 400, 0.5)).toEqual(new Set(['e1']));
  });
});

describe('planGc: ordenação LRU determinística', () => {
  it('desempata por instanceHash+recordKey quando o timestamp é igual', () => {
    const candidates = [
      candidate({ instanceHash: 'bbbb', recordKey: 'z', size: 100, type: 'extraction', lastAccessedAt: '2026-07-20T00:00:00Z' }),
      candidate({ instanceHash: 'aaaa', recordKey: 'a', size: 100, type: 'extraction', lastAccessedAt: '2026-07-20T00:00:00Z' }),
    ];
    // Teto 100: remove uma única extração; o desempate escolhe aaaa/a primeiro.
    const { remove } = planGc(candidates, { maxBytes: 100 });
    expect(remove.map((c) => c.recordKey)).toEqual(['a']);
  });
});

describe('resolveEvictionTarget: guard de path (só dentro da instância)', () => {
  const instanceRoot = resolve('/cache', 'a1b2c3d4e5f60718');

  it('resolve caminhos legítimos dentro de attachments/', () => {
    const target = resolveEvictionTarget(instanceRoot, 'attachments/7-deadbeef/hash.json');
    expect(target).toBe(resolve(instanceRoot, 'attachments', '7-deadbeef', 'hash.json'));
    expect(target?.startsWith(instanceRoot + sep)).toBe(true);
  });

  it('recusa (undefined) qualquer recordKey que escape com ../', () => {
    expect(resolveEvictionTarget(instanceRoot, 'attachments/../../../etc/passwd')).toBeUndefined();
    expect(resolveEvictionTarget(instanceRoot, '../../evil')).toBeUndefined();
  });

  it('recusa caminho que aponte para o próprio instanceRoot (sem subpath)', () => {
    expect(resolveEvictionTarget(instanceRoot, 'attachments/..')).toBeUndefined();
  });
});
