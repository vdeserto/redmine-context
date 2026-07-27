#!/usr/bin/env node
// @ts-check
//
// record-fixtures.mjs — Grava as interações HTTP do Redmine seedado como
// fixtures versionadas para o REPLAY OFFLINE do M5-06 (issue #81).
//
// PRESSUPOSTO: o stack de teste (docker/docker-compose.yml) JÁ ESTÁ up e
// SEEDADO — rode `npm run ci:e2e:up` (#79) antes. Este script NÃO sobe nem
// derruba nada: só EXERCITA o Redmine real e grava as respostas HTTP que o
// fluxo `getIssue → normalize → bundle` (e o download de anexo) consome.
//
// O arquivo gerado (tests/fixtures/redmine-e2e/interactions.json) é
// REPRODUZIDO offline por tests/integration/redmine-replay.test.ts em qualquer
// SO (macOS/Windows/Linux), sem docker e sem rede — cobertura E2E-equivalente
// na matriz do CI (#77) onde o Docker não está disponível.
//
// SEGREDOS REDIGIDOS (CRÍTICO, ADR-003): a api_key nunca é gravada. Ela viaja
// apenas no header X-Redmine-API-Key (que NÃO é serializado) e este script:
//   1) redige recursivamente qualquer campo cujo nome bata em
//      api_key/token/password/authorization → "[REDACTED]";
//   2) reescreve a URL base real (http://localhost:3080) para o placeholder
//      estável https://redmine.example (também some com o host local);
//   3) ao final, ABORTA se a api_key real ainda aparecer no arquivo.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'tests', 'fixtures', 'redmine-e2e');
const OUT_FILE = join(OUT_DIR, 'interactions.json');

const BASE = (process.env.REDMINE_URL ?? 'http://localhost:3080').replace(/\/+$/, '');
const USER = process.env.REDMINE_ADMIN_USER ?? 'admin';
const PASS = process.env.REDMINE_ADMIN_PASSWORD ?? 'admin';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

/** Placeholder estável que substitui a URL base real nas fixtures versionadas. */
const CANONICAL_BASE = 'https://redmine.example';
/** Placeholder de valor redigido. */
const REDACTED = '[REDACTED]';

/** Subjects das fixtures (chave de idempotência do seed), na ordem base 1..3. */
const SUBJECTS = ['RC Fixture: issue base 1', 'RC Fixture: issue base 2', 'RC Fixture: issue base 3'];
/** Include padrão do detalhe de issue (deve casar com src/client/issues.ts). */
const ISSUE_INCLUDE = 'journals,attachments,relations,children';
/** Nome do anexo de texto que o seed cria na issue base 1. */
const ATTACH_FILENAME = 'fixture-note.txt';

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

/** Nomes de campo cujo VALOR deve ser redigido (defesa em profundidade). */
const SECRET_KEY = /(^|_)(api_?key|token|password|passwd|authorization|secret)($|_)/i;

/**
 * Redige recursivamente valores de campos sensíveis e reescreve a URL base real
 * para o placeholder canônico. Preserva a forma; só troca segredos e o host.
 * @param {unknown} value
 * @returns {unknown}
 */
function redact(value) {
  if (typeof value === 'string') {
    return value.split(BASE).join(CANONICAL_BASE);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}

async function main() {
  log(`alvo: ${BASE} (stack assumido up+seedado via ci:e2e:up)`);
  const apiKey = await fetchAdminApiKey();
  const ids = await resolveIds();

  /** @type {any[]} */
  const interactions = [];

  // 1) Detalhe completo das 3 issues (o que o getIssue do core consome).
  for (const id of ids) {
    const path = `/issues/${id}.json`;
    const got = await apiKeyGet(apiKey, `${path}?include=${ISSUE_INCLUDE}`, 'json');
    if (got.status !== 200) fail(`GET ${path} respondeu ${got.status}`);
    const body = redact(JSON.parse(got.text ?? 'null'));
    interactions.push({
      method: 'GET',
      path,
      query: { include: ISSUE_INCLUDE },
      status: got.status,
      statusText: got.statusText,
      bodyKind: 'json',
      body,
    });
    log(`gravado: GET ${path} (${got.text?.length ?? 0} bytes de JSON)`);
  }

  // 2) Download do anexo de texto da issue base 1 (o que o downloadAttachment consome).
  const id1 = ids[0];
  const detail = await apiBasic(`/issues/${id1}.json?include=attachments`);
  const attachment = (detail.json?.issue?.attachments ?? []).find(
    (/** @type {any} */ a) => a.filename === ATTACH_FILENAME,
  );
  if (!attachment) fail(`anexo "${ATTACH_FILENAME}" não encontrado na issue ${id1} (seed ok?)`);
  const downloadPath = `/attachments/download/${attachment.id}/${encodeURIComponent(ATTACH_FILENAME)}`;
  const bin = await apiKeyGet(apiKey, downloadPath, 'binary');
  if (bin.status !== 200 || !bin.bytes) fail(`download do anexo respondeu ${bin.status}`);
  interactions.push({
    method: 'GET',
    path: downloadPath,
    query: {},
    status: bin.status,
    statusText: bin.statusText,
    bodyKind: 'base64',
    body: bin.bytes.toString('base64'),
  });
  log(`gravado: GET ${downloadPath} (${bin.bytes.length} bytes binários)`);

  const fixture = {
    schemaVersion: '1.0',
    recordedWith: 'scripts/record-fixtures.mjs',
    note:
      'Fixtures HTTP do Redmine seedado (projeto rc-fixtures) para REPLAY OFFLINE (issue #81, M5-06). ' +
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

  // GUARDA FINAL: a api_key real NUNCA pode estar no arquivo versionado.
  if (serialized.includes(apiKey)) {
    fail('ABORTADO: a api_key real vazou para o arquivo de fixtures — verifique a redação.');
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, serialized, 'utf8');
  log(`OK: ${interactions.length} interações gravadas em ${OUT_FILE}`);
  log('segredos redigidos e api_key ausente do arquivo (verificado).');
}

main().catch((err) => {
  log(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
