/**
 * Trocas de status, tracker e prioridade do seed (#257).
 * Sem rede: o `fetch` global vira um Redmine de mentira que guarda uma issue e
 * grava um journal (notes + details) a cada PUT, como o Redmine real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertStateChanges, ensureStateChanges } from '../../scripts/lib/seed-changes.mjs';

const BASE = 'http://localhost:3080';
const SUBJECT = '[seed] Trocas de estado';

type Detail = { property: string; name: string; old_value: string | null; new_value: string | null };
type Journal = { id: number; notes: string; details: Detail[] };
type FakeIssue = {
  id: number;
  subject: string;
  status: { id: number };
  tracker: { id: number };
  priority: { id: number };
  journals: Journal[];
};

/** Atributo da issue (`status`) que o campo do PUT (`status_id`) altera. */
const ATTR_BY_FIELD: Record<string, 'status' | 'tracker' | 'priority'> = {
  status_id: 'status',
  tracker_id: 'tracker',
  priority_id: 'priority',
};

let issue: FakeIssue | null;
let ignoreFields: Record<string, boolean>; // campos que o "workflow" ignora no PUT
let calls: string[];

/** Simula o Redmine para os caminhos que o módulo usa. */
async function fakeRedmine(url: string, init?: { method?: string; body?: string }) {
  const path = url.slice(BASE.length);
  const method = init?.method ?? 'GET';
  calls.push(`${method} ${path}`);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

  if (method === 'GET' && path === '/issue_statuses.json') {
    return json(200, {
      issue_statuses: [
        { id: 1, name: 'New', is_closed: false },
        { id: 5, name: 'Closed', is_closed: true },
        { id: 2, name: 'In Progress', is_closed: false },
        { id: 3, name: 'Resolved', is_closed: false },
      ],
    });
  }
  if (method === 'GET' && path === '/projects/rc-fixtures.json?include=trackers') {
    return json(200, { project: { id: 1, trackers: [{ id: 1 }, { id: 2 }] } });
  }
  if (method === 'GET' && path === '/enumerations/issue_priorities.json') {
    return json(200, {
      issue_priorities: [
        { id: 1, active: true },
        { id: 2, active: true },
        { id: 9, active: false },
        { id: 3, active: true },
      ],
    });
  }
  if (method === 'GET' && path.startsWith('/issues.json?project_id=rc-fixtures')) {
    return json(200, { issues: issue ? [{ id: 40, subject: 'RC Fixture: issue base 1' }, issue] : [] });
  }
  if (method === 'POST' && path === '/issues.json') {
    issue = {
      id: 41,
      subject: body.issue.subject,
      status: { id: 1 },
      tracker: { id: 1 },
      priority: { id: 2 },
      journals: [],
    };
    return json(201, { issue });
  }
  if (issue && path.startsWith(`/issues/${issue.id}.json`)) {
    if (method === 'GET') {
      return json(200, { issue });
    }
    const details: Detail[] = [];
    for (const field in body.issue) {
      const attr = ATTR_BY_FIELD[field];
      if (attr === undefined || ignoreFields[field]) {
        continue;
      }
      details.push({
        property: 'attr',
        name: field,
        old_value: String(issue[attr].id),
        new_value: String(body.issue[field]),
      });
      issue[attr] = { id: body.issue[field] };
    }
    issue.journals.push({ id: issue.journals.length + 1, notes: body.issue.notes ?? '', details });
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 404 });
}

/** Detalhe gravado no journal cuja nota começa com a marca. */
function detailOf(marker: string) {
  return issue?.journals.find((journal) => journal.notes.startsWith(`${marker} `))?.details;
}

beforeEach(() => {
  issue = null;
  ignoreFields = {};
  calls = [];
  vi.stubGlobal('fetch', vi.fn(fakeRedmine));
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ensureStateChanges', () => {
  it('cria a issue e grava uma troca por journal marcado, com ids descobertos', async () => {
    await ensureStateChanges('rc-fixtures');

    expect(issue?.subject).toBe(SUBJECT);
    expect(issue?.journals).toHaveLength(4);
    // status pula o fechado (5); prioridade pula a inativa (9)
    expect(detailOf('[seed:status-1]')).toEqual([{ property: 'attr', name: 'status_id', old_value: '1', new_value: '2' }]);
    expect(detailOf('[seed:status-2]')).toEqual([{ property: 'attr', name: 'status_id', old_value: '2', new_value: '3' }]);
    expect(detailOf('[seed:tracker]')).toEqual([{ property: 'attr', name: 'tracker_id', old_value: '1', new_value: '2' }]);
    expect(detailOf('[seed:priority]')).toEqual([{ property: 'attr', name: 'priority_id', old_value: '2', new_value: '3' }]);
  });

  it('re-execução não cria issue nem journal novo', async () => {
    await ensureStateChanges('rc-fixtures');
    calls = [];

    await ensureStateChanges('rc-fixtures');

    expect(issue?.journals).toHaveLength(4);
    expect(calls.filter((call) => !call.startsWith('GET '))).toEqual([]);
  });

  it('enumeração com menos de 2 opções: lança antes de gravar', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url.endsWith('/projects/rc-fixtures.json?include=trackers')) {
        return new Response(JSON.stringify({ project: { trackers: [{ id: 1 }] } }), { status: 200 });
      }
      return fakeRedmine(url, init);
    }));

    await expect(ensureStateChanges('rc-fixtures')).rejects.toThrow(/tracker_id/);
    expect(issue?.journals ?? []).toEqual([]);
  });
});

describe('assertStateChanges', () => {
  it('passa quando cada etapa tem seu journal com a troca gravada', async () => {
    await ensureStateChanges('rc-fixtures');

    await expect(assertStateChanges('rc-fixtures')).resolves.toBeUndefined();
  });

  it('troca ignorada pelo workflow (journal só com nota): lança citando a etapa', async () => {
    ignoreFields = { status_id: true };
    await ensureStateChanges('rc-fixtures');

    await expect(assertStateChanges('rc-fixtures')).rejects.toThrow(/\[seed:status-1\].*status_id/);
  });

  it('journal da etapa duplicado: lança', async () => {
    await ensureStateChanges('rc-fixtures');
    issue?.journals.push({ id: 99, notes: '[seed:tracker] de novo', details: [] });

    await expect(assertStateChanges('rc-fixtures')).rejects.toThrow(/\[seed:tracker\].*2/);
  });

  it('issue ausente: lança', async () => {
    await expect(assertStateChanges('rc-fixtures')).rejects.toThrow(SUBJECT);
  });
});
