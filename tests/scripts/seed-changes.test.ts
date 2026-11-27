/**
 * Trocas de status, tracker e prioridade do seed (#257).
 * Sem rede: o `fetch` global vira um Redmine de mentira que guarda uma issue e
 * grava um journal (notes + details) a cada PUT, como o Redmine real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertStateChanges, ensureStateChanges } from '../../scripts/lib/seed-changes.mjs';

const BASE = 'http://localhost:3080';
const SUBJECT = '[seed] Trocas de estado';
const ISSUES_PATH = `/issues.json?project_id=rc-fixtures&status_id=*&subject=~${encodeURIComponent(SUBJECT)}`;

type Detail = { property: string; name: string; old_value: string | null; new_value: string | null };
type Journal = { id: number; notes: string; details: Detail[] };
type Attr = 'status' | 'tracker' | 'priority';
type FakeIssue = {
  id: number;
  subject: string;
  status: { id: number };
  tracker: { id: number };
  priority: { id: number };
  journals: Journal[];
};
type Init = { method?: string; body?: string };

let issue: FakeIssue | null;
let initialStatusId: number; // status da issue recém-criada
let ignoreFields: Record<string, boolean>; // campos que o "workflow" ignora no PUT
let failPutMarker: string; // PUT cuja nota começa com essa marca responde 500
let calls: string[];

/** Simula o Redmine para os caminhos que o módulo usa. */
async function fakeRedmine(url: string, init?: Init) {
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
  if (method === 'GET' && path === ISSUES_PATH) {
    // O filtro `~` do Redmine é "contém": a cópia também volta e o cliente descarta.
    const copy = { id: 40, subject: `${SUBJECT} (cópia)` };
    return json(200, { issues: issue ? [copy, issue] : [copy] });
  }
  if (method === 'POST' && path === '/issues.json') {
    issue = {
      id: 41,
      subject: body.issue.subject,
      status: { id: initialStatusId },
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
    if (failPutMarker && (body.issue.notes ?? '').startsWith(failPutMarker)) {
      return new Response('erro', { status: 500 });
    }
    const details: Detail[] = [];
    for (const field in body.issue) {
      const attr = field.slice(0, -'_id'.length) as Attr;
      if (field === 'notes' || ignoreFields[field]) {
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

/** Troca a resposta de um caminho; o resto continua no Redmine de mentira. */
function overridePath(pathSuffix: string, response: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: Init) => {
    if (url.endsWith(pathSuffix) && (init?.method ?? 'GET') === 'GET') {
      return response();
    }
    return fakeRedmine(url, init);
  }));
}

/** Detalhe gravado no journal cuja nota começa com a marca. */
function detailOf(marker: string) {
  return issue?.journals.find((journal) => journal.notes.startsWith(`${marker} `))?.details;
}

beforeEach(() => {
  issue = null;
  initialStatusId = 1;
  ignoreFields = {};
  failPutMarker = '';
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

  it('busca a issue filtrando pelo subject no servidor e compara o subject exato', async () => {
    await ensureStateChanges('rc-fixtures');

    expect(calls).toContain(`GET ${ISSUES_PATH}`);
    expect(calls.some((call) => call.startsWith('GET /issues/40.json'))).toBe(false);
    expect(issue?.id).toBe(41);
  });

  it('status atual fora das opções (ex.: fechado): troca para o primeiro da lista', async () => {
    initialStatusId = 5;

    await ensureStateChanges('rc-fixtures');

    expect(detailOf('[seed:status-1]')).toEqual([{ property: 'attr', name: 'status_id', old_value: '5', new_value: '1' }]);
    expect(detailOf('[seed:status-2]')).toEqual([{ property: 'attr', name: 'status_id', old_value: '1', new_value: '2' }]);
  });

  it.each([
    ['status_id', '/issue_statuses.json', { issue_statuses: [{ id: 1, is_closed: false }, { id: 5, is_closed: true }] }],
    ['tracker_id', '/projects/rc-fixtures.json?include=trackers', { project: { trackers: [{ id: 1 }] } }],
    ['priority_id', '/enumerations/issue_priorities.json', { issue_priorities: [{ id: 1, active: true }, { id: 2, active: false }] }],
  ])('%s com menos de 2 opções: lança antes de gravar', async (field, path, data) => {
    overridePath(path, () => new Response(JSON.stringify(data), { status: 200 }));

    await expect(ensureStateChanges('rc-fixtures')).rejects.toThrow(field);
    expect(issue).toBeNull();
  });

  it('GET de enumeração com status != 200: lança com o caminho e o status', async () => {
    overridePath('/issue_statuses.json', () => new Response('erro', { status: 500 }));

    await expect(ensureStateChanges('rc-fixtures')).rejects.toThrow(/GET \/issue_statuses\.json falhou: status 500/);
    expect(issue).toBeNull();
  });

  it('POST da issue com status != 201: lança com o status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: Init) => {
      if (init?.method === 'POST') {
        return new Response('{"errors":["Subject inválido"]}', { status: 422 });
      }
      return fakeRedmine(url, init);
    }));

    await expect(ensureStateChanges('rc-fixtures')).rejects.toThrow(/POST issue de trocas falhou: status 422/);
  });

  it('retoma após falha parcial: etapa 1 gravada não repete, as pendentes seguem do estado atual', async () => {
    failPutMarker = '[seed:status-2]';
    await expect(ensureStateChanges('rc-fixtures')).rejects.toThrow(/status 500/);
    expect(issue?.journals).toHaveLength(1);

    failPutMarker = '';
    await ensureStateChanges('rc-fixtures');

    expect(issue?.journals).toHaveLength(4);
    expect(detailOf('[seed:status-1]')).toEqual([{ property: 'attr', name: 'status_id', old_value: '1', new_value: '2' }]);
    expect(detailOf('[seed:status-2]')).toEqual([{ property: 'attr', name: 'status_id', old_value: '2', new_value: '3' }]);
  });

  it('troca ignorada pelo workflow: lança logo após o PUT, pedindo para apagar a issue', async () => {
    ignoreFields = { status_id: true };

    const run = ensureStateChanges('rc-fixtures');

    await expect(run).rejects.toThrow(/\[seed:status-1\].*status_id/);
    await expect(run).rejects.toThrow(`apague a issue "${SUBJECT}"`);
    expect(issue?.journals).toHaveLength(1);
  });
});

describe('assertStateChanges', () => {
  it('passa quando cada etapa tem seu journal com a troca gravada', async () => {
    await ensureStateChanges('rc-fixtures');

    await expect(assertStateChanges('rc-fixtures')).resolves.toBeUndefined();
  });

  it('journal da etapa sem detail (só nota): lança citando a etapa', async () => {
    await ensureStateChanges('rc-fixtures');
    const journal = issue?.journals[0];
    if (journal) {
      journal.details = [];
    }

    await expect(assertStateChanges('rc-fixtures')).rejects.toThrow(/\[seed:status-1\].*status_id/);
  });

  it('detail com old_value vazio: lança citando a etapa', async () => {
    await ensureStateChanges('rc-fixtures');
    const detail = issue?.journals[2]?.details[0];
    if (detail) {
      detail.old_value = null;
    }

    await expect(assertStateChanges('rc-fixtures')).rejects.toThrow(/\[seed:tracker\].*tracker_id/);
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
