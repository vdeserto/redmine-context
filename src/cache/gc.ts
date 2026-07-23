/**
 * Política PURA de GC/LRU do cache em disco (M3-05.2, #47, ADR-004).
 *
 * Este módulo NÃO toca no filesystem: recebe uma lista de entradas candidatas
 * (tamanho, tipo e `last_accessed_at`, vindas do índice por instância do #46) e
 * DECIDE quais remover para respeitar o teto global (default 2 GB) e as quotas
 * SEPARADAS por tipo. A integração (leitura do índice, remoção dos arquivos e do
 * registro) fica no {@link ../cache/disk.js DiskCacheStore}. Separar a decisão da
 * execução deixa a política totalmente testável com fakes de tamanho.
 *
 * Estratégia de quotas (ADR-004, item 4):
 * - Originais (`type: 'original'`): recuperáveis do Redmine → remoção AGRESSIVA.
 *   Podem ocupar no máximo {@link DEFAULT_MAX_ORIGINAL_FRACTION} (50%) do teto;
 *   ao estourar essa quota, saem primeiro (LRU), mesmo que o teto GLOBAL ainda
 *   não tenha sido violado.
 * - Extrações (`type: 'extraction'`): caras de reproduzir → remoção CONSERVADORA.
 *   Só são removidas quando, após despejar TODOS os originais, o total ainda
 *   excede o teto global. A extração mais recentemente acessada é a última a sair.
 *
 * O critério de idade é sempre `last_accessed_at` (LRU): mais antigo sai primeiro;
 * empates são desfeitos de forma determinística por `instanceHash`+`recordKey`.
 */

import { resolve, sep } from 'node:path';

import type { CacheEntryType } from './disk-index.js';

/** Teto global default do cache em bytes (2 GB — ADR-004). */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** Fração máxima do teto que os originais podem ocupar (quota agressiva). */
export const DEFAULT_MAX_ORIGINAL_FRACTION = 0.5;

/**
 * Uma entrada candidata ao GC. Carrega o suficiente para (a) decidir a remoção
 * pela política e (b) localizar o arquivo/registro na integração.
 */
export interface GcCandidate {
  /** Instância dona da entrada — namespace do índice e do diretório. */
  instanceHash: string;
  /** Chave de registro no índice: caminho relativo dentro de `attachments/`. */
  recordKey: string;
  /** Tamanho do valor em bytes (do índice). */
  size: number;
  /** Classificação para as quotas separadas. */
  type: CacheEntryType;
  /** ISO 8601 do último acesso conhecido — critério LRU. */
  lastAccessedAt: string;
}

/** Parâmetros da política de GC. */
export interface GcPolicyOptions {
  /** Teto global do cache em bytes. */
  maxBytes: number;
  /**
   * Fração máxima do teto ocupável por originais (0..1). Default
   * {@link DEFAULT_MAX_ORIGINAL_FRACTION}.
   */
  maxOriginalFraction?: number;
}

/** Resultado da política: as entradas a remover, já em ordem de despejo (LRU). */
export interface GcDecision {
  /** Entradas a remover, da mais antiga (primeira a sair) para a mais recente. */
  remove: GcCandidate[];
}

/**
 * Decide quais entradas remover para respeitar teto global e quotas separadas.
 *
 * @param candidates - Todas as entradas atualmente no cache (qualquer instância).
 * @param options - Ver {@link GcPolicyOptions}.
 * @returns As entradas a despejar (vazio se nada precisa sair) — ver {@link GcDecision}.
 * @example
 * const { remove } = planGc(entries, { maxBytes: 2 * 1024 ** 3 });
 */
export function planGc(candidates: readonly GcCandidate[], options: GcPolicyOptions): GcDecision {
  const maxBytes = options.maxBytes;
  const fraction = options.maxOriginalFraction ?? DEFAULT_MAX_ORIGINAL_FRACTION;
  const originalsCap = maxBytes * fraction;

  // Ordem LRU crescente: o mais antigo (primeiro a sair) na frente. Empate
  // determinístico por instância+registro para reprodutibilidade.
  const lruAscending = [...candidates].sort(compareLru);

  const removed = new Set<GcCandidate>();
  let totalSize = sum(candidates);
  let originalsSize = sum(candidates.filter((c) => c.type === 'original'));

  // Passo A — quota dos originais: podem ocupar no máx `originalsCap`.
  for (const candidate of lruAscending) {
    if (originalsSize <= originalsCap) {
      break;
    }
    if (candidate.type !== 'original' || removed.has(candidate)) {
      continue;
    }
    removed.add(candidate);
    originalsSize -= candidate.size;
    totalSize -= candidate.size;
  }

  // Passo B — teto global: originais LRU primeiro (recuperáveis)...
  for (const candidate of lruAscending) {
    if (totalSize <= maxBytes) {
      break;
    }
    if (candidate.type !== 'original' || removed.has(candidate)) {
      continue;
    }
    removed.add(candidate);
    totalSize -= candidate.size;
  }
  // ...e só então extrações LRU (caras), se ainda exceder.
  for (const candidate of lruAscending) {
    if (totalSize <= maxBytes) {
      break;
    }
    if (candidate.type !== 'extraction' || removed.has(candidate)) {
      continue;
    }
    removed.add(candidate);
    totalSize -= candidate.size;
  }

  return { remove: lruAscending.filter((candidate) => removed.has(candidate)) };
}

/**
 * Guard anti-traversal do despejo: resolve o caminho ABSOLUTO de um alvo de
 * remoção e devolve `undefined` se ele cair FORA de `<instanceRoot>/` (ex.: um
 * `recordKey` com `../`). Garante que o GC só apaga dentro da instância.
 *
 * @param instanceRoot - Raiz absoluta da instância (`<cache_dir>/<instance_hash>`).
 * @param relativePath - Caminho relativo à raiz da instância (inclui `attachments/`).
 * @returns Caminho absoluto seguro, ou `undefined` se escaparia da instância.
 */
export function resolveEvictionTarget(instanceRoot: string, relativePath: string): string | undefined {
  const base = resolve(instanceRoot);
  const target = resolve(base, relativePath);
  // Estritamente ABAIXO da raiz da instância: nunca a própria raiz nem irmãos.
  if (target.startsWith(base + sep)) {
    return target;
  }
  return undefined;
}

/** Soma dos tamanhos de um conjunto de candidatas. */
function sum(candidates: readonly GcCandidate[]): number {
  let total = 0;
  for (const candidate of candidates) {
    total += candidate.size;
  }
  return total;
}

/** Comparador LRU crescente com desempate determinístico. */
function compareLru(a: GcCandidate, b: GcCandidate): number {
  const ta = Date.parse(a.lastAccessedAt);
  const tb = Date.parse(b.lastAccessedAt);
  if (ta !== tb) {
    return ta - tb;
  }
  if (a.instanceHash !== b.instanceHash) {
    return a.instanceHash < b.instanceHash ? -1 : 1;
  }
  if (a.recordKey !== b.recordKey) {
    return a.recordKey < b.recordKey ? -1 : 1;
  }
  return 0;
}
