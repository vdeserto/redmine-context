#!/usr/bin/env node
// @ts-check
//
// seed.mjs — Seed base de fixtures no Redmine via REST API.
//
// Cria 1 projeto (identifier fixo `rc-fixtures`) e 3 issues com descrição.
// É idempotente: cada recurso é verificado via GET antes do POST, então
// re-execuções não duplicam nada. Ao final, asserções via GET validam as
// contagens e o processo sai com código != 0 se algo estiver errado.
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

/** Fixtures determinísticas: subject é a chave de idempotência. */
const ISSUES = [
  {
    subject: 'RC Fixture: issue base 1',
    description: 'Issue base 1 gerada pelo seed (rc-fixtures). Texto simples para smoke tests.',
  },
  {
    subject: 'RC Fixture: issue base 2',
    description: 'Issue base 2 gerada pelo seed (rc-fixtures). Descrição com **markdown** leve.',
  },
  {
    subject: 'RC Fixture: issue base 3',
    description: 'Issue base 3 gerada pelo seed (rc-fixtures). Usada para validar contagens via GET.',
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
 * manual: o one-shot `enable-rest-api` habilita a REST e zera o
 * `must_change_passwd` do admin, e `load-default-data` carrega trackers/statuses.
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
 * Asserções finais via GET. Lança se qualquer contagem estiver errada.
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
  log(`asserções OK: projeto 200, issues total=${total} (>= ${ISSUES.length})`);
  return total;
}

async function main() {
  log(`alvo: ${BASE} (usuário ${USER})`);
  await preflightAuth();
  await ensureProject();
  await ensureIssues();
  const total = await assertSeed();
  log(`seed concluído. issues no projeto: ${total}`);
}

main().catch((err) => {
  log(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
