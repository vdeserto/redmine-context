// @ts-check
//
// seed-users.mjs — usuários, grupo, memberships e o usuário bloqueado do seed (#255).
//
// Dá ao bundle nomes de gente para resolver: 3 usuários `seed-*` (nenhum admin),
// o grupo `seed-equipe` (com seed-bruno dentro) e memberships diretas de
// seed-ana, seed-carla e do grupo no projeto. seed-carla recebe a atribuição de
// uma issue num journal marcado e só então é bloqueada (`status: 3`) — é o autor
// de referências cujo usuário não está mais ativo. Depois de bloqueada, nada
// mais é feito com ela: re-execuções não reatribuem nem desbloqueiam.
//
// seed-ana é o não-admin cuja api_key grava as respostas 403 (M6-07.1). A chave
// sai de `GET /users/:id.json` com a credencial admin (campo `api_key`); nunca
// é logada. Os usuários são criados com `generate_password`, então nenhuma
// senha vive no código.

import { api, ensureByMarker, log, putIssue } from './seed-helpers.mjs';

const API_USER = 'seed-ana'; // não-admin com api_key (403 do M6-07.1)
const GROUP_MEMBER = 'seed-bruno'; // membro do projeto só via grupo
const LOCKED_USER = 'seed-carla'; // bloqueada depois da atribuição e do journal
const GROUP = 'seed-equipe';
const JOURNAL_MARKER = '[seed-users]';
const LOCKED_STATUS = 3;

const USERS = {
  [API_USER]: { firstname: 'Ana', lastname: 'Seed' },
  [GROUP_MEMBER]: { firstname: 'Bruno', lastname: 'Seed' },
  [LOCKED_USER]: { firstname: 'Carla', lastname: 'Seed' },
};

/** Quem precisa de membership direta no projeto (o grupo leva seed-bruno junto). */
const DIRECT_MEMBERS = [API_USER, LOCKED_USER, GROUP];

/**
 * Chama a API e lança se o status não for o esperado.
 * @param {string} method
 * @param {string} path
 * @param {unknown} body
 * @param {number} expected
 * @returns {Promise<any>} JSON da resposta
 */
async function call(method, path, body, expected) {
  const got = await api(method, path, body);
  if (got.status !== expected) {
    throw new Error(`${method} ${path} falhou: status ${got.status} — ${got.text.slice(0, 300)}`);
  }
  return got.json;
}

/**
 * Ids dos principals (usuário ou grupo) com membership no projeto, como chaves.
 * @param {string} project identifier
 * @returns {Promise<Record<number, true>>}
 */
async function projectMemberIds(project) {
  const got = await call('GET', `/projects/${project}/memberships.json?limit=100`, undefined, 200);
  /** @type {Record<number, true>} */
  const ids = {};
  for (const membership of got.memberships) {
    ids[(membership.user ?? membership.group).id] = true;
  }
  return ids;
}

/**
 * Garante usuários, grupo e memberships; atribui uma issue a seed-carla num
 * journal marcado e a bloqueia por último.
 * @param {string} project identifier do projeto (rc-fixtures)
 * @param {number} issueId issue que seed-carla recebe antes do bloqueio
 * @returns {Promise<Record<string, number>>} id por login/nome do grupo
 */
export async function ensureSeedUsers(project, issueId) {
  /** @type {Record<string, number>} */
  const ids = {};
  let lockedStatus = 0;
  for (const login in USERS) {
    const user = await ensureByMarker('user', login, async () => {
      const newUser = { login, ...USERS[login], mail: `${login}@example.com`, generate_password: true };
      return (await call('POST', '/users.json', { user: newUser }, 201)).user;
    });
    ids[login] = user.id;
    if (login === LOCKED_USER) {
      lockedStatus = user.status;
    }
  }

  const group = await ensureByMarker('group', GROUP, async () => {
    const newGroup = { name: GROUP, user_ids: [ids[GROUP_MEMBER]] };
    return (await call('POST', '/groups.json', { group: newGroup }, 201)).group;
  });
  ids[GROUP] = group.id;

  const roleId = (await call('GET', '/roles.json', undefined, 200)).roles[0].id;
  const memberIds = await projectMemberIds(project);
  for (const name of DIRECT_MEMBERS) {
    if (memberIds[ids[name]]) {
      log(`membership ${name} (${project}): já existe`);
      continue;
    }
    const membership = { user_id: ids[name], role_ids: [roleId] };
    await call('POST', `/projects/${project}/memberships.json`, { membership }, 201);
    log(`membership ${name} (${project}): criada`);
  }

  if (lockedStatus === LOCKED_STATUS) {
    log(`${LOCKED_USER}: já bloqueado`);
    return ids;
  }
  await ensureByMarker('journal', JOURNAL_MARKER, async () => {
    const notes = `${JOURNAL_MARKER} Atribuída a ${LOCKED_USER} antes do bloqueio.`;
    await putIssue(issueId, { assigned_to_id: ids[LOCKED_USER], notes }, 'atribuição');
  }, issueId);
  await call('PUT', `/users/${ids[LOCKED_USER]}.json`, { user: { status: LOCKED_STATUS } }, 204);
  log(`${LOCKED_USER}: bloqueado`);
  return ids;
}

/**
 * Confere via GET: seed-ana não-admin com api_key, seed-carla com status 3 e
 * as memberships diretas no projeto. Lança na primeira divergência.
 * @param {string} project identifier
 * @param {Record<string, number>} ids retorno de ensureSeedUsers
 */
export async function assertSeedUsers(project, ids) {
  const apiUser = (await call('GET', `/users/${ids[API_USER]}.json`, undefined, 200)).user;
  if (apiUser.admin) {
    throw new Error(`ASSERT ${API_USER}: deveria ser não-admin`);
  }
  if (typeof apiUser.api_key !== 'string' || apiUser.api_key === '') {
    throw new Error(`ASSERT ${API_USER}: sem api_key`);
  }
  const locked = (await call('GET', `/users/${ids[LOCKED_USER]}.json`, undefined, 200)).user;
  if (locked.status !== LOCKED_STATUS) {
    throw new Error(`ASSERT ${LOCKED_USER}: esperado status ${LOCKED_STATUS}, obtido ${locked.status}`);
  }
  const memberIds = await projectMemberIds(project);
  for (const name of DIRECT_MEMBERS) {
    if (!memberIds[ids[name]]) {
      throw new Error(`ASSERT membership: ${name} ausente em ${project}`);
    }
  }
  log(`asserções de usuários OK: ${LOCKED_USER} status=${LOCKED_STATUS}, memberships=${DIRECT_MEMBERS.join(', ')}`);
}
