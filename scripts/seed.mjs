#!/usr/bin/env node
// @ts-check
//
// seed.mjs — Seed de fixtures ricas no Redmine via REST API.
//
// Cria 1 projeto (identifier fixo `rc-fixtures`) e 3 issues enriquecidas.
// É idempotente: cada recurso é verificado via GET antes de qualquer POST/PUT,
// então re-execuções não duplicam nada (nem journals, relations ou anexos).
// Ao final, asserções via GET validam as contagens e o processo sai com código
// != 0 se algo estiver errado.
//
// Fixtures geradas (o que cada issue ganha):
//   issue base 1 → journal (comentário), custom field Severidade=Alta,
//                  anexo de texto (fixture-note.txt), relation "relates" com a
//                  issue base 2, e é a PARENT da issue base 3.
//   issue base 2 → journal (comentário), custom field Severidade=Média,
//                  alvo da relation vinda da issue base 1.
//   issue base 3 → journal (comentário), custom field Severidade=Baixa,
//                  é FILHA (child) da issue base 1.
//
// O custom field 'Severidade' (list) não é criável pela REST API
// (POST /custom_fields.json não existe), então é criado via SQL idempotente no
// one-shot `enable-rest-api` do docker/docker-compose.yml. Aqui apenas
// atribuímos valores a ele.
//
// Uso:
//   node scripts/seed.mjs
//
// Config via ambiente (defaults combinam com o compose de teste em docker/):
//   REDMINE_URL             (default http://localhost:3080)
//   REDMINE_ADMIN_USER      (default admin)
//   REDMINE_ADMIN_PASSWORD  (default admin)
//
// Infra script (fora de src/): não usa console. Loga em stderr via helper.

/** Loga uma linha em stderr (o eslint proíbe console; isto é script de infra). */
const log = (msg) => process.stderr.write(`[seed] ${msg}\n`);

const BASE = (process.env.REDMINE_URL ?? 'http://localhost:3080').replace(/\/+$/, '');
const USER = process.env.REDMINE_ADMIN_USER ?? 'admin';
const PASS = process.env.REDMINE_ADMIN_PASSWORD ?? 'admin';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

const PROJECT_ID = 'rc-fixtures';
const PROJECT_NAME = 'RC Fixtures';

const CUSTOM_FIELD_NAME = 'Severidade';
// Prefixo que marca um journal criado pelo seed (chave de idempotência).
const JOURNAL_MARKER = '[seed]';
const ATTACH_FILENAME = 'fixture-note.txt';

/**
 * Fixtures determinísticas: `subject` é a chave de idempotência; `severity` e
 * `note` alimentam o enriquecimento (custom field e journal).
 */
const ISSUES = [
  {
    subject: 'RC Fixture: issue base 1',
    description: 'Issue base 1 gerada pelo seed (rc-fixtures). Texto simples para smoke tests.',
    severity: 'Alta',
    note: 'Comentário de fixture na issue base 1 (parent, com anexo e relation).',
  },
  {
    subject: 'RC Fixture: issue base 2',
    description: 'Issue base 2 gerada pelo seed (rc-fixtures). Descrição com **markdown** leve.',
    severity: 'Média',
    note: 'Comentário de fixture na issue base 2 (alvo da relation).',
  },
  {
    subject: 'RC Fixture: issue base 3',
    description: 'Issue base 3 gerada pelo seed (rc-fixtures). Usada para validar contagens via GET.',
    severity: 'Baixa',
    note: 'Comentário de fixture na issue base 3 (child da issue base 1).',
  },
];

/**
 * Chama a REST API do Redmine com Basic auth.
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<{ status: number, ok: boolean, json: any, text: string }>}
 */
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: AUTH,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, ok: res.ok, json, text };
}

/**
 * Preflight: falha alto se a auth admin não funciona.
 *
 * O ambiente (docker/docker-compose.yml) já deixa a API utilizável sem passo
 * manual: o one-shot `enable-rest-api` habilita a REST, zera o
 * `must_change_passwd` do admin e cria o custom field `Severidade`; e
 * `load-default-data` carrega trackers/statuses antes dele.
 * Se ainda assim a auth falhar, orienta em vez de seguir quebrado.
 */
async function preflightAuth() {
  const me = await api('GET', '/users/current.json');
  if (me.status !== 200 || !me.json?.user?.id) {
    log(`ERRO: auth admin falhou em /users/current.json (status ${me.status}).`);
    log('Verifique se o ambiente subiu completo: docker compose -f docker/docker-compose.yml up -d');
    log('(os one-shots enable-rest-api e load-default-data precisam ter concluído)');
    process.exit(1);
  }
  log(`preflight ok: autenticado como ${me.json.user.login} (id ${me.json.user.id})`);
}

/** Garante o projeto `rc-fixtures` (GET antes de POST). */
async function ensureProject() {
  const got = await api('GET', `/projects/${PROJECT_ID}.json`);
  if (got.status === 200) {
    log(`projeto ${PROJECT_ID} já existe (id ${got.json?.project?.id})`);
    return;
  }
  if (got.status !== 404) {
    throw new Error(`GET projeto inesperado: status ${got.status} — ${got.text}`);
  }
  const created = await api('POST', '/projects.json', {
    project: {
      name: PROJECT_NAME,
      identifier: PROJECT_ID,
      description: 'Projeto de fixtures do redmine-context (seed base M1-02.2).',
      is_public: true,
    },
  });
  if (created.status !== 201) {
    throw new Error(`POST projeto falhou: status ${created.status} — ${created.text}`);
  }
  log(`projeto ${PROJECT_ID} criado (id ${created.json?.project?.id})`);
}

/**
 * Lista os subjects das issues do projeto (todas as páginas necessárias).
 * @returns {Promise<Set<string>>}
 */
async function existingSubjects() {
  const got = await api('GET', `/issues.json?project_id=${PROJECT_ID}&status_id=*&limit=100`);
  if (got.status !== 200) {
    throw new Error(`GET issues falhou: status ${got.status} — ${got.text}`);
  }
  const list = Array.isArray(got.json?.issues) ? got.json.issues : [];
  return new Set(list.map((/** @type {{ subject: string }} */ i) => i.subject));
}

/** Garante as 3 issues fixas (busca por subject antes de criar). */
async function ensureIssues() {
  const present = await existingSubjects();
  for (const issue of ISSUES) {
    if (present.has(issue.subject)) {
      log(`issue já existe: "${issue.subject}"`);
      continue;
    }
    const created = await api('POST', '/issues.json', {
      issue: {
        project_id: PROJECT_ID,
        subject: issue.subject,
        description: issue.description,
      },
    });
    if (created.status !== 201) {
      throw new Error(`POST issue falhou: status ${created.status} — ${created.text}`);
    }
    log(`issue criada: "${issue.subject}" (id ${created.json?.issue?.id})`);
  }
}

/**
 * GET de uma issue com includes opcionais (ex.: 'journals,attachments').
 * @param {number} id
 * @param {string} [include]
 * @returns {Promise<any>} objeto `issue`
 */
async function getIssue(id, include) {
  const q = include ? `?include=${include}` : '';
  const got = await api('GET', `/issues/${id}.json${q}`);
  if (got.status !== 200) {
    throw new Error(`GET issue ${id} falhou: status ${got.status} — ${got.text}`);
  }
  return got.json.issue;
}

/**
 * Resolve os ids das ISSUES fixas na ordem definida (casando por subject).
 * @returns {Promise<number[]>} ids alinhados ao array ISSUES
 */
async function resolveIssueIds() {
  const got = await api('GET', `/issues.json?project_id=${PROJECT_ID}&status_id=*&limit=100`);
  if (got.status !== 200) {
    throw new Error(`GET issues falhou: status ${got.status} — ${got.text}`);
  }
  const bySubject = new Map(
    (got.json?.issues ?? []).map((/** @type {{ subject: string, id: number }} */ i) => [i.subject, i.id]),
  );
  return ISSUES.map((issue) => {
    const id = bySubject.get(issue.subject);
    if (typeof id !== 'number') {
      throw new Error(`não achei o id da issue "${issue.subject}" para enriquecer`);
    }
    return id;
  });
}

/** Descobre o id do custom field 'Severidade' (criado via SQL no one-shot). */
async function severidadeFieldId() {
  const got = await api('GET', '/custom_fields.json');
  if (got.status !== 200) {
    throw new Error(`GET custom_fields falhou: status ${got.status} — ${got.text}`);
  }
  const cf = (got.json?.custom_fields ?? []).find(
    (/** @type {{ name: string }} */ f) => f.name === CUSTOM_FIELD_NAME,
  );
  if (!cf) {
    throw new Error(`custom field '${CUSTOM_FIELD_NAME}' ausente — verifique o one-shot enable-rest-api (SQL)`);
  }
  return cf.id;
}

/**
 * Adiciona um comentário (journal) via PUT notes — só se ainda não houver um
 * journal do seed (marcado por JOURNAL_MARKER). Idempotente.
 * @param {number} id
 * @param {string} note
 */
async function ensureJournal(id, note) {
  const issue = await getIssue(id, 'journals');
  const has = (issue.journals ?? []).some(
    (/** @type {{ notes?: string }} */ j) => typeof j.notes === 'string' && j.notes.includes(JOURNAL_MARKER),
  );
  if (has) {
    log(`issue ${id}: journal já presente`);
    return;
  }
  const put = await api('PUT', `/issues/${id}.json`, { issue: { notes: note } });
  if (put.status !== 204 && put.status !== 200) {
    throw new Error(`PUT journal issue ${id} falhou: status ${put.status} — ${put.text}`);
  }
  log(`issue ${id}: journal criado`);
}

/**
 * Define o valor do custom field Severidade se ainda não estiver no valor
 * esperado. Idempotente.
 * @param {number} id
 * @param {number} fieldId
 * @param {string} value
 */
async function ensureCustomField(id, fieldId, value) {
  const issue = await getIssue(id);
  const cur = (issue.custom_fields ?? []).find((/** @type {{ id: number }} */ f) => f.id === fieldId);
  if (cur && cur.value === value) {
    log(`issue ${id}: Severidade já = ${value}`);
    return;
  }
  const put = await api('PUT', `/issues/${id}.json`, { issue: { custom_fields: [{ id: fieldId, value }] } });
  if (put.status !== 204 && put.status !== 200) {
    throw new Error(`PUT custom field issue ${id} falhou: status ${put.status} — ${put.text}`);
  }
  log(`issue ${id}: Severidade = ${value}`);
}

/**
 * Torna `childId` filha de `parentId` via PUT parent_issue_id. Idempotente.
 * @param {number} childId
 * @param {number} parentId
 */
async function ensureParent(childId, parentId) {
  const issue = await getIssue(childId);
  if (issue.parent?.id === parentId) {
    log(`issue ${childId}: parent já = ${parentId}`);
    return;
  }
  const put = await api('PUT', `/issues/${childId}.json`, { issue: { parent_issue_id: parentId } });
  if (put.status !== 204 && put.status !== 200) {
    throw new Error(`PUT parent issue ${childId} falhou: status ${put.status} — ${put.text}`);
  }
  log(`issue ${childId}: parent = ${parentId}`);
}

/**
 * Cria uma relation entre duas issues, se ainda não existir (em qualquer
 * direção). Idempotente.
 * @param {number} fromId
 * @param {number} toId
 * @param {string} type ex.: 'relates'
 */
async function ensureRelation(fromId, toId, type) {
  const got = await api('GET', `/issues/${fromId}/relations.json`);
  if (got.status !== 200) {
    throw new Error(`GET relations issue ${fromId} falhou: status ${got.status} — ${got.text}`);
  }
  const exists = (got.json?.relations ?? []).some(
    (/** @type {{ issue_id: number, issue_to_id: number }} */ r) =>
      (r.issue_id === fromId && r.issue_to_id === toId) || (r.issue_id === toId && r.issue_to_id === fromId),
  );
  if (exists) {
    log(`issue ${fromId}: relation com ${toId} já existe`);
    return;
  }
  const post = await api('POST', `/issues/${fromId}/relations.json`, {
    relation: { issue_to_id: toId, relation_type: type },
  });
  if (post.status !== 201) {
    throw new Error(`POST relation ${fromId}->${toId} falhou: status ${post.status} — ${post.text}`);
  }
  log(`issue ${fromId}: relation ${type} -> ${toId} criada`);
}

/**
 * Faz upload de um conteúdo de texto (octet-stream) e retorna o token.
 * @param {string} content
 * @returns {Promise<string>}
 */
async function uploadText(content) {
  const res = await fetch(BASE + '/uploads.json', {
    method: 'POST',
    headers: {
      Authorization: AUTH,
      'Content-Type': 'application/octet-stream',
      Accept: 'application/json',
    },
    body: Buffer.from(content, 'utf8'),
  });
  const text = await res.text();
  if (res.status !== 201) {
    throw new Error(`POST upload falhou: status ${res.status} — ${text}`);
  }
  const token = text ? JSON.parse(text)?.upload?.token : null;
  if (!token) {
    throw new Error('POST upload não retornou token');
  }
  return token;
}

/**
 * Anexa um arquivo de texto à issue, se ainda não houver um com esse nome.
 * Idempotente (só faz upload quando vai realmente anexar).
 * @param {number} id
 * @param {string} filename
 * @param {string} content
 */
async function ensureAttachment(id, filename, content) {
  const issue = await getIssue(id, 'attachments');
  const has = (issue.attachments ?? []).some((/** @type {{ filename: string }} */ a) => a.filename === filename);
  if (has) {
    log(`issue ${id}: anexo ${filename} já presente`);
    return;
  }
  const token = await uploadText(content);
  const put = await api('PUT', `/issues/${id}.json`, {
    issue: { uploads: [{ token, filename, content_type: 'text/plain' }] },
  });
  if (put.status !== 204 && put.status !== 200) {
    throw new Error(`PUT anexo issue ${id} falhou: status ${put.status} — ${put.text}`);
  }
  log(`issue ${id}: anexo ${filename} criado`);
}

/**
 * Enriquece as 3 issues com journals, custom fields, parent/child, relation e
 * anexo — tudo idempotente. Ver o mapa de fixtures no topo do arquivo.
 * @param {number[]} ids ids alinhados ao array ISSUES
 */
async function enrichIssues(ids) {
  const fieldId = await severidadeFieldId();
  const id1 = ids[0];
  const id2 = ids[1];
  const id3 = ids[2];
  if (id1 === undefined || id2 === undefined || id3 === undefined) {
    throw new Error('enrichIssues: esperava 3 ids resolvidos');
  }

  // Journal + custom field em todas as issues.
  for (let idx = 0; idx < ids.length; idx++) {
    const id = ids[idx];
    const fx = ISSUES[idx];
    if (id === undefined || fx === undefined) {
      continue;
    }
    await ensureJournal(id, `${JOURNAL_MARKER} ${fx.note}`);
    await ensureCustomField(id, fieldId, fx.severity);
  }

  // Estrutura entre issues: 3 é filha de 1; 1 se relaciona com 2.
  await ensureParent(id3, id1);
  await ensureRelation(id1, id2, 'relates');

  // Anexo de texto na issue 1.
  await ensureAttachment(id1, ATTACH_FILENAME, 'Anexo de fixture gerado pelo seed (rc-fixtures).\n');
}

/**
 * Asserções finais via GET. Lança se qualquer contagem/estrutura estiver errada.
 * Cobre: contagem de issues, journals >= 1, relations >= 1, anexo >= 1 e o
 * parent correto (issue 3 filha da issue 1).
 * @returns {Promise<number>} total de issues no projeto
 */
async function assertSeed() {
  const proj = await api('GET', `/projects/${PROJECT_ID}.json`);
  if (proj.status !== 200) {
    throw new Error(`ASSERT projeto: esperado 200, obtido ${proj.status}`);
  }
  const issues = await api('GET', `/issues.json?project_id=${PROJECT_ID}&status_id=*&limit=100`);
  if (issues.status !== 200) {
    throw new Error(`ASSERT issues: esperado 200, obtido ${issues.status}`);
  }
  const total = typeof issues.json?.total_count === 'number'
    ? issues.json.total_count
    : (issues.json?.issues?.length ?? 0);
  if (total < ISSUES.length) {
    throw new Error(`ASSERT contagem: esperado >= ${ISSUES.length}, obtido ${total}`);
  }

  const ids = await resolveIssueIds();
  const id1 = ids[0];
  const id3 = ids[2];
  if (id1 === undefined || id3 === undefined) {
    throw new Error('ASSERT: não resolvi os ids das issues');
  }

  const i1 = await getIssue(id1, 'journals,attachments');
  const journals = (i1.journals ?? []).filter((/** @type {{ notes?: string }} */ j) => j.notes).length;
  if (journals < 1) {
    throw new Error(`ASSERT journals: esperado >= 1 na issue ${id1}, obtido ${journals}`);
  }
  const attachments = (i1.attachments ?? []).length;
  if (attachments < 1) {
    throw new Error(`ASSERT anexos: esperado >= 1 na issue ${id1}, obtido ${attachments}`);
  }

  const rel = await api('GET', `/issues/${id1}/relations.json`);
  if (rel.status !== 200) {
    throw new Error(`ASSERT relations: esperado 200, obtido ${rel.status}`);
  }
  const relations = rel.json?.relations?.length ?? 0;
  if (relations < 1) {
    throw new Error(`ASSERT relations: esperado >= 1 na issue ${id1}, obtido ${relations}`);
  }

  const child = await getIssue(id3);
  if (child.parent?.id !== id1) {
    throw new Error(`ASSERT parent: issue ${id3} deveria ter parent ${id1}, obtido ${child.parent?.id}`);
  }

  log(
    `asserções OK: issues total=${total} (>= ${ISSUES.length}), journals=${journals}, ` +
    `anexos=${attachments}, relations=${relations}, parent(${id3})=${id1}`,
  );
  return total;
}

async function main() {
  log(`alvo: ${BASE} (usuário ${USER})`);
  await preflightAuth();
  await ensureProject();
  await ensureIssues();
  const ids = await resolveIssueIds();
  await enrichIssues(ids);
  const total = await assertSeed();
  log(`seed concluído. issues no projeto: ${total}`);
}

main().catch((err) => {
  log(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
