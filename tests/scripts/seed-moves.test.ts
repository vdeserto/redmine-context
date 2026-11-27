/**
 * Trocas de categoria, versão e projeto do seed (#258).
 * Sem rede: `ensureProjectFixtures` devolve ids fixos e o `fetch` global vira um
 * Redmine de mentira que guarda uma issue e grava um journal (notes + details) a
 * cada PUT, com `old_value` null quando o campo estava vazio, como o Redmine real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedMoves } from '../../scripts/lib/seed-moves.mjs';

vi.mock('../../scripts/lib/seed-projects.mjs', () => ({
  ensureProjectFixtures: vi.fn(async () => ({
    'rc-fixtures': { id: 1, versions: { '[seed] v1.0': 11, '[seed] v2.0': 12 }, categories: { '[seed] Backend': 21, '[seed] Frontend': 22 } },
    'rc-fixtures-2': { id: 2, versions: { '[seed] P2 v1.0': 13, '[seed] P2 v2.0': 14 }, categories: { '[seed] P2 Infra': 23, '[seed] P2 Docs': 24 } },
  })),
}));

const BASE = 'http://localhost:3080';
const SUBJECT = '[seed] Trocas de projeto';
const SEARCH_PATH = `/issues.json?status_id=*&subject=~${encodeURIComponent(SUBJECT)}&limit=100`;

type Detail = { property: string; name: string; old_value: string | null; new_value: string | null };
type Journal = { id: number; notes: string; details: Detail[] };
type Attr = 'project' | 'category' | 'fixed_version';
type FakeIssue = {
  id: number;
  subject: string;
  project: { id: number };
  category?: { id: number };
  fixed_version?: { id: number };
  journals: Journal[];
};
type Init = { method?: string; body?: string };

const ATTR_OF: Record<string, Attr> = { project_id: 'project', category_id: 'category', fixed_version_id: 'fixed_version' };

let issue: FakeIssue | null;
let ignoreFields: Record<string, boolean>; // campos que o "Redmine" ignora no PUT
let failPutMarker: string; // PUT cuja nota começa com essa marca responde 500
let calls: string[];

/** Simula o Redmine para os caminhos que o módulo usa. */
async function fakeRedmine(url: string, init?: Init) {
  const path = url.slice(BASE.length);
  const method = init?.method ?? 'GET';
  calls.push(`${method} ${path}`);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

  if (method === 'GET' && path === SEARCH_PATH) {
    // O filtro `~` do Redmine é "contém": a cópia também volta e o cliente descarta.
    const copy = { id: 40, subject: `${SUBJECT} (cópia)` };
    return json(200, { issues: issue ? [copy, issue] : [copy] });
  }
  if (method === 'POST' && path === '/issues.json') {
    issue = { id: 41, subject: body.issue.subject, project: { id: body.issue.project_id === 'rc-fixtures' ? 1 : 0 }, journals: [] };
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
      if (field === 'notes' || ignoreFields[field]) {
        continue;
      }
      const attr = ATTR_OF[field];
      const old = issue[attr]?.id;
      details.push({ property: 'attr', name: field, old_value: old === undefined ? null : String(old), new_value: String(body.issue[field]) });
      issue[attr] = { id: body.issue[field] };
    }
    issue.journals.push({ id: issue.journals.length + 1, notes: body.issue.notes ?? '', details });
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 404 });
}

/** Details gravados no journal cuja nota começa com a marca. */
function detailsOf(marker: string) {
  return issue?.journals.find((journal) => journal.notes.startsWith(`${marker} `))?.details;
}

/** Detail de atributo no formato do Redmine. */
function attr(name: string, oldValue: string | null, newValue: string) {
  return { property: 'attr', name, old_value: oldValue, new_value: newValue };
}

beforeEach(() => {
  issue = null;
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

describe('seedMoves — gravação', () => {
  it('cria a issue no rc-fixtures e grava uma troca por journal marcado, terminando no rc-fixtures-2', async () => {
    await seedMoves();

    expect(issue?.subject).toBe(SUBJECT);
    expect(calls).toContain('POST /issues.json');
    expect(issue?.journals).toHaveLength(5);
    expect(detailsOf('[seed:category-1]')).toEqual([attr('category_id', null, '21')]);
    expect(detailsOf('[seed:category-2]')).toEqual([attr('category_id', '21', '22')]);
    expect(detailsOf('[seed:version-1]')).toEqual([attr('fixed_version_id', null, '11')]);
    expect(detailsOf('[seed:version-2]')).toEqual([attr('fixed_version_id', '11', '12')]);
    expect(detailsOf('[seed:move]')).toEqual([
      attr('project_id', '1', '2'),
      attr('category_id', '22', '23'),
      attr('fixed_version_id', '12', '13'),
    ]);
    expect(issue?.project.id).toBe(2);
  });

  it('re-execução (já movida): acha a issue no rc-fixtures-2 e não grava nada', async () => {
    await seedMoves();
    calls = [];

    await seedMoves();

    expect(issue?.journals).toHaveLength(5);
    expect(calls.filter((call) => !call.startsWith('GET '))).toEqual([]);
  });

  it('busca sem project_id, filtrando pelo subject exato', async () => {
    await seedMoves();

    expect(calls).toContain(`GET ${SEARCH_PATH}`);
    expect(calls.some((call) => call.startsWith('GET /issues/40.json'))).toBe(false);
  });

  it('GET da busca com status != 200: lança com o status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: Init) => {
      if (url === `${BASE}${SEARCH_PATH}`) {
        return new Response('erro', { status: 503 });
      }
      return fakeRedmine(url, init);
    }));

    await expect(seedMoves()).rejects.toThrow(/falhou: status 503/);
    expect(issue).toBeNull();
  });

  it('issue achada no rc-fixtures com só a [seed:move] pendente: só ela roda', async () => {
    failPutMarker = '[seed:move]';
    await expect(seedMoves()).rejects.toThrow(/status 500/);
    expect(issue?.project.id).toBe(1);
    failPutMarker = '';
    calls = [];

    await seedMoves();

    expect(calls.filter((call) => !call.startsWith('GET '))).toEqual(['PUT /issues/41.json']);
    expect(issue?.journals).toHaveLength(5);
    expect(issue?.journals[4]?.notes.startsWith('[seed:move] ')).toBe(true);
    expect(issue?.project.id).toBe(2);
  });

  it('POST da issue com status != 201: lança com o status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: Init) => {
      if (init?.method === 'POST') {
        return new Response('{"errors":["Subject inválido"]}', { status: 422 });
      }
      return fakeRedmine(url, init);
    }));

    await expect(seedMoves()).rejects.toThrow(/POST issue de trocas de projeto falhou: status 422/);
  });

  it('retoma após falha parcial: etapas gravadas não repetem', async () => {
    failPutMarker = '[seed:version-1]';
    await expect(seedMoves()).rejects.toThrow(/status 500/);
    expect(issue?.journals).toHaveLength(2);

    failPutMarker = '';
    await seedMoves();

    expect(issue?.journals).toHaveLength(5);
    expect(detailsOf('[seed:version-1]')).toEqual([attr('fixed_version_id', null, '11')]);
  });

  it('campo ignorado pelo Redmine: lança logo após o PUT, pedindo para apagar a issue', async () => {
    ignoreFields = { fixed_version_id: true };

    const run = seedMoves();

    await expect(run).rejects.toThrow(/\[seed:version-1\].*fixed_version_id/);
    await expect(run).rejects.toThrow(`apague a issue "${SUBJECT}"`);
    expect(issue?.journals).toHaveLength(3);
  });

  it('project_id ignorado na própria [seed:move]: lança pedindo para apagar a issue', async () => {
    ignoreFields = { project_id: true };

    const run = seedMoves();

    await expect(run).rejects.toThrow(/\[seed:move\].*project_id/);
    await expect(run).rejects.toThrow(`apague a issue "${SUBJECT}"`);
    expect(issue?.project.id).toBe(1);
  });
});

describe('seedMoves — asserção', () => {
  it('journal da etapa sem um dos details esperados: lança citando a etapa e o campo', async () => {
    await seedMoves();
    const move = issue?.journals[4];
    if (move) {
      move.details = move.details.slice(0, 2);
    }

    await expect(seedMoves()).rejects.toThrow(/ASSERT trocas de projeto: \[seed:move\].*fixed_version_id/);
  });

  it('vazio→valor com old_value preenchido: lança citando a etapa', async () => {
    await seedMoves();
    const detail = issue?.journals[0]?.details[0];
    if (detail) {
      detail.old_value = '99';
    }

    await expect(seedMoves()).rejects.toThrow(/\[seed:category-1\].*category_id/);
  });

  it('new_value diferente do esperado: lança citando a etapa', async () => {
    await seedMoves();
    const detail = issue?.journals[4]?.details[0];
    if (detail) {
      detail.new_value = '3';
    }

    await expect(seedMoves()).rejects.toThrow(/\[seed:move\].*project_id/);
  });

  it('journal da etapa duplicado: lança', async () => {
    await seedMoves();
    issue?.journals.push({ id: 99, notes: '[seed:category-2] de novo', details: [] });

    await expect(seedMoves()).rejects.toThrow(/\[seed:category-2\].*2/);
  });
});
