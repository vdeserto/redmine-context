/**
 * Testes de `job-status.ts` (#34/M2-11) — mapeamento ícone/cor/rótulo por
 * `JobStatus`, mesmo padrão de `attachment-status.test.ts`. Escrito ANTES da
 * implementação (TDD).
 */
import { describe, expect, it } from 'vitest';

import { jobStatusColor, jobStatusIcon, jobStatusLabel } from '../../../src/surfaces/tui/job-status.js';
import type { JobStatus } from '../../../src/surfaces/tui/job-registry.js';
import { symbols } from '../../../src/surfaces/tui/symbols.js';
import { DEFAULT_THEME } from '../../../src/surfaces/tui/theme.js';

const ALL_STATUSES: JobStatus[] = ['pending', 'processing', 'done', 'failed'];

describe('jobStatusColor', () => {
  it('devolve um token do tema para cada status (nunca uma cor literal)', () => {
    expect(jobStatusColor(DEFAULT_THEME, 'pending')).toBe(DEFAULT_THEME.muted);
    expect(jobStatusColor(DEFAULT_THEME, 'processing')).toBe(DEFAULT_THEME.primary);
    expect(jobStatusColor(DEFAULT_THEME, 'done')).toBe(DEFAULT_THEME.success);
    expect(jobStatusColor(DEFAULT_THEME, 'failed')).toBe(DEFAULT_THEME.danger);
  });

  it('cobre exaustivamente os 4 status conhecidos', () => {
    for (const status of ALL_STATUSES) {
      expect(() => jobStatusColor(DEFAULT_THEME, status)).not.toThrow();
    }
  });
});

describe('jobStatusIcon', () => {
  it('devolve um símbolo estático para pending/done/failed', () => {
    expect(jobStatusIcon('pending')).toBe(symbols.circle);
    expect(jobStatusIcon('done')).toBe(symbols.tick);
    expect(jobStatusIcon('failed')).toBe(symbols.cross);
  });

  it('devolve undefined para "processing" (o painel usa o Spinner animado no lugar)', () => {
    expect(jobStatusIcon('processing')).toBeUndefined();
  });
});

describe('jobStatusLabel', () => {
  it('devolve um rótulo pt-BR não vazio para cada status', () => {
    expect(jobStatusLabel('pending')).toBe('pendente');
    expect(jobStatusLabel('processing')).toBe('processando');
    expect(jobStatusLabel('done')).toBe('concluído');
    expect(jobStatusLabel('failed')).toBe('falhou');
  });
});
