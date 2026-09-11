import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearEnumerationsCache,
  fetchEnumerations,
} from '../../src/client/enumerations.js';
import type { HttpClient } from '../../src/client/http.js';

/** HttpClient falso: devolve o corpo mapeado por path, ou lança. */
function fakeHttp(bodies: Record<string, unknown>): HttpClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get: vi.fn(async (path: string) => {
      calls.push(path);
      const body = bodies[path];
      if (body === undefined) throw new Error(`404 ${path}`);
      return body;
    }),
  } as unknown as HttpClient & { calls: string[] };
}

const FULL = {
  '/issue_statuses.json': { issue_statuses: [{ id: 12, name: 'Estimativa' }, { id: 7, name: 'Atribuída' }] },
  '/trackers.json': { trackers: [{ id: 2, name: 'Manutenção Evolutiva' }] },
  '/enumerations/issue_priorities.json': { issue_priorities: [{ id: 4, name: '04 Normal' }] },
};

afterEach(() => {
  clearEnumerationsCache();
  vi.restoreAllMocks();
});

describe('fetchEnumerations', () => {
  // Caso esperado: os três endpoints viram mapas id → nome.
  it('monta os mapas das três enumerações', async () => {
    const enums = await fetchEnumerations(fakeHttp(FULL), 'https://a.example');

    expect(enums.status.get(12)).toBe('Estimativa');
    expect(enums.tracker.get(2)).toBe('Manutenção Evolutiva');
    expect(enums.priority.get(4)).toBe('04 Normal');
  });

  // Degradação (ADR-005): um endpoint restrito não pode derrubar os outros —
  // é enriquecimento de leitura, não dado essencial.
  it('degrada por endpoint quando um falha', async () => {
    const parcial = { ...FULL };
    delete (parcial as Record<string, unknown>)['/trackers.json'];

    const enums = await fetchEnumerations(fakeHttp(parcial), 'https://b.example');

    expect(enums.status.size).toBe(2);
    expect(enums.tracker.size).toBe(0);
    expect(enums.priority.size).toBe(1);
  });

  // Failure case: instância que bloqueia tudo devolve mapas vazios, não erro.
  it('devolve mapas vazios quando todos falham', async () => {
    const enums = await fetchEnumerations(fakeHttp({}), 'https://c.example');

    expect(enums.status.size).toBe(0);
    expect(enums.tracker.size).toBe(0);
    expect(enums.priority.size).toBe(0);
  });

  // Edge case: linhas malformadas (sem id/name, tipo errado) são ignoradas em
  // vez de virarem entradas quebradas no mapa.
  it('ignora entradas malformadas', async () => {
    const http = fakeHttp({
      '/issue_statuses.json': {
        issue_statuses: [null, 42, { id: '7', name: 'x' }, { id: 9 }, { id: 3, name: '' }, { id: 5, name: 'Ok' }],
      },
    });

    const enums = await fetchEnumerations(http, 'https://d.example');

    expect([...enums.status.entries()]).toEqual([[5, 'Ok']]);
  });

  it('ignora corpo cuja coleção não é array', async () => {
    const enums = await fetchEnumerations(
      fakeHttp({ '/issue_statuses.json': { issue_statuses: 'nope' } }),
      'https://e.example',
    );
    expect(enums.status.size).toBe(0);
  });

  // Memoização: a TUI e o MCP são processos longos e não devem repetir estes
  // GETs a cada issue aberta.
  it('memoiza por instância', async () => {
    const http = fakeHttp(FULL);

    await fetchEnumerations(http, 'https://f.example');
    await fetchEnumerations(http, 'https://f.example');

    expect(http.calls).toHaveLength(3); // 3 endpoints, uma vez cada
  });

  it('instâncias diferentes não compartilham cache', async () => {
    const http = fakeHttp(FULL);

    await fetchEnumerations(http, 'https://g.example');
    await fetchEnumerations(http, 'https://h.example');

    expect(http.calls).toHaveLength(6);
  });

  it('clearEnumerationsCache força nova busca', async () => {
    const http = fakeHttp(FULL);

    await fetchEnumerations(http, 'https://i.example');
    clearEnumerationsCache();
    await fetchEnumerations(http, 'https://i.example');

    expect(http.calls).toHaveLength(6);
  });
});
