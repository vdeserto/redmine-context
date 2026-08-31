import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock parcial da camada client: preserva tipos/erros reais e mocka o I/O
// (createHttpClient/listIssues/getIssue). O bundle roda de verdade — o que se
// testa aqui é a orquestração ordem → sort → bundles.
vi.mock('../src/client/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/index.js')>();
  return {
    ...actual,
    createHttpClient: vi.fn(() => ({ get: vi.fn() })),
    listIssues: vi.fn(),
    getIssue: vi.fn(),
  };
});

import * as client from '../src/client/index.js';
import type { RedmineIssuePayload } from '../src/client/index.js';
import type { CoreEvent } from '../src/contract.js';
import {
  fetchLastIssues,
  LAST_MAX_COUNT,
  type LastIssuesResult,
} from '../src/fetch-last-issues.js';

/** Payload de issue suficiente para exercitar normalize + bundle. */
function issuePayload(id: number): RedmineIssuePayload {
  return {
    id,
    subject: `Assunto ${id}`,
    description: `Corpo da issue ${id}`,
    project: { id: 1, name: 'Projeto' },
    tracker: { id: 2, name: 'Bug' },
    status: { id: 3, name: 'New' },
    priority: { id: 4, name: 'Normal' },
    author: { id: 5, name: 'Alice' },
    created_on: '2024-01-01T00:00:00Z',
    updated_on: '2024-01-02T00:00:00Z',
    journals: [],
    attachments: [],
    relations: [],
    children: [],
  };
}

const BASE = {
  baseUrl: 'https://redmine.example',
  apiKey: 'secret-key',
  toolVersion: '0.1.0',
} as const;

/** Drena o iterable coletando o resultado final. */
async function drain(
  iterable: AsyncIterable<CoreEvent<LastIssuesResult>>,
): Promise<LastIssuesResult | undefined> {
  let result: LastIssuesResult | undefined;
  for await (const event of iterable) {
    if (event.kind === 'result') result = event.value;
  }
  return result;
}

/** Programa `listIssues`/`getIssue` para devolver os ids informados. */
function seedIssues(ids: number[]): void {
  vi.mocked(client.listIssues).mockResolvedValue(ids.map(issuePayload));
  vi.mocked(client.getIssue).mockImplementation(async (_http, id) => issuePayload(id));
}

/** Extrai o `sort` repassado ao `listIssues` na última chamada. */
function sortArg(): unknown {
  const call = vi.mocked(client.listIssues).mock.calls[0];
  return (call?.[1] as { filters?: { sort?: unknown } } | undefined)?.filters?.sort;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('fetchLastIssues: ordem', () => {
  // Caso esperado: sem `order`, aplica o default documentado (updated).
  it('usa sort=updated_on:desc por default', async () => {
    seedIssues([7]);
    const result = await drain(fetchLastIssues({ ...BASE, format: 'md' }));
    expect(sortArg()).toBe('updated_on:desc');
    expect(result?.order).toBe('updated');
  });

  it('order=created usa sort=created_on:desc', async () => {
    seedIssues([7]);
    await drain(fetchLastIssues({ ...BASE, format: 'md', order: 'created' }));
    expect(sortArg()).toBe('created_on:desc');
  });

  // Prioridade desempata pela mais recente — senão a ordem entre issues de mesma
  // prioridade fica a critério do banco, e "last" deixaria de ser determinístico.
  it('order=priority desempata por updated_on', async () => {
    seedIssues([7]);
    await drain(fetchLastIssues({ ...BASE, format: 'md', order: 'priority' }));
    expect(sortArg()).toBe('priority:desc,updated_on:desc');
  });
});

describe('fetchLastIssues: count', () => {
  // Caso esperado: default 1 — "a última issue".
  it('pede uma única issue por default', async () => {
    seedIssues([7]);
    await drain(fetchLastIssues({ ...BASE, format: 'md' }));
    expect(client.listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxItems: 1, pageSize: 1 }),
    );
  });

  // Edge case: valores acima do teto são reduzidos, não recusados — o teto
  // existe porque cada item é um bundle completo (caro em tokens/latência).
  it('reduz count acima do teto para LAST_MAX_COUNT', async () => {
    seedIssues([1]);
    await drain(fetchLastIssues({ ...BASE, format: 'md', count: 99 }));
    expect(client.listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxItems: LAST_MAX_COUNT }),
    );
  });

  // Edge case: 0/negativo/fracionário não podem virar uma listagem vazia.
  it.each([0, -3, 0.5])('eleva count inválido (%s) para 1', async (count) => {
    seedIssues([1]);
    await drain(fetchLastIssues({ ...BASE, format: 'md', count }));
    expect(client.listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxItems: 1 }),
    );
  });
});

describe('fetchLastIssues: saída', () => {
  // Caso esperado: um bundle Markdown completo, não uma lista compacta.
  it('devolve o bundle completo da issue em markdown', async () => {
    seedIssues([42]);
    const result = await drain(fetchLastIssues({ ...BASE, format: 'md' }));
    expect(result?.issueIds).toEqual([42]);
    expect(result?.content).toContain('# Issue #42');
    expect(result?.content).toContain('## Histórico');
  });

  // Vários bundles precisam de fronteira visível para o leitor (humano ou LLM).
  it('separa múltiplos bundles markdown por ---', async () => {
    seedIssues([1, 2]);
    const result = await drain(fetchLastIssues({ ...BASE, format: 'md', count: 2 }));
    expect(result?.issueIds).toEqual([1, 2]);
    expect(result?.content).toContain('\n\n---\n\n');
    expect(result?.content).toContain('# Issue #1');
    expect(result?.content).toContain('# Issue #2');
  });

  // Contrato do formato json: SEMPRE array — `get_last` devolve uma coleção.
  it('emite um array JSON válido, mesmo com uma única issue', async () => {
    seedIssues([42]);
    const result = await drain(fetchLastIssues({ ...BASE, format: 'json' }));
    const parsed: unknown = JSON.parse(result?.content ?? '');
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it('emite um array JSON válido com múltiplas issues', async () => {
    seedIssues([1, 2]);
    const result = await drain(fetchLastIssues({ ...BASE, format: 'json', count: 2 }));
    const parsed: unknown = JSON.parse(result?.content ?? '');
    expect(parsed).toHaveLength(2);
  });
});

describe('fetchLastIssues: falhas (RULES #25 — failure case)', () => {
  // A superfície mapeia erro→exit code/isError pelo TIPO; engolir aqui quebraria
  // esse contrato e devolveria um bundle vazio como se fosse sucesso.
  it('propaga erro da listagem sem emitir resultado', async () => {
    vi.mocked(client.listIssues).mockRejectedValue(new Error('falha de rede'));

    await expect(drain(fetchLastIssues({ ...BASE, format: 'md' }))).rejects.toThrow('falha de rede');
    expect(client.getIssue).not.toHaveBeenCalled();
  });

  // Falha no meio do empacotamento (ex.: 404 numa issue que sumiu entre a
  // listagem e o get) também precisa subir, não render um bundle parcial.
  it('propaga erro do empacotamento de uma issue', async () => {
    vi.mocked(client.listIssues).mockResolvedValue([issuePayload(1), issuePayload(2)]);
    vi.mocked(client.getIssue).mockRejectedValue(new Error('404'));

    await expect(
      drain(fetchLastIssues({ ...BASE, format: 'md', count: 2 })),
    ).rejects.toThrow('404');
  });
});

describe('fetchLastIssues: instância sem issues', () => {
  // Edge case: instância vazia não é erro — devolve conteúdo legível e nenhum id.
  it('markdown: devolve um aviso legível e nenhum id', async () => {
    seedIssues([]);
    const result = await drain(fetchLastIssues({ ...BASE, format: 'md' }));
    expect(result?.issueIds).toEqual([]);
    expect(result?.content).toBe('_(nenhuma issue encontrada)_');
    expect(client.getIssue).not.toHaveBeenCalled();
  });

  it('json: devolve um array vazio válido', async () => {
    seedIssues([]);
    const result = await drain(fetchLastIssues({ ...BASE, format: 'json' }));
    expect(JSON.parse(result?.content ?? '')).toEqual([]);
  });
});
