import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpClient, QueryParams } from '../../src/client/index.js';
import { getIssue, listIssues } from '../../src/client/issues.js';

/** Página do endpoint /issues.json como o Redmine devolve. */
interface IssuesPage {
  issues: Array<{ id: number }>;
  total_count: number;
  offset: number;
  limit: number;
}

/** Monta uma página de N issues começando em `offset`. */
function makePage(offset: number, count: number, totalCount: number, limit = 100): IssuesPage {
  const issues = Array.from({ length: count }, (_, i) => ({ id: offset + i + 1 }));
  return { issues, total_count: totalCount, offset, limit };
}

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

describe('getIssue', () => {
  // Caso esperado: usa o include completo e devolve o payload bruto (issue).
  it('busca a issue com include=journals,attachments,relations,children', async () => {
    get.mockResolvedValue({ issue: { id: 42, subject: 'Teste' } });
    const issue = await getIssue(makeHttp(get), 42);

    expect(get).toHaveBeenCalledWith('/issues/42.json', {
      include: 'journals,attachments,relations,children',
    });
    expect(issue).toEqual({ id: 42, subject: 'Teste' });
  });

  it('preserva o payload bruto sem normalizar (campos extras mantidos)', async () => {
    const raw = { id: 7, custom_fields: [{ id: 1, value: '' }], unknown_field: true };
    get.mockResolvedValue({ issue: raw });
    const issue = await getIssue(makeHttp(get), 7);
    expect(issue).toEqual(raw);
  });

  // Falha: resposta sem a chave `issue` é um contrato inesperado.
  it('lança erro quando a resposta não contém issue', async () => {
    get.mockResolvedValue({ nope: true });
    await expect(getIssue(makeHttp(get), 1)).rejects.toThrow(/issue/i);
  });
});

describe('listIssues: paginação', () => {
  // Caso esperado: uma única página esgota a coleção.
  it('retorna todos os itens de uma única página', async () => {
    get.mockResolvedValue(makePage(0, 3, 3));
    const items = await listIssues(makeHttp(get), {});

    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(callParams(get, 0)).toMatchObject({ offset: 0, limit: 100 });
  });

  // Caso esperado: várias páginas até esgotar total_count.
  it('acumula múltiplas páginas até esgotar total_count', async () => {
    get
      .mockResolvedValueOnce(makePage(0, 100, 250))
      .mockResolvedValueOnce(makePage(100, 100, 250))
      .mockResolvedValueOnce(makePage(200, 50, 250));

    const items = await listIssues(makeHttp(get), {});

    expect(items).toHaveLength(250);
    expect(get).toHaveBeenCalledTimes(3);
    expect(callParams(get, 1)).toMatchObject({ offset: 100, limit: 100 });
    expect(callParams(get, 2)).toMatchObject({ offset: 200, limit: 100 });
  });

  // Edge case: coleção vazia — uma chamada, zero itens, sem loop infinito.
  it('retorna array vazio quando não há issues', async () => {
    get.mockResolvedValue(makePage(0, 0, 0));
    const items = await listIssues(makeHttp(get), {});

    expect(items).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('repassa filtros de query em cada página', async () => {
    get.mockResolvedValue(makePage(0, 2, 2));
    await listIssues(makeHttp(get), { filters: { project_id: 5, status_id: 'open' } });

    expect(callParams(get, 0)).toMatchObject({ project_id: 5, status_id: 'open' });
  });
});

describe('listIssues: limites', () => {
  it('respeita o teto de 100 mesmo com pageSize maior', async () => {
    get.mockResolvedValue(makePage(0, 100, 100));
    await listIssues(makeHttp(get), { pageSize: 500 });
    expect(callParams(get, 0)).toMatchObject({ limit: 100 });
  });

  it('usa pageSize customizado abaixo do teto', async () => {
    get.mockResolvedValue(makePage(0, 10, 10, 10));
    await listIssues(makeHttp(get), { pageSize: 10 });
    expect(callParams(get, 0)).toMatchObject({ limit: 10 });
  });

  // Edge case: maxItems corta a acumulação e reduz o limit da última página.
  it('para ao atingir maxItems e não busca além do necessário', async () => {
    get
      .mockResolvedValueOnce(makePage(0, 100, 500))
      .mockResolvedValueOnce(makePage(100, 20, 500));

    const items = await listIssues(makeHttp(get), { maxItems: 120 });

    expect(items).toHaveLength(120);
    expect(get).toHaveBeenCalledTimes(2);
    expect(callParams(get, 1)).toMatchObject({ offset: 100, limit: 20 });
  });

  it('maxItems menor que uma página limita o limit da primeira chamada', async () => {
    get.mockResolvedValue(makePage(0, 5, 500));
    const items = await listIssues(makeHttp(get), { maxItems: 5 });

    expect(items).toHaveLength(5);
    expect(get).toHaveBeenCalledTimes(1);
    expect(callParams(get, 0)).toMatchObject({ offset: 0, limit: 5 });
  });

  // Failure: resposta sem o array `issues` é contrato inválido.
  it('lança erro quando a página não traz issues[]', async () => {
    get.mockResolvedValue({ total_count: 0 });
    await expect(listIssues(makeHttp(get), {})).rejects.toThrow(/issues/i);
  });
});
