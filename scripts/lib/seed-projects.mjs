// @ts-check
//
// seed-projects.mjs — 2º projeto do seed e as versões/categorias de cada projeto (#256).
//
// Material do bundle legível (ADR-006): nomes de projeto, versão e categoria no
// lugar de ids, inclusive nas trocas entre projetos (#258). Os nomes não se
// repetem entre projetos, para cada um apontar para uma entidade só. Idempotente
// pela marca de seed-helpers.mjs (identifier do projeto, nome da versão/categoria).

import { api, ensureByMarker, log } from './seed-helpers.mjs';

/**
 * Projetos do seed por identifier; o nome de cada versão/categoria é a marca.
 * @type {Record<string, { name: string, versions: string[], categories: string[] }>}
 */
export const PROJECT_FIXTURES = {
  'rc-fixtures': {
    name: 'RC Fixtures', // já criado pelo ensureProject do seed.mjs
    versions: ['[seed] v1.0', '[seed] v2.0'],
    categories: ['[seed] Backend', '[seed] Frontend'],
  },
  'rc-fixtures-2': {
    name: 'RC Fixtures 2',
    versions: ['[seed] P2 v1.0', '[seed] P2 v2.0'],
    categories: ['[seed] P2 Infra', '[seed] P2 Docs'],
  },
};

/** Coleções por projeto: tipo da marca, caminho/lista na REST e chave do corpo do POST. */
const COLLECTIONS = {
  versions: { kind: 'version', path: 'versions', key: 'version' },
  categories: { kind: 'category', path: 'issue_categories', key: 'issue_category' },
};

const PROJECT_WITH_TRACKERS = 'rc-fixtures-2';

/**
 * POST que precisa responder 201; devolve a entidade criada.
 * @param {string} path
 * @param {string} key chave da entidade no corpo e na resposta
 * @param {Record<string, unknown>} entity
 */
async function create(path, key, entity) {
  const created = await api('POST', path, { [key]: entity });
  if (created.status !== 201) {
    throw new Error(`POST ${path} falhou: status ${created.status} — ${created.text.slice(0, 300)}`);
  }
  return created.json?.[key];
}

/** Ids de todos os trackers da instância, para habilitar no projeto novo. */
async function trackerIds() {
  const got = await api('GET', '/trackers.json');
  if (got.status !== 200) {
    throw new Error(`GET /trackers.json falhou: status ${got.status}`);
  }
  const ids = [];
  for (const tracker of got.json?.trackers ?? []) {
    ids.push(tracker.id);
  }
  return ids;
}

/**
 * Garante os projetos de PROJECT_FIXTURES (com todos os trackers) e as versões e
 * categorias de cada um.
 * @returns {Promise<Record<string, { id: number, versions: Record<string, number>, categories: Record<string, number> }>>}
 *   ids por identifier; versões e categorias por nome
 */
export async function ensureProjectFixtures() {
  /** @type {Record<string, { id: number, versions: Record<string, number>, categories: Record<string, number> }>} */
  const projects = {};
  for (const identifier in PROJECT_FIXTURES) {
    const fixtures = PROJECT_FIXTURES[identifier];
    const project = await ensureByMarker('project', identifier, async () => {
      const newProject = { name: fixtures.name, identifier, is_public: true, tracker_ids: await trackerIds() };
      return create('/projects.json', 'project', newProject);
    });
    const ids = { id: project.id, versions: {}, categories: {} };
    for (const collection in COLLECTIONS) {
      const { kind, path, key } = COLLECTIONS[collection];
      for (const name of fixtures[collection]) {
        const entity = await ensureByMarker(kind, name, async () => {
          const newEntity = { name };
          return create(`/projects/${identifier}/${path}.json`, key, newEntity);
        }, identifier);
        ids[collection][name] = entity.id;
      }
    }
    projects[identifier] = ids;
  }
  return projects;
}

/**
 * Asserções via GET, só sobre as entidades daqui: cada versão/categoria de
 * PROJECT_FIXTURES no seu projeto e o 2º projeto com trackers habilitados.
 */
export async function assertProjectFixtures() {
  for (const identifier in PROJECT_FIXTURES) {
    for (const collection in COLLECTIONS) {
      const { kind, path } = COLLECTIONS[collection];
      const got = await api('GET', `/projects/${identifier}/${path}.json`);
      if (got.status !== 200) {
        throw new Error(`ASSERT ${identifier}: GET ${path} esperado 200, obtido ${got.status}`);
      }
      /** @type {Record<string, boolean>} */
      const present = {};
      for (const item of got.json?.[path] ?? []) {
        present[item.name] = true;
      }
      for (const name of PROJECT_FIXTURES[identifier][collection]) {
        if (!present[name]) {
          throw new Error(`ASSERT ${identifier}: ${kind} '${name}' ausente`);
        }
      }
    }
  }
  const project = await api('GET', `/projects/${PROJECT_WITH_TRACKERS}.json?include=trackers`);
  const trackers = project.json?.project?.trackers?.length ?? 0;
  if (project.status !== 200 || trackers < 1) {
    throw new Error(`ASSERT ${PROJECT_WITH_TRACKERS}: esperado trackers >= 1, obtido ${trackers} (status ${project.status})`);
  }
  log(`asserções OK: versões e categorias do seed nos 2 projetos; ${PROJECT_WITH_TRACKERS} com ${trackers} trackers`);
}
