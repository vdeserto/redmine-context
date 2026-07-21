import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock parcial da camada client: preserva tipos/erros reais e mocka as funções
// de I/O (createHttpClient/listIssues/searchIssues) para testar a orquestração.
vi.mock('../src/client/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/index.js')>();
  return {
    ...actual,
    createHttpClient: vi.fn(() => ({ get: vi.fn() })),
    listIssues: vi.fn(),
    searchIssues: vi.fn(),
  };
});

import * as client from '../src/client/index.js';
import type { RedmineIssuePayload } from '../src/client/index.js';
import { fetchIssueSearch } from '../src/fetch-issue-search.js';

/** Monta um payload bruto de issue com os campos usados na lista compacta. */
function issue(id: number, subject: string, status = 'New', assignee?: string): RedmineIssuePayload {
  const payload: RedmineIssuePayload = { id, subject, status: { id: 1, name: status } };
  if (assignee !== undefined) payload.assigned_to = { id: 2, name: assignee };
  return payload;
}

/** Filtros/opções mínimos com credenciais fixas. */
const BASE = { baseUrl: 'https://redmine.example', apiKey: 'key' } as const;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('fetchIssueSearch: filtros estruturados', () => {
  // Caso esperado: sem query, lista /issues.json só com os filtros + maxItems.
  it('repassa os filtros corretamente ao listIssues e não chama searchIssues', async () => {
    vi.mocked(client.listIssues).mockResolvedValue([issue(1, 'Alpha', 'Open', 'Alice')]);

    const res = await fetchIssueSearch({
      ...BASE,
      filters: { project_id: 5, status_id: 'open', assigned_to_id: 'me', updated_on: '>=2026-01-01' },
      limit: 10,
    });

    expect(client.searchIssues).not.toHaveBeenCalled();
    expect(client.listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters: { project_id: 5, status_id: 'open', assigned_to_id: 'me', updated_on: '>=2026-01-01' },
        maxItems: 10,
      }),
    );
    expect(res.degraded).toBe(false);
    expect(res.count).toBe(1);
    // Lista compacta: id + status + responsável fora da fence, assunto dentro.
    expect(res.content).toContain('**#1**');
    expect(res.content).toContain('status: Open');
    expect(res.content).toContain('responsável: Alice');
    expect(res.content).toContain('<untrusted-content>Alpha</untrusted-content>');
  });

  // Edge case: limite default documentado (25) quando `limit` é omitido.
  it('usa o limite default 25 quando limit não é informado', async () => {
    vi.mocked(client.listIssues).mockResolvedValue([]);
    await fetchIssueSearch({ ...BASE, filters: {} });
    expect(client.listIssues).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxItems: 25 }));
  });
});

describe('fetchIssueSearch: full-text best-effort', () => {
  // Caso esperado: query ok → /search fornece os ids; /issues.json restringe por issue_id.
  it('com /search ok: passa a query e restringe listIssues por issue_id (interseção)', async () => {
    vi.mocked(client.searchIssues).mockResolvedValue({
      hits: [
        { id: 7, title: 't7', type: 'issue', url: 'u7' },
        { id: 9, title: 't9', type: 'issue', url: 'u9' },
      ],
      totalCount: 2,
    });
    vi.mocked(client.listIssues).mockResolvedValue([issue(7, 'Sete'), issue(9, 'Nove')]);

    const res = await fetchIssueSearch({ ...BASE, filters: { project_id: 3 }, query: '  timeout  ', limit: 25 });

    expect(client.searchIssues).toHaveBeenCalledWith(expect.anything(), { query: 'timeout', limit: 25 });
    expect(client.listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filters: { project_id: 3, issue_id: '7,9' }, maxItems: 25 }),
    );
    expect(res.degraded).toBe(false);
    expect(res.count).toBe(2);
    expect(res.content).toContain('Consulta:');
  });

  // Failure/degradação: /search falha → cai nos filtros estruturados + aviso no payload.
  it('com /search falhando: degrada para os filtros e adiciona aviso no payload', async () => {
    vi.mocked(client.searchIssues).mockRejectedValue(new Error('404 not found'));
    vi.mocked(client.listIssues).mockResolvedValue([issue(1, 'Alpha')]);

    const res = await fetchIssueSearch({ ...BASE, filters: { project_id: 5 }, query: 'x', limit: 25 });

    expect(res.degraded).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/full-text indispon/i);
    expect(res.content).toContain('Aviso:');
    // Degradação: listIssues chamado só com os filtros (sem issue_id).
    expect(client.listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filters: { project_id: 5 }, maxItems: 25 }),
    );
  });

  // Edge case: /search sem acertos → nenhuma listagem, resultado vazio.
  it('com /search sem acertos: não lista e retorna zero resultados', async () => {
    vi.mocked(client.searchIssues).mockResolvedValue({ hits: [], totalCount: 0 });

    const res = await fetchIssueSearch({ ...BASE, filters: {}, query: 'nada' });

    expect(client.listIssues).not.toHaveBeenCalled();
    expect(res.count).toBe(0);
    expect(res.content).toContain('_(nenhum resultado)_');
  });

  // Edge case: responsável ausente vira placeholder estrutural.
  it('renderiza responsável ausente como (nenhum)', async () => {
    vi.mocked(client.listIssues).mockResolvedValue([issue(1, 'Alpha', 'New')]);
    const res = await fetchIssueSearch({ ...BASE, filters: {}, limit: 5 });
    expect(res.content).toContain('responsável: (nenhum)');
  });
});
