#!/usr/bin/env node
// @ts-check
//
// record-fixtures.mjs — Grava as interações HTTP do Redmine seedado como
// fixtures versionadas para o REPLAY OFFLINE do M5-06 (issue #81).
//
// PRESSUPOSTO: o stack de teste (docker/docker-compose.yml) JÁ ESTÁ up e
// SEEDADO — rode `npm run ci:e2e:up` (#79) antes. Este script NÃO sobe nem
// derruba nada: só EXERCITA o Redmine real e grava as respostas HTTP que o
// fluxo `getIssue → normalize → bundle` (e o download de anexo) consome, mais
// os endpoints de nomes do M8/M9 (enumerações, memberships, versões, categorias,
// /users/:id, /custom_fields.json, /issues.json?issue_id=) com seus 403/404.
// A lista fixa vem de scripts/lib/record-plan.mjs (#260); cada interação leva o
// rótulo `case` do caso de origem, e status diferente do planejado aborta.
//
// O arquivo gerado (tests/fixtures/redmine-e2e/interactions.json) é
// REPRODUZIDO offline por tests/integration/redmine-replay.test.ts em qualquer
// SO (macOS/Windows/Linux), sem docker e sem rede — cobertura E2E-equivalente
// na matriz do CI (#77) onde o Docker não está disponível.
//
// SEGREDOS REDIGIDOS (CRÍTICO, ADR-003): nenhuma api_key é gravada — nem a do
// admin nem a do não-admin seed-ana (que grava os 403/404). Elas viajam
// apenas no header X-Redmine-API-Key (que NÃO é serializado) e este script:
//   1) redige recursivamente qualquer campo cujo nome bata em
//      api_key/token/password/authorization → "[REDACTED]" (scripts/lib/record-body.mjs);
//   2) reescreve a URL base real (http://localhost:3080) para o placeholder
//      estável https://redmine.example (também some com o host local);
//   3) ao final, ABORTA se alguma das api_keys reais aparecer no arquivo.
//
// Uso (com o stack já up+seedado):
//   npm run ci:e2e:up && npm run record:fixtures
//
// Config via ambiente (defaults combinam com o compose de teste):
//   REDMINE_URL             (default http://localhost:3080)
//   REDMINE_ADMIN_USER      (default admin)
//   REDMINE_ADMIN_PASSWORD  (default admin)

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_BASE, recordedBody } from './lib/record-body.mjs';
import { ATTACH_FILENAME, recordingPlan, requestUrl } from './lib/record-plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'tests', 'fixtures', 'redmine-e2e');
const OUT_FILE = join(OUT_DIR, 'interactions.json');

const BASE = (process.env.REDMINE_URL ?? 'http://localhost:3080').replace(/\/+$/, '');
const USER = process.env.REDMINE_ADMIN_USER ?? 'admin';
const PASS = process.env.REDMINE_ADMIN_PASSWORD ?? 'admin';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');


/** Subjects das fixtures (chave de idempotência do seed), na ordem base 1..3. */
const SUBJECTS = ['RC Fixture: issue base 1', 'RC Fixture: issue base 2', 'RC Fixture: issue base 3'];
/** Não-admin cuja api_key grava os 403/404 e usuário bloqueado do seed (seed-users.mjs). */
const NON_ADMIN_LOGIN = 'seed-ana';
const LOCKED_LOGIN = 'seed-carla';

/** Loga uma linha em stderr (o eslint proíbe console; script de infra). */
const log = (/** @type {string} */ msg) => process.stderr.write(`[record] ${msg}\n`);

/** Aborta com erro (sai != 0). */
function fail(/** @type {string} */ msg) {
  throw new Error(msg);
}

/**
 * Chama a REST do Redmine com Basic auth admin (para DESCOBRIR a api_key e ids).
 * @param {string} path
 * @returns {Promise<{ status: number, json: any }>}
 */
async function apiBasic(path) {
  const res = await fetch(BASE + path, {
    method: 'GET',
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/**
 * GET autenticado por api_key (X-Redmine-API-Key) — MESMO mecanismo do client
 * (src/client/http.ts). Devolve status/statusText + corpo bruto (texto ou bytes).
 * @param {string} apiKey
 * @param {string} path
 * @param {'json'|'binary'} kind
 * @returns {Promise<{ status: number, statusText: string, text?: string, bytes?: Buffer }>}
 */
async function apiKeyGet(apiKey, path, kind) {
  const res = await fetch(BASE + path, {
    method: 'GET',
    headers: { 'X-Redmine-API-Key': apiKey, Accept: kind === 'json' ? 'application/json' : '*/*' },
  });
  if (kind === 'json') {
    const text = await res.text();
    return { status: res.status, statusText: res.statusText, text };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, statusText: res.statusText, bytes };
}

/** Descobre a api_key do admin via /users/current.json (Basic auth). */
async function fetchAdminApiKey() {
  const me = await apiBasic('/users/current.json');
  const key = me.json?.user?.api_key;
  if (me.status !== 200 || typeof key !== 'string' || key.length === 0) {
    fail(`não obtive a api_key do admin (status ${me.status}); o stack está up+seedado (ci:e2e:up)?`);
  }
  log(`api_key do admin obtida (len ${key.length}) — NÃO será gravada`);
  return key;
}

/**
 * Ids de seed-ana e seed-carla e a api_key da seed-ana (lida com o admin, nunca logada).
 * @returns {Promise<{ activeUserId: number, lockedUserId: number, nonAdminKey: string }>}
 */
async function resolveUsers() {
  const got = await apiBasic('/users.json?status=*&limit=100');
  if (got.status !== 200) fail(`GET users falhou: status ${got.status}`);
  /** @type {Record<string, number>} */
  const idByLogin = {};
  for (const user of got.json?.users ?? []) {
    idByLogin[user.login] = user.id;
  }
  const activeUserId = idByLogin[NON_ADMIN_LOGIN];
  const lockedUserId = idByLogin[LOCKED_LOGIN];
  if (activeUserId === undefined || lockedUserId === undefined) {
    fail(`não achei ${NON_ADMIN_LOGIN}/${LOCKED_LOGIN} — o seed rodou (ci:e2e:up)?`);
  }
  const nonAdmin = await apiBasic(`/users/${activeUserId}.json`);
  const nonAdminKey = nonAdmin.json?.user?.api_key;
  if (typeof nonAdminKey !== 'string' || nonAdminKey.length === 0) {
    fail(`não obtive a api_key de ${NON_ADMIN_LOGIN} (status ${nonAdmin.status})`);
  }
  log(`usuários: ${NON_ADMIN_LOGIN}=${activeUserId}, ${LOCKED_LOGIN}=${lockedUserId}`);
  log(`api_key de ${NON_ADMIN_LOGIN} obtida — NÃO será gravada`);
  return { activeUserId, lockedUserId, nonAdminKey };
}

/** Resolve os ids das 3 fixtures por subject (na ordem base 1..3). */
async function resolveIds() {
  const got = await apiBasic('/issues.json?project_id=rc-fixtures&status_id=*&limit=100');
  if (got.status !== 200) fail(`GET issues falhou: status ${got.status} — o seed rodou (ci:e2e:up)?`);
  const bySubject = new Map((got.json?.issues ?? []).map((/** @type {any} */ i) => [i.subject, i.id]));
  const ids = SUBJECTS.map((s) => {
    const id = bySubject.get(s);
    if (typeof id !== 'number') fail(`não achei o id da fixture "${s}" — o seed rodou?`);
    return id;
  });
  log(`ids das fixtures: base1=${ids[0]}, base2=${ids[1]}, base3=${ids[2]}`);
  return ids;
}

async function main() {
  log(`alvo: ${BASE} (stack assumido up+seedado via ci:e2e:up)`);
  const apiKey = await fetchAdminApiKey();
  const ids = await resolveIds();
  const { activeUserId, lockedUserId, nonAdminKey } = await resolveUsers();
  const keys = { admin: apiKey, nonAdmin: nonAdminKey };

  const id1 = ids[0];
  const detail = await apiBasic(`/issues/${id1}.json?include=attachments`);
  let attachment;
  for (const candidate of detail.json?.issue?.attachments ?? []) {
    if (candidate.filename === ATTACH_FILENAME) {
      attachment = candidate;
    }
  }
  if (!attachment) fail(`anexo "${ATTACH_FILENAME}" não encontrado na issue ${id1} (seed ok?)`);

  const planIds = { issueIds: ids, attachmentId: attachment.id, activeUserId, lockedUserId };
  /** @type {any[]} */
  const interactions = [];
  let downloadPath = '';
  for (const request of recordingPlan(planIds)) {
    const url = requestUrl(request);
    const got = await apiKeyGet(keys[request.as], url, request.kind);
    if (got.status !== request.status) {
      fail(`GET ${url} (${request.case}, como ${request.as}) respondeu ${got.status}, esperado ${request.status}`);
    }
    if (request.kind === 'binary') {
      downloadPath = request.path;
    }
    interactions.push({
      case: request.case,
      method: 'GET',
      path: request.path,
      query: request.query,
      status: got.status,
      statusText: got.statusText,
      ...recordedBody(request, url, got, BASE),
    });
    log(`gravado: GET ${request.path} → ${got.status} (${request.case})`);
  }

  const fixture = {
    schemaVersion: '1.0',
    recordedWith: 'scripts/record-fixtures.mjs',
    note:
      'Fixtures HTTP do Redmine seedado (projetos rc-fixtures e rc-fixtures-2) para REPLAY OFFLINE ' +
      '(#81, M5-06; endpoints de nomes com 403/404 e rótulo `case` por interação: #260). ' +
      'Segredos redigidos: nenhuma api_key/senha/Authorization real. URL base reescrita para ' +
      `${CANONICAL_BASE}. Regravar com: npm run ci:e2e:up && npm run record:fixtures.`,
    baseUrl: CANONICAL_BASE,
    baseIssueIds: ids,
    attachment: {
      issueId: id1,
      attachmentId: attachment.id,
      filename: ATTACH_FILENAME,
      downloadPath,
    },
    interactions,
  };

  const serialized = JSON.stringify(fixture, null, 2) + '\n';

  // GUARDA FINAL: nenhuma api_key real pode estar no arquivo versionado.
  for (const who in keys) {
    if (serialized.includes(keys[who])) {
      fail(`ABORTADO: a api_key real (${who}) vazou para o arquivo de fixtures — verifique a redação.`);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, serialized, 'utf8');
  log(`OK: ${interactions.length} interações gravadas em ${OUT_FILE}`);
  log('segredos redigidos e api_keys ausentes do arquivo (verificado).');
}

main().catch((err) => {
  log(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
