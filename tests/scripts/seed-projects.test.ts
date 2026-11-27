/**
 * 2º projeto, versões e categorias do seed (#256). Sem rede: o `fetch` global
 * é trocado por um dublê que responde por "MÉTODO caminho" e guarda os POSTs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_FIXTURES, assertProjectFixtures, ensureProjectFixtures } from '../../scripts/lib/seed-projects.mjs';

const BASE = 'http://localhost:3080';

/** Respostas do dublê por "MÉTODO caminho"; o que não estiver aqui vira 404. */
let responses: Record<string, { status: number; body: unknown }>;
/** POSTs recebidos: caminho → corpo enviado. */
let posts: Record<string, unknown[]>;

beforeEach(() => {
  responses = {};
  posts = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method: string; body?: string }) => {
    const path = url.slice(BASE.length);
    if (init.method === 'POST') {
      posts[path] ??= [];
      posts[path].push(JSON.parse(init.body ?? 'null'));
    }
    const response = responses[`${init.method} ${path}`] ?? { status: 404, body: '' };
    return new Response(JSON.stringify(response.body), { status: response.status });
  }));
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PROJECTS_PAGE = 'GET /projects.json?limit=100&offset=0';

/** Redmine em que os dois projetos e todas as versões/categorias do seed já existem. */
function seededRedmine() {
  responses[PROJECTS_PAGE] = {
    status: 200,
    body: { projects: [{ id: 1, identifier: 'rc-fixtures' }, { id: 2, identifier: 'rc-fixtures-2' }], total_count: 2 },
  };
  let nextId = 10;
  const projectIds = { 'rc-fixtures': 1, 'rc-fixtures-2': 2 };
  for (const identifier in PROJECT_FIXTURES) {
    const fixtures = PROJECT_FIXTURES[identifier as keyof typeof PROJECT_FIXTURES];
    const project = { id: projectIds[identifier as keyof typeof projectIds], name: fixtures.name };
    const versions = [];
    for (const name of fixtures.versions) {
      versions.push({ id: nextId++, name, project });
    }
    const categories = [];
    for (const name of fixtures.categories) {
      categories.push({ id: nextId++, name, project });
    }
    responses[`GET /projects/${identifier}.json`] = { status: 200, body: { project: { id: project.id, identifier } } };
    responses[`GET /projects/${identifier}/versions.json`] = { status: 200, body: { versions } };
    responses[`GET /projects/${identifier}/issue_categories.json`] = { status: 200, body: { issue_categories: categories } };
  }
  responses['GET /projects/rc-fixtures-2.json?include=trackers'] = {
    status: 200,
    body: { project: { id: 2, trackers: [{ id: 1, name: 'Bug' }, { id: 2, name: 'Feature' }] } },
  };
}

describe('PROJECT_FIXTURES', () => {
  it('cada projeto tem >= 2 versões e >= 2 categorias, com nomes marcados e sem repetir entre projetos', () => {
    const seen: Record<string, boolean> = {};
    for (const identifier in PROJECT_FIXTURES) {
      const fixtures = PROJECT_FIXTURES[identifier as keyof typeof PROJECT_FIXTURES];
      expect(fixtures.versions.length).toBeGreaterThanOrEqual(2);
      expect(fixtures.categories.length).toBeGreaterThanOrEqual(2);
      for (const name of [...fixtures.versions, ...fixtures.categories]) {
        expect(name.startsWith('[seed] ')).toBe(true);
        expect(seen[name]).toBeUndefined();
        seen[name] = true;
      }
    }
    expect(Object.keys(PROJECT_FIXTURES)).toEqual(['rc-fixtures', 'rc-fixtures-2']);
  });
});

describe('ensureProjectFixtures', () => {
  it('Redmine vazio: cria o 2º projeto com os trackers existentes e 2 versões + 2 categorias em cada projeto', async () => {
    responses[PROJECTS_PAGE] = { status: 200, body: { projects: [{ id: 1, identifier: 'rc-fixtures' }], total_count: 1 } };
    responses['GET /trackers.json'] = { status: 200, body: { trackers: [{ id: 1 }, { id: 2 }, { id: 3 }] } };
    responses['POST /projects.json'] = { status: 201, body: { project: { id: 2, identifier: 'rc-fixtures-2' } } };
    for (const identifier in PROJECT_FIXTURES) {
      responses[`GET /projects/${identifier}/versions.json`] = { status: 200, body: { versions: [] } };
      responses[`GET /projects/${identifier}/issue_categories.json`] = { status: 200, body: { issue_categories: [] } };
      responses[`POST /projects/${identifier}/versions.json`] = { status: 201, body: { version: { id: 50 } } };
      responses[`POST /projects/${identifier}/issue_categories.json`] = { status: 201, body: { issue_category: { id: 60 } } };
    }

    const result = await ensureProjectFixtures();

    expect(posts['/projects.json']).toEqual([
      { project: expect.objectContaining({ identifier: 'rc-fixtures-2', tracker_ids: [1, 2, 3] }) },
    ]);
    for (const identifier in PROJECT_FIXTURES) {
      const fixtures = PROJECT_FIXTURES[identifier as keyof typeof PROJECT_FIXTURES];
      expect(posts[`/projects/${identifier}/versions.json`]).toEqual(fixtures.versions.map((name) => ({ version: { name } })));
      expect(posts[`/projects/${identifier}/issue_categories.json`]).toEqual(
        fixtures.categories.map((name) => ({ issue_category: { name } })),
      );
    }
    expect(result['rc-fixtures-2'].id).toBe(2);
    expect(result['rc-fixtures'].id).toBe(1);
    expect(result['rc-fixtures-2'].versions[PROJECT_FIXTURES['rc-fixtures-2'].versions[0]]).toBe(50);
    expect(result['rc-fixtures'].categories[PROJECT_FIXTURES['rc-fixtures'].categories[1]]).toBe(60);
  });

  it('tudo já existe: nenhum POST e devolve os ids existentes', async () => {
    seededRedmine();

    const result = await ensureProjectFixtures();

    expect(posts).toEqual({});
    expect(result['rc-fixtures'].id).toBe(1);
    expect(result['rc-fixtures-2'].id).toBe(2);
    expect(result['rc-fixtures'].versions[PROJECT_FIXTURES['rc-fixtures'].versions[0]]).toBe(10);
  });

  it('rc-fixtures existente não conta como rc-fixtures-2 (marca sem colisão de prefixo)', async () => {
    seededRedmine();
    responses[PROJECTS_PAGE] = { status: 200, body: { projects: [{ id: 1, identifier: 'rc-fixtures' }], total_count: 1 } };
    responses['GET /trackers.json'] = { status: 200, body: { trackers: [{ id: 1 }] } };
    responses['POST /projects.json'] = { status: 201, body: { project: { id: 7, identifier: 'rc-fixtures-2' } } };

    const result = await ensureProjectFixtures();

    expect(posts['/projects.json']).toHaveLength(1);
    expect(result['rc-fixtures-2'].id).toBe(7);
  });

  it('POST de versão falha: lança com o status', async () => {
    seededRedmine();
    responses['GET /projects/rc-fixtures/versions.json'] = { status: 200, body: { versions: [] } };
    responses['POST /projects/rc-fixtures/versions.json'] = { status: 422, body: { errors: ['Name is invalid'] } };

    await expect(ensureProjectFixtures()).rejects.toThrow(/versions\.json.*422/);
  });

  it('POST de categoria falha: lança com o status', async () => {
    seededRedmine();
    responses['GET /projects/rc-fixtures-2/issue_categories.json'] = { status: 200, body: { issue_categories: [] } };
    responses['POST /projects/rc-fixtures-2/issue_categories.json'] = { status: 403, body: '' };

    await expect(ensureProjectFixtures()).rejects.toThrow(/issue_categories\.json.*403/);
  });

  it('POST do projeto falha: lança com o status', async () => {
    seededRedmine();
    responses[PROJECTS_PAGE] = { status: 200, body: { projects: [{ id: 1, identifier: 'rc-fixtures' }], total_count: 1 } };
    responses['GET /trackers.json'] = { status: 200, body: { trackers: [{ id: 1 }] } };
    responses['POST /projects.json'] = { status: 422, body: { errors: ['Identifier has already been taken'] } };

    await expect(ensureProjectFixtures()).rejects.toThrow(/projects\.json.*422/);
  });

  it('GET /trackers.json falha: lança sem criar o projeto', async () => {
    responses[PROJECTS_PAGE] = { status: 200, body: { projects: [], total_count: 0 } };
    responses['GET /trackers.json'] = { status: 500, body: 'boom' };

    await expect(ensureProjectFixtures()).rejects.toThrow(/trackers.*500/);
    expect(posts['/projects.json']).toBeUndefined();
  });
});

describe('assertProjectFixtures', () => {
  it('tudo presente: não lança', async () => {
    seededRedmine();

    await expect(assertProjectFixtures()).resolves.toBeUndefined();
  });

  it('versão do seed ausente no 2º projeto: lança citando projeto e nome', async () => {
    seededRedmine();
    responses['GET /projects/rc-fixtures-2/versions.json'] = { status: 200, body: { versions: [{ id: 1, name: 'outra' }] } };

    await expect(assertProjectFixtures()).rejects.toThrow(/rc-fixtures-2.*\[seed\]/);
  });

  it('versão compartilhada de outro projeto com o mesmo nome não conta como do 2º projeto', async () => {
    seededRedmine();
    const shared = [];
    for (const name of PROJECT_FIXTURES['rc-fixtures-2'].versions) {
      shared.push({ id: 90, name, project: { id: 1, name: 'RC Fixtures' }, sharing: 'system' });
    }
    responses['GET /projects/rc-fixtures-2/versions.json'] = { status: 200, body: { versions: shared } };

    await expect(assertProjectFixtures()).rejects.toThrow(/rc-fixtures-2.*\[seed\] P2 v1\.0/);
  });

  it('categoria do seed ausente: lança', async () => {
    seededRedmine();
    responses['GET /projects/rc-fixtures/issue_categories.json'] = { status: 200, body: { issue_categories: [] } };

    await expect(assertProjectFixtures()).rejects.toThrow(/rc-fixtures/);
  });

  it('2º projeto sem trackers habilitados: lança', async () => {
    seededRedmine();
    responses['GET /projects/rc-fixtures-2.json?include=trackers'] = { status: 200, body: { project: { id: 2, trackers: [] } } };

    await expect(assertProjectFixtures()).rejects.toThrow(/trackers/);
  });

  it('GET de versões falha: lança com o status', async () => {
    seededRedmine();
    responses['GET /projects/rc-fixtures/versions.json'] = { status: 500, body: 'boom' };

    await expect(assertProjectFixtures()).rejects.toThrow(/500/);
  });

  it('GET do projeto falha: lança com o status', async () => {
    seededRedmine();
    responses['GET /projects/rc-fixtures-2.json'] = { status: 404, body: '' };

    await expect(assertProjectFixtures()).rejects.toThrow(/rc-fixtures-2.*404/);
  });
});
