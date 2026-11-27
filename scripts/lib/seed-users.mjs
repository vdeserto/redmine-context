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
// A issue "[seed] Trocas de responsável" (#259) nasce com seed-ana e troca de
// responsável em journals marcados: ana → carla ANTES do bloqueio (o Redmine
// recusa atribuir a bloqueado) e carla → bruno depois (tirar de bloqueado é
// permitido). Base semeada antes do #259 (carla já bloqueada, sem a 1ª troca,
// com ou sem a issue): o seed lança antes de qualquer escrita pedindo para recriar
// a base — nunca desbloqueia a carla.
//
// Troca ignorada: o Redmine pode responder 204 e gravar o journal com a nota
// marcada, mas sem detail. Como a marca já existe, a re-execução pularia a etapa
// para sempre; por isso o GET logo após cada PUT lança na hora. Para refazer,
// apague a issue "[seed] Trocas de responsável" e rode o seed de novo.
//
// seed-ana é o não-admin cuja api_key grava as respostas 403 (M6-07.1). A chave
// sai de `GET /users/:id.json` com a credencial admin (campo `api_key`); nunca
// é logada. Os usuários são criados com `generate_password`, então nenhuma
// senha vive no código.
//
// As memberships usam o 1º papel de /roles.json (Manager nos papéis padrão), que
// precisa ser atribuível. Assim seed-ana é Manager do rc-fixtures: o M6-07.1
// deve gravar os 403 em endpoints SÓ de admin (ex. /users.json), não de projeto.

import { api, ensureByMarker, getIssue, log, putIssue } from './seed-helpers.mjs';

const API_USER = 'seed-ana'; // não-admin com api_key (403 do M6-07.1)
const GROUP_MEMBER = 'seed-bruno'; // membro do projeto só via grupo
const LOCKED_USER = 'seed-carla'; // bloqueada depois da atribuição e do journal
const GROUP = 'seed-equipe';
const JOURNAL_MARKER = '[seed-users]';
const LOCKED_STATUS = 3;
const ASSIGNEE_SUBJECT = '[seed] Trocas de responsável';
const REDO_HINT = `apague a issue ${ASSIGNEE_SUBJECT} e rode o seed de novo`;
const TO_LOCKED = {
  marker: '[seed:responsavel-1]', // antes do bloqueio
  from: API_USER,
  to: LOCKED_USER,
  note: 'Repassada à Carla.',
};
const FROM_LOCKED = {
  marker: '[seed:responsavel-2]',
  from: LOCKED_USER,
  to: GROUP_MEMBER,
  note: 'Carla bloqueada; repassada ao Bruno.',
};
/** Base semeada antes do #259: a 1ª troca exige a carla ativa, e ela nunca é desbloqueada. */
const OLD_BASE_ERROR =
  `${TO_LOCKED.marker}: ${LOCKED_USER} já está bloqueada e o Redmine não atribui a bloqueado — ` +
  'base semeada antes do #259; recrie-a (docker compose -f docker/docker-compose.yml down -v && up -d) e rode o seed';

const USERS = {
  [API_USER]: { firstname: 'Ana', lastname: 'Seed' },
  [GROUP_MEMBER]: { firstname: 'Bruno', lastname: 'Seed' },
  [LOCKED_USER]: { firstname: 'Carla', lastname: 'Seed' },
};

/** Quem precisa de membership direta no projeto (o grupo leva seed-bruno junto). */
const DIRECT_MEMBERS = [API_USER, LOCKED_USER, GROUP];
/** O que a asserção confere no projeto: seed-bruno aparece com a membership herdada do grupo. */
const PROJECT_MEMBERS = [API_USER, LOCKED_USER, GROUP, GROUP_MEMBER];

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
  // A fixture tem poucos membros: uma página basta.
  const got = await call('GET', `/projects/${project}/memberships.json?limit=100`, undefined, 200);
  /** @type {Record<number, true>} */
  const ids = {};
  for (const membership of got.memberships) {
    ids[(membership.user ?? membership.group).id] = true;
  }
  return ids;
}

/**
 * Id da issue de trocas de responsável, se existir. O filtro `~` do Redmine é
 * "contém", então a comparação exata fica no cliente.
 * @param {string} project identifier
 * @returns {Promise<number | undefined>}
 */
async function findAssigneeIssue(project) {
  const path = `/issues.json?project_id=${project}&status_id=*&subject=~${encodeURIComponent(ASSIGNEE_SUBJECT)}`;
  for (const issue of (await call('GET', path, undefined, 200)).issues) {
    if (issue.subject === ASSIGNEE_SUBJECT) {
      return issue.id;
    }
  }
  return undefined;
}

/**
 * Troca o responsável da issue num journal marcado, se a marca ainda não existe,
 * e confere via GET que o Redmine gravou. Lança se o destino está bloqueado.
 * @param {number} issueId
 * @param {typeof TO_LOCKED} step
 * @param {Record<string, { id: number, status: number }>} users usuário por login
 */
async function ensureAssigneeChange(issueId, step, users) {
  await ensureByMarker('journal', step.marker, async () => {
    const target = users[step.to];
    if (target.status === LOCKED_STATUS) {
      throw new Error(OLD_BASE_ERROR);
    }
    await putIssue(issueId, { assigned_to_id: target.id, notes: `${step.marker} ${step.note}` }, step.marker);
    const savedId = (await getIssue(issueId)).assigned_to?.id;
    if (savedId !== target.id) {
      throw new Error(
        `${step.marker}: o Redmine ignorou assigned_to_id → ${target.id} (ficou ${savedId}); ${REDO_HINT}`,
      );
    }
  }, issueId);
}

/**
 * Garante usuários, grupo e memberships; atribui uma issue a seed-carla num
 * journal marcado e a bloqueia; a issue de trocas de responsável passa por ela
 * antes e depois do bloqueio.
 * @param {string} project identifier do projeto (rc-fixtures)
 * @param {number} issueId issue que seed-carla recebe antes do bloqueio
 * @returns {Promise<Record<string, number>>} id por login/nome do grupo
 */
export async function ensureSeedUsers(project, issueId) {
  /** @type {Record<string, number>} */
  const ids = {};
  /** @type {Record<string, { id: number, status: number }>} */
  const users = {};
  for (const login in USERS) {
    const user = await ensureByMarker('user', login, async () => {
      const newUser = { login, ...USERS[login], mail: `${login}@example.com`, generate_password: true };
      return (await call('POST', '/users.json', { user: newUser }, 201)).user;
    });
    ids[login] = user.id;
    users[login] = user;
  }

  const group = await ensureByMarker('group', GROUP, async () => {
    const newGroup = { name: GROUP, user_ids: [ids[GROUP_MEMBER]] };
    return (await call('POST', '/groups.json', { group: newGroup }, 201)).group;
  });
  ids[GROUP] = group.id;
  const groupUsers = (await call('GET', `/groups/${group.id}.json?include=users`, undefined, 200)).group.users;
  if (!groupUsers.some((user) => user.id === ids[GROUP_MEMBER])) {
    await call('POST', `/groups/${group.id}/users.json`, { user_id: ids[GROUP_MEMBER] }, 204);
    log(`${GROUP_MEMBER}: devolvido ao grupo ${GROUP}`);
  }

  const role = (await call('GET', '/roles.json', undefined, 200)).roles[0];
  if (!role) {
    throw new Error('GET /roles.json: nenhum papel disponível');
  }
  const memberIds = await projectMemberIds(project);
  for (const name of DIRECT_MEMBERS) {
    if (memberIds[ids[name]]) {
      log(`membership ${name} (${project}): já existe`);
      continue;
    }
    const membership = { user_id: ids[name], role_ids: [role.id] };
    await call('POST', `/projects/${project}/memberships.json`, { membership }, 201);
    log(`membership ${name} (${project}): criada`);
  }

  let assigneeIssueId = await findAssigneeIssue(project);
  if (assigneeIssueId === undefined) {
    if (users[LOCKED_USER].status === LOCKED_STATUS) {
      throw new Error(OLD_BASE_ERROR); // sem a issue não há a 1ª troca: nada de POST órfão
    }
    const description = 'Troca de responsável passando por um usuário depois bloqueado (seed).';
    const issue = { project_id: project, subject: ASSIGNEE_SUBJECT, description, assigned_to_id: ids[API_USER] };
    assigneeIssueId = (await call('POST', '/issues.json', { issue }, 201)).issue.id;
    log(`issue criada: "${ASSIGNEE_SUBJECT}" (id ${assigneeIssueId})`);
  }
  await ensureAssigneeChange(assigneeIssueId, TO_LOCKED, users);

  if (users[LOCKED_USER].status === LOCKED_STATUS) {
    log(`${LOCKED_USER}: já bloqueado`);
  } else {
    await ensureByMarker('journal', JOURNAL_MARKER, async () => {
      const notes = `${JOURNAL_MARKER} Atribuída a ${LOCKED_USER} antes do bloqueio.`;
      await putIssue(issueId, { assigned_to_id: ids[LOCKED_USER], notes }, 'atribuição');
    }, issueId);
    await call('PUT', `/users/${ids[LOCKED_USER]}.json`, { user: { status: LOCKED_STATUS } }, 204);
    log(`${LOCKED_USER}: bloqueado`);
  }
  await ensureAssigneeChange(assigneeIssueId, FROM_LOCKED, users);
  return ids;
}

/**
 * Confere via GET: seed-ana não-admin com api_key, seed-carla com status 3,
 * as memberships diretas e a herdada de seed-bruno no projeto, e 1 journal por
 * troca de responsável com o detail assigned_to_id exato (ana → carla → bruno).
 * Lança na primeira divergência.
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
  for (const name of PROJECT_MEMBERS) {
    if (!memberIds[ids[name]]) {
      throw new Error(`ASSERT membership: ${name} ausente em ${project}`);
    }
  }
  log(`asserções de usuários OK: ${LOCKED_USER} status=${LOCKED_STATUS}, memberships=${PROJECT_MEMBERS.join(', ')}`);

  const assigneeIssueId = await findAssigneeIssue(project);
  if (assigneeIssueId === undefined) {
    throw new Error(`ASSERT responsável: issue "${ASSIGNEE_SUBJECT}" ausente`);
  }
  /** @type {Map<string, any[]>} só as marcas das trocas; as demais notas ficam de fora */
  const journalsByMarker = new Map([[TO_LOCKED.marker, []], [FROM_LOCKED.marker, []]]);
  for (const journal of (await getIssue(assigneeIssueId, 'journals')).journals ?? []) {
    journalsByMarker.get((journal.notes ?? '').split(/\s/, 1)[0])?.push(journal);
  }
  const summary = [];
  for (const step of [TO_LOCKED, FROM_LOCKED]) {
    const journals = journalsByMarker.get(step.marker) ?? [];
    if (journals.length !== 1) {
      throw new Error(`ASSERT responsável: ${step.marker} esperado 1 journal, obtido ${journals.length}`);
    }
    const details = journals[0].details ?? [];
    let detail;
    for (const candidate of details) {
      if (candidate.property === 'attr' && candidate.name === 'assigned_to_id') {
        detail = candidate;
      }
    }
    const expected = `${ids[step.from]}→${ids[step.to]}`;
    if (`${detail?.old_value}→${detail?.new_value}` !== expected) {
      throw new Error(
        `ASSERT responsável: ${step.marker} esperado assigned_to_id ${expected} — ` +
          `details ${JSON.stringify(details)}; ${REDO_HINT}`,
      );
    }
    summary.push(`assigned_to_id ${expected}`);
  }
  log(`asserções OK: trocas de responsável na issue ${assigneeIssueId}: ${summary.join('; ')}`);
}
