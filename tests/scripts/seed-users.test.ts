/**
 * Usuários, grupo, memberships e o usuário bloqueado do seed (#255).
 * Sem rede: o `fetch` global é trocado por um dublê que responde por "MÉTODO caminho".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSeedUsers, ensureSeedUsers } from '../../scripts/lib/seed-users.mjs';

const BASE = 'http://localhost:3080';
const API_KEY = 'chave-secreta-da-ana';

type Reply = { status: number; body?: unknown };
type Call = { method: string; path: string; body: Record<string, Record<string, unknown>> };

/** Respostas por "MÉTODO caminho"; função recebe o corpo enviado. O resto vira 404. */
let routes: Record<string, Reply | ((body: { user: { login: string } }) => Reply)>;
let calls: Call[];
let stderr: ReturnType<typeof vi.spyOn>;

const USERS_LIST = 'GET /users.json?status=*&limit=100&offset=0';
const MEMBERS_LIST = 'GET /projects/rc-fixtures/memberships.json?limit=100';
const JOURNALS = 'GET /issues/12.json?include=journals';
const GROUP_USERS = 'GET /groups/30.json?include=users';

beforeEach(() => {
  routes = {};
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.slice(BASE.length);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: String(init.method), path, body });
    const route = routes[`${init.method} ${path}`];
    const reply = typeof route === 'function' ? route(body) : (route ?? { status: 404 });
    const text = reply.body === undefined ? null : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status });
  }));
  stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Tudo já criado; `carlaStatus` decide se o bloqueio ainda falta. */
function seededRoutes(carlaStatus: number, journalNotes: string | null) {
  routes[USERS_LIST] = {
    status: 200,
    body: {
      users: [
        { id: 1, login: 'admin', status: 1 },
        { id: 21, login: 'seed-ana', status: 1 },
        { id: 22, login: 'seed-bruno', status: 1 },
        { id: 23, login: 'seed-carla', status: carlaStatus },
      ],
      total_count: 4,
    },
  };
  routes['GET /groups.json'] = { status: 200, body: { groups: [{ id: 30, name: 'seed-equipe' }] } };
  routes['GET /roles.json'] = { status: 200, body: { roles: [{ id: 3, name: 'Manager' }] } };
  routes[MEMBERS_LIST] = {
    status: 200,
    body: {
      memberships: [
        { id: 1, user: { id: 21, name: 'Ana Seed' } },
        { id: 2, user: { id: 23, name: 'Carla Seed' } },
        { id: 3, group: { id: 30, name: 'seed-equipe' } },
        { id: 4, user: { id: 22, name: 'Bruno Seed' } },
      ],
    },
  };
  routes[GROUP_USERS] = { status: 200, body: { group: { id: 30, name: 'seed-equipe', users: [{ id: 22, name: 'Bruno Seed' }] } } };
  routes[JOURNALS] = { status: 200, body: { issue: { id: 12, journals: [{ id: 1, notes: journalNotes }] } } };
}

function writes() {
  return calls.filter((c) => c.method !== 'GET');
}

describe('ensureSeedUsers', () => {
  it('ambiente vazio: cria 3 usuários, grupo, memberships, atribui e bloqueia por último', async () => {
    let nextUserId = 21;
    routes[USERS_LIST] = { status: 200, body: { users: [{ id: 1, login: 'admin', status: 1 }], total_count: 1 } };
    routes['POST /users.json'] = (body) => ({ status: 201, body: { user: { id: nextUserId++, login: body.user.login, status: 1 } } });
    routes['GET /groups.json'] = { status: 200, body: { groups: [] } };
    routes['POST /groups.json'] = { status: 201, body: { group: { id: 30, name: 'seed-equipe' } } };
    routes[GROUP_USERS] = { status: 200, body: { group: { id: 30, users: [{ id: 22 }] } } };
    routes['GET /roles.json'] = { status: 200, body: { roles: [{ id: 3, name: 'Manager' }, { id: 4, name: 'Developer' }] } };
    routes[MEMBERS_LIST] = { status: 200, body: { memberships: [] } };
    routes['POST /projects/rc-fixtures/memberships.json'] = { status: 201, body: { membership: { id: 1 } } };
    routes[JOURNALS] = { status: 200, body: { issue: { id: 12, journals: [] } } };
    routes['PUT /issues/12.json'] = { status: 204 };
    routes['PUT /users/23.json'] = { status: 204 };

    const ids = await ensureSeedUsers('rc-fixtures', 12);

    expect(ids).toEqual({ 'seed-ana': 21, 'seed-bruno': 22, 'seed-carla': 23, 'seed-equipe': 30 });
    const created = writes().filter((c) => c.path === '/users.json');
    expect(created.map((c) => c.body.user.login)).toEqual(['seed-ana', 'seed-bruno', 'seed-carla']);
    for (const call of created) {
      expect(call.body.user.generate_password).toBe(true); // nenhuma senha no código
      expect(call.body.user.password).toBeUndefined();
      expect(call.body.user.admin).toBeUndefined();
    }
    expect(writes().find((c) => c.path === '/groups.json')?.body).toEqual({ group: { name: 'seed-equipe', user_ids: [22] } });
    const members = writes().filter((c) => c.path.endsWith('/memberships.json')).map((c) => c.body.membership);
    expect(members).toEqual([
      { user_id: 21, role_ids: [3] },
      { user_id: 23, role_ids: [3] },
      { user_id: 30, role_ids: [3] },
    ]);
    const assign = writes().find((c) => c.path === '/issues/12.json');
    expect(assign?.body.issue.assigned_to_id).toBe(23);
    expect(assign?.body.issue.notes).toMatch(/^\[seed-users\] /);
    expect(writes().at(-1)).toEqual({ method: 'PUT', path: '/users/23.json', body: { user: { status: 3 } } });
  });

  it('2ª execução com tudo pronto e bloqueado: nenhuma escrita (não reatribui nem desbloqueia)', async () => {
    seededRoutes(3, null);

    const ids = await ensureSeedUsers('rc-fixtures', 12);

    expect(ids).toEqual({ 'seed-ana': 21, 'seed-bruno': 22, 'seed-carla': 23, 'seed-equipe': 30 });
    expect(writes()).toEqual([]);
  });

  it('journal já gravado mas bloqueio pendente: só bloqueia', async () => {
    seededRoutes(1, '[seed-users] Atribuída antes do bloqueio.');
    routes['PUT /users/23.json'] = { status: 204 };

    await ensureSeedUsers('rc-fixtures', 12);

    expect(writes()).toEqual([{ method: 'PUT', path: '/users/23.json', body: { user: { status: 3 } } }]);
  });

  it('grupo já existe sem seed-bruno: devolve o bruno ao grupo', async () => {
    seededRoutes(3, null);
    routes[GROUP_USERS] = { status: 200, body: { group: { id: 30, users: [] } } };
    routes['POST /groups/30/users.json'] = { status: 204 };

    await ensureSeedUsers('rc-fixtures', 12);

    expect(writes()).toEqual([{ method: 'POST', path: '/groups/30/users.json', body: { user_id: 22 } }]);
  });

  it('membership parcial: cria só as que faltam e loga "já existe" para a existente', async () => {
    seededRoutes(3, null);
    routes[MEMBERS_LIST] = { status: 200, body: { memberships: [{ id: 1, user: { id: 21, name: 'Ana Seed' } }] } };
    routes['POST /projects/rc-fixtures/memberships.json'] = { status: 201, body: { membership: { id: 9 } } };

    await ensureSeedUsers('rc-fixtures', 12);

    expect(writes().map((c) => c.body.membership)).toEqual([
      { user_id: 23, role_ids: [3] },
      { user_id: 30, role_ids: [3] },
    ]);
    const logged = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(logged).toContain('membership seed-ana (rc-fixtures): já existe');
  });

  it('seed-carla ativa, sem journal e já atribuída: grava o journal e bloqueia, uma vez cada', async () => {
    seededRoutes(1, null);
    routes[JOURNALS] = { status: 200, body: { issue: { id: 12, assigned_to: { id: 23 }, journals: [] } } };
    routes['PUT /issues/12.json'] = { status: 204 };
    routes['PUT /users/23.json'] = { status: 204 };

    await ensureSeedUsers('rc-fixtures', 12);

    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /issues/12.json', 'PUT /users/23.json']);
    expect(writes()[0].body.issue.notes).toMatch(/^\[seed-users\] /);
  });

  it('/roles.json sem papéis: lança com a pista', async () => {
    seededRoutes(3, null);
    routes['GET /roles.json'] = { status: 200, body: { roles: [] } };

    await expect(ensureSeedUsers('rc-fixtures', 12)).rejects.toThrow('GET /roles.json: nenhum papel disponível');
  });

  it('POST de grupo falha: lança com o status', async () => {
    seededRoutes(3, null);
    routes['GET /groups.json'] = { status: 200, body: { groups: [] } };
    routes['POST /groups.json'] = { status: 422, body: { errors: ['Name has already been taken'] } };

    await expect(ensureSeedUsers('rc-fixtures', 12)).rejects.toThrow(/POST \/groups\.json.*422/);
  });

  it('POST de membership falha: lança com o status', async () => {
    seededRoutes(3, null);
    routes[MEMBERS_LIST] = { status: 200, body: { memberships: [] } };
    routes['POST /projects/rc-fixtures/memberships.json'] = { status: 422, body: { errors: ['Role cannot be empty'] } };

    await expect(ensureSeedUsers('rc-fixtures', 12)).rejects.toThrow(/POST \/projects\/rc-fixtures\/memberships\.json.*422/);
  });

  it('POST de usuário falha: lança com o status', async () => {
    routes[USERS_LIST] = { status: 200, body: { users: [], total_count: 0 } };
    routes['POST /users.json'] = { status: 422, body: { errors: ['Email has already been taken'] } };

    await expect(ensureSeedUsers('rc-fixtures', 12)).rejects.toThrow(/POST \/users\.json.*422/);
  });

  it('PUT do bloqueio falha: lança', async () => {
    seededRoutes(1, '[seed-users] x');
    routes['PUT /users/23.json'] = { status: 422, body: { errors: ['x'] } };

    await expect(ensureSeedUsers('rc-fixtures', 12)).rejects.toThrow(/PUT \/users\/23\.json.*422/);
  });
});

describe('assertSeedUsers', () => {
  const ids = { 'seed-ana': 21, 'seed-bruno': 22, 'seed-carla': 23, 'seed-equipe': 30 };

  beforeEach(() => {
    seededRoutes(3, null);
    routes['GET /users/21.json'] = { status: 200, body: { user: { id: 21, admin: false, api_key: API_KEY, status: 1 } } };
    routes['GET /users/23.json'] = { status: 200, body: { user: { id: 23, admin: false, status: 3 } } };
  });

  it('tudo certo: passa e não escreve a api_key no log', async () => {
    await assertSeedUsers('rc-fixtures', ids);

    expect(writes()).toEqual([]);
    const logged = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(logged).toMatch(/OK/);
    expect(logged).not.toContain(API_KEY);
  });

  it('usuário que deveria estar bloqueado está ativo: lança', async () => {
    routes['GET /users/23.json'] = { status: 200, body: { user: { id: 23, status: 1 } } };

    await expect(assertSeedUsers('rc-fixtures', ids)).rejects.toThrow(/status/);
  });

  it('não-admin sem api_key ou admin: lança sem vazar a chave', async () => {
    routes['GET /users/21.json'] = { status: 200, body: { user: { id: 21, admin: false } } };
    await expect(assertSeedUsers('rc-fixtures', ids)).rejects.toThrow(/api_key/);

    routes['GET /users/21.json'] = { status: 200, body: { user: { id: 21, admin: true, api_key: API_KEY } } };
    const err = await assertSeedUsers('rc-fixtures', ids).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/admin/);
    expect((err as Error).message).not.toContain(API_KEY);
  });

  it('membership do grupo ausente no projeto: lança', async () => {
    routes[MEMBERS_LIST] = {
      status: 200,
      body: { memberships: [{ id: 1, user: { id: 21 } }, { id: 2, user: { id: 23 } }] },
    };

    await expect(assertSeedUsers('rc-fixtures', ids)).rejects.toThrow(/seed-equipe/);
  });

  it('grupo no projeto mas sem seed-bruno (membership herdada ausente): lança', async () => {
    routes[MEMBERS_LIST] = {
      status: 200,
      body: { memberships: [{ id: 1, user: { id: 21 } }, { id: 2, user: { id: 23 } }, { id: 3, group: { id: 30 } }] },
    };

    await expect(assertSeedUsers('rc-fixtures', ids)).rejects.toThrow(/seed-bruno/);
  });
});
