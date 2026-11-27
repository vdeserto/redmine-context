/**
 * Matriz completa do seed (#205): cada caso do plano é conferido no estado lido por
 * GET, e a falha nomeia TODOS os casos ausentes de uma vez. Sem rede: o `fetch`
 * global responde a partir de um Redmine de mentira já semeado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSeedMatrix } from '../../scripts/lib/seed-matrix.mjs';

const BASE = 'http://localhost:3080';

type Detail = { property: string; name: string; old_value?: string | null; new_value?: string | null };
type Issue = {
  id: number;
  journals: { details: Detail[] }[];
  attachments: { id: number }[];
  custom_fields: { id: number }[];
};
type Project = { id: number; versions: string[]; categories: string[]; issues: Issue[] };
type State = { projects: Record<string, Project>; users: { login: string; status: number }[] };

let state: State;
let failPath: string; // GET que responde 500

/** Detail de atributo trocado. */
function attr(name: string): Detail {
  return { property: 'attr', name, old_value: '1', new_value: '2' };
}

/** Redmine já semeado com toda a matriz. */
function seededState(): State {
  return {
    projects: {
      'rc-fixtures': {
        id: 1,
        versions: ['[seed] v1.0', '[seed] v2.0'],
        categories: ['[seed] Backend', '[seed] Frontend'],
        issues: [
          {
            id: 10,
            journals: [{ details: [attr('status_id')] }, { details: [attr('tracker_id'), attr('priority_id')] }],
            attachments: [{ id: 1 }, { id: 2 }],
            custom_fields: [{ id: 5 }],
          },
          {
            id: 11,
            journals: [{ details: [attr('assigned_to_id')] }, { details: [{ property: 'cf', name: '9', new_value: 'x' }] }],
            attachments: [],
            custom_fields: [{ id: 5 }],
          },
          {
            id: 12,
            journals: [
              { details: [{ property: 'attachment', name: '3', new_value: 'seed-added.txt' }] },
              { details: [{ property: 'attachment', name: '4', old_value: 'seed-removed.txt' }] },
            ],
            attachments: [{ id: 3 }],
            custom_fields: [],
          },
        ],
      },
      'rc-fixtures-2': {
        id: 2,
        versions: ['[seed] P2 v1.0', '[seed] P2 v2.0'],
        categories: ['[seed] P2 Infra', '[seed] P2 Docs'],
        issues: [
          {
            id: 20,
            journals: [{ details: [attr('category_id'), attr('fixed_version_id'), attr('project_id')] }],
            attachments: [],
            custom_fields: [],
          },
        ],
      },
    },
    users: [
      { login: 'admin', status: 1 },
      { login: 'seed-ana', status: 1 },
      { login: 'seed-bruno', status: 1 },
      { login: 'seed-carla', status: 3 },
    ],
  };
}

/** Resposta JSON do Redmine de mentira para um GET. */
function reply(path: string): Response {
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  if (path === failPath) {
    return new Response('erro', { status: 500 });
  }
  if (path === '/users.json?status=*&limit=100') {
    return json({ users: state.users, total_count: state.users.length });
  }
  for (const identifier in state.projects) {
    const project = state.projects[identifier];
    if (!project) {
      continue;
    }
    // Versões compartilhadas de outro projeto também aparecem na lista: o helper as descarta.
    const shared = { name: 'compartilhada', project: { id: 99 } };
    const routes: Record<string, unknown> = {
      [`/projects/${identifier}.json`]: { project: { id: project.id, identifier } },
      [`/projects/${identifier}/versions.json`]: {
        versions: [shared, ...project.versions.map((name) => ({ name, project: { id: project.id } }))],
      },
      [`/projects/${identifier}/issue_categories.json`]: {
        issue_categories: project.categories.map((name) => ({ name, project: { id: project.id } })),
      },
      [`/issues.json?project_id=${identifier}&status_id=*&limit=100`]: {
        issues: project.issues.map((issue) => ({ id: issue.id })),
        total_count: project.issues.length,
      },
    };
    for (const issue of project.issues) {
      routes[`/issues/${issue.id}.json?include=journals,attachments`] = { issue };
    }
    if (path in routes) {
      return json(routes[path]);
    }
  }
  return new Response(null, { status: 404 });
}

/** Mensagem do erro lançado pela matriz. */
async function failure(): Promise<string> {
  const error = await assertSeedMatrix().then(() => undefined, (err: Error) => err);
  return error?.message ?? 'não lançou';
}

/** Issue do rc-fixtures pelo id. */
function issueById(id: number): Issue {
  const issue = state.projects['rc-fixtures']?.issues.find((candidate) => candidate.id === id);
  if (!issue) {
    throw new Error(`issue ${id} fora do estado`);
  }
  return issue;
}

beforeEach(() => {
  state = seededState();
  failPath = '';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => reply(url.slice(BASE.length))));
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('assertSeedMatrix — matriz completa', () => {
  it('passa e devolve as contagens quando todos os casos estão presentes', async () => {
    const counts = await assertSeedMatrix();

    expect(counts).toEqual({ issues: 4, journals: 8, anexos: 3, usuarios: 3, versoes: 4, categorias: 4 });
  });

  it('só faz GET (nunca escreve)', async () => {
    await assertSeedMatrix();

    const fetchMock = vi.mocked(fetch);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method).toBe('GET');
    }
  });
});

describe('assertSeedMatrix — caso ausente é nomeado', () => {
  it('usuário bloqueado: seed-carla ativa', async () => {
    state.users[3] = { login: 'seed-carla', status: 1 };

    expect(await failure()).toBe('matriz do seed incompleta: usuário bloqueado (seed-carla)');
  });

  it('2º projeto ausente: nomeia o projeto, as versões e as categorias dele e a troca de projeto', async () => {
    delete state.projects['rc-fixtures-2'];

    const message = await failure();

    expect(message).toContain('2º projeto (rc-fixtures-2)');
    expect(message).toContain("versão '[seed] P2 v1.0' (rc-fixtures-2)");
    expect(message).toContain("categoria '[seed] P2 Docs' (rc-fixtures-2)");
    expect(message).toContain('troca de projeto (project_id)');
    expect(message).not.toContain("'[seed] v1.0'");
  });

  it('versão e categoria: cada nome ausente no seu projeto', async () => {
    const project = state.projects['rc-fixtures'];
    if (project) {
      project.versions = ['[seed] v1.0'];
      project.categories = ['[seed] Frontend'];
    }

    expect(await failure()).toBe(
      "matriz do seed incompleta: versão '[seed] v2.0' (rc-fixtures), categoria '[seed] Backend' (rc-fixtures)",
    );
  });

  it.each([
    ['status_id', 'troca de status (status_id)'],
    ['tracker_id', 'troca de tracker (tracker_id)'],
    ['priority_id', 'troca de prioridade (priority_id)'],
    ['assigned_to_id', 'troca de responsável (assigned_to_id)'],
    ['project_id', 'troca de projeto (project_id)'],
    ['category_id', 'troca de categoria (category_id)'],
    ['fixed_version_id', 'troca de versão (fixed_version_id)'],
  ])('troca de %s ausente', async (field, name) => {
    for (const project of Object.values(state.projects)) {
      for (const issue of project.issues) {
        for (const journal of issue.journals) {
          journal.details = journal.details.filter((detail) => detail.name !== field);
        }
      }
    }

    expect(await failure()).toBe(`matriz do seed incompleta: ${name}`);
  });

  it('CF removido: o detail cf cujo campo ainda está em custom_fields não conta', async () => {
    issueById(11).custom_fields.push({ id: 9 });

    expect(await failure()).toBe('matriz do seed incompleta: CF removido (detail cf fora de custom_fields)');
  });

  it('anexo adicionado e removido ausentes: lista os dois na mesma mensagem', async () => {
    issueById(12).journals = [];

    expect(await failure()).toBe('matriz do seed incompleta: anexo adicionado, anexo removido');
  });

  it('detail com old_value igual ao new_value não conta como troca', async () => {
    issueById(10).journals[0] = { details: [{ property: 'attr', name: 'status_id', old_value: '2', new_value: '2' }] };

    expect(await failure()).toBe('matriz do seed incompleta: troca de status (status_id)');
  });
});

describe('assertSeedMatrix — falhas de leitura', () => {
  it('GET de issues que não responde 200 lança com o caminho', async () => {
    failPath = '/issues.json?project_id=rc-fixtures&status_id=*&limit=100';

    expect(await failure()).toContain(`GET ${failPath} falhou: status 500`);
  });

  it('GET de usuários que não responde 200 lança com o caminho', async () => {
    failPath = '/users.json?status=*&limit=100';

    expect(await failure()).toContain(`GET ${failPath} falhou: status 500`);
  });
});
