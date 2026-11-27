/**
 * Helpers do E2E (#257): a issue mais nova vem da mesma consulta que o `last`
 * faz, não da lista de fixtures base — o seed pode criar outras issues depois.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createE2E } from '../../scripts/lib/e2e-shared.mjs';

let calls: string[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ issues: [{ id: 7 }, { id: 4 }, { id: 3 }] }), { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newestIssueIds', () => {
  it('lista pela mesma ordem do last --order created (sem filtro de projeto/status)', async () => {
    const { newestIssueIds } = createE2E({ log: vi.fn() });

    await expect(newestIssueIds(3)).resolves.toEqual([7, 4, 3]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/issues\.json\?sort=created_on:desc&limit=3$/);
  });

  it('status != 200: falha citando o status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 500 })));
    const { newestIssueIds } = createE2E({ log: vi.fn() });

    await expect(newestIssueIds(3)).rejects.toThrow(/status 500/);
  });
});
