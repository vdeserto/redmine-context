import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpClient, QueryParams } from '../../src/client/index.js';
import { searchIssues } from '../../src/client/search.js';

/** HttpClient fake cujo `get` é um mock inspecionável. */
function makeHttp(get: ReturnType<typeof vi.fn>): HttpClient {
  return { get } as unknown as HttpClient;
}

/** Extrai os params passados na n-ésima chamada de `get`. */
function callParams(get: ReturnType<typeof vi.fn>, index: number): QueryParams {
  return (get.mock.calls[index]?.[1] ?? {}) as QueryParams;
}

let get: ReturnType<typeof vi.fn>;

beforeEach(() => {
  get = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('searchIssues (/search.json)', () => {
  // Caso esperado: envia q/issues/limit/offset e devolve só acertos de issue.
  it('consulta /search.json com q e issues=1, retornando acertos de issue', async () => {
    get.mockResolvedValue({
      results: [
        { id: 10, title: 'Bug #10: falha', type: 'issue', url: 'u10' },
        { id: 11, title: 'Bug #11: fechado', type: 'issue-closed', url: 'u11' },
        { id: 99, title: 'Página wiki', type: 'wiki-page', url: 'w99' },
      ],
      total_count: 3,
    });

    const page = await searchIssues(makeHttp(get), { query: 'falha', limit: 25 });

    expect(get).toHaveBeenCalledWith('/search.json', expect.objectContaining({ q: 'falha', issues: 1 }));
    expect(callParams(get, 0)).toMatchObject({ limit: 25, offset: 0 });
    // wiki-page é descartado; issue e issue-closed permanecem.
    expect(page.hits.map((h) => h.id)).toEqual([10, 11]);
    expect(page.totalCount).toBe(3);
  });

  // Edge case: teto de 100 aplicado a limit acima do máximo, offset customizado.
  it('reduz o limit ao teto de 100 e respeita offset', async () => {
    get.mockResolvedValue({ results: [], total_count: 0 });
    await searchIssues(makeHttp(get), { query: 'x', limit: 500, offset: 40 });
    expect(callParams(get, 0)).toMatchObject({ limit: 100, offset: 40 });
  });

  // Edge case: sem total_count usa o tamanho da página; entradas inválidas caem.
  it('ignora entradas sem id numérico e infere total ausente', async () => {
    get.mockResolvedValue({ results: [{ title: 'sem id', type: 'issue' }, { id: 7, type: 'issue' }] });
    const page = await searchIssues(makeHttp(get), { query: 'x' });
    expect(page.hits.map((h) => h.id)).toEqual([7]);
    expect(page.totalCount).toBe(1);
  });

  // Failure: resposta sem o array results é contrato inválido.
  it('lança erro quando a resposta não traz results[]', async () => {
    get.mockResolvedValue({ total_count: 0 });
    await expect(searchIssues(makeHttp(get), { query: 'x' })).rejects.toThrow(/results/i);
  });
});
