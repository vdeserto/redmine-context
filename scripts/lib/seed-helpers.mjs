// @ts-check
//
// seed-helpers.mjs — chamada REST, log e idempotência por marca do seed (#254).
//
// Marca = valor que identifica uma entidade criada pelo seed: login do usuário,
// identifier do projeto, nome da versão/categoria, prefixo das notes do journal.
// O campo casa com a marca quando é igual a ela ou começa com ela seguida de
// espaço — assim `rc-fixtures` não casa com `rc-fixtures-2`, e `[seed]` casa com
// `[seed] Comentário...`. Antes de criar, `ensureByMarker` lista a coleção do
// tipo e só chama `create` se nenhuma entrada tiver a marca.

export const BASE = (process.env.REDMINE_URL ?? 'http://localhost:3080').replace(/\/+$/, '');
export const USER = process.env.REDMINE_ADMIN_USER ?? 'admin';
const PASS = process.env.REDMINE_ADMIN_PASSWORD ?? 'admin';
export const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

/**
 * Onde listar cada tipo e em qual campo a marca aparece. `{parent}` é o
 * projeto (versão, categoria) ou a issue (journal) dono da coleção.
 */
const MARKER_LOOKUP = {
  user: { path: '/users.json?status=*&limit=100', list: 'users', field: 'login' }, // status=* inclui bloqueados
  project: { path: '/projects.json?limit=100', list: 'projects', field: 'identifier' },
  version: { path: '/projects/{parent}/versions.json', list: 'versions', field: 'name' },
  category: { path: '/projects/{parent}/issue_categories.json', list: 'issue_categories', field: 'name' },
  journal: { path: '/issues/{parent}.json?include=journals', list: 'journals', field: 'notes' },
};

/** Loga uma linha em stderr (o eslint proíbe console; isto é script de infra). */
export function log(msg) {
  process.stderr.write(`[seed] ${msg}\n`);
}

/**
 * Chama a REST API do Redmine com Basic auth.
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<{ status: number, ok: boolean, json: any, text: string }>}
 */
export async function api(method, path, body) {
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
 * Devolve a entidade do tipo `kind` que tem a marca; se nenhuma tiver, chama
 * `create` e devolve o resultado dele.
 * @param {string} kind user | project | version | category | journal
 * @param {string} marker
 * @param {() => Promise<any>} create
 * @param {string | number} [parent] projeto (version, category) ou issue (journal)
 * @returns {Promise<any>}
 */
export async function ensureByMarker(kind, marker, create, parent) {
  const lookup = MARKER_LOOKUP[kind];
  if (!lookup) {
    throw new Error(`ensureByMarker: tipo desconhecido '${kind}'`);
  }
  const path = lookup.path.replace('{parent}', String(parent));
  const label = parent === undefined ? `${kind} ${marker}` : `${kind} ${marker} (${parent})`;
  const got = await api('GET', path);
  if (got.status !== 200) {
    throw new Error(`GET ${path} falhou: status ${got.status} — ${got.text}`);
  }
  // Journals vêm dentro da issue; as demais coleções, na raiz.
  const holder = got.json?.issue ?? got.json;
  for (const item of holder?.[lookup.list] ?? []) {
    const value = item[lookup.field];
    if (value === marker || (typeof value === 'string' && value.startsWith(`${marker} `))) {
      log(`${label}: já existe`);
      return item;
    }
  }
  const created = await create();
  log(`${label}: criado`);
  return created;
}

/**
 * GET de uma issue com includes opcionais (ex.: 'journals,attachments').
 * @param {number} id
 * @param {string} [include]
 * @returns {Promise<any>} objeto `issue`
 */
export async function getIssue(id, include) {
  const q = include ? `?include=${include}` : '';
  const got = await api('GET', `/issues/${id}.json${q}`);
  if (got.status !== 200) {
    throw new Error(`GET issue ${id} falhou: status ${got.status} — ${got.text}`);
  }
  return got.json.issue;
}

/**
 * PUT de campos numa issue; lança se o Redmine não responder 200/204.
 * @param {number} id
 * @param {Record<string, unknown>} fields conteúdo de `issue`
 * @param {string} what o que está sendo gravado, para a mensagem de erro
 */
export async function putIssue(id, fields, what) {
  const put = await api('PUT', `/issues/${id}.json`, { issue: fields });
  if (put.status !== 204 && put.status !== 200) {
    throw new Error(`PUT ${what} issue ${id} falhou: status ${put.status} — ${put.text}`);
  }
}

/**
 * Faz upload de bytes (octet-stream) e retorna o token.
 * @param {Buffer} bytes
 * @returns {Promise<string>}
 */
export async function uploadBytes(bytes) {
  const res = await fetch(BASE + '/uploads.json', {
    method: 'POST',
    headers: {
      Authorization: AUTH,
      'Content-Type': 'application/octet-stream',
      Accept: 'application/json',
    },
    body: bytes,
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
