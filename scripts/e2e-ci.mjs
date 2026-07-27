#!/usr/bin/env node
// @ts-check
//
// e2e-ci.mjs — Validação E2E do redmine-context para o job de CI (issue #80).
//
// PRESSUPOSTO: o stack de teste (docker/docker-compose.yml) JÁ ESTÁ de pé e
// SEEDADO — o workflow roda `npm run ci:e2e:up` (#79) antes deste script, e faz
// o `docker compose down -v` no teardown (always()). Este script NÃO sobe nem
// derruba nada: só exercita e assere o comportamento real contra o Redmine
// seedado em http://localhost:3080.
//
// Cobre os ACs da #80:
//   1. CLI    — `issue <id>` (Markdown) contra o seed → valida que o bundle
//               contém as strings das fixtures (subject/journal/severidade/anexo/
//               relations/parent). Compara contra o esperado do seed.
//   2. MCP    — sobe o server `mcp` (stdio) e chama `get_issue_context(<id>)` via
//               um cliente JSON-RPC mínimo → o texto DEVE ser byte-idêntico à CLI.
//   3a. Seg.  — `http://` SEM `--insecure` é RECUSADO (exit != 0, TLS obrigatório).
//   3b. Seg.  — anexo > limite é PULADO: baixa o anexo real da fixture com um teto
//               de 1 byte e assere o `SkippedDownload` (pré-check do downloader).
//
// Node puro (mesmo estilo de seed.mjs/e2e.mjs): loga em stderr, sai != 0 em
// qualquer falha. Reusa o cliente MCP stdio do e2e.mjs (M1-14) e as expectativas
// derivadas do seed.
//
// Uso (com o stack já up+seedado):
//   npm run build && npm run ci:e2e:up && node scripts/e2e-ci.mjs
//
// Config via ambiente (defaults combinam com o compose de teste):
//   REDMINE_URL             (default http://localhost:3080)
//   REDMINE_ADMIN_USER      (default admin)
//   REDMINE_ADMIN_PASSWORD  (default admin)

import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(ROOT, 'dist', 'surfaces', 'cli', 'main.js');

const BASE = (process.env.REDMINE_URL ?? 'http://localhost:3080').replace(/\/+$/, '');
const USER = process.env.REDMINE_ADMIN_USER ?? 'admin';
const PASS = process.env.REDMINE_ADMIN_PASSWORD ?? 'admin';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

/** Loga uma linha em stderr (o eslint proíbe console; script de infra). */
const log = (/** @type {string} */ msg) => process.stderr.write(`[e2e-ci] ${msg}\n`);

/** Subjects das fixtures (chave de idempotência do seed), na ordem base 1..3. */
const SUBJECTS = ['RC Fixture: issue base 1', 'RC Fixture: issue base 2', 'RC Fixture: issue base 3'];

/** Nome do anexo de texto que o seed cria na issue base 1. */
const ATTACH_FILENAME = 'fixture-note.txt';

/**
 * Roda um comando e resolve com {code, stdout, stderr}. Nunca rejeita por exit
 * != 0 (o chamador decide).
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...opts.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/** Aborta o passo atual com erro (sai != 0). */
function fail(/** @type {string} */ msg) {
  throw new Error(msg);
}

/**
 * Chama a REST do Redmine com Basic auth admin.
 * @param {string} method @param {string} path
 * @returns {Promise<{ status: number, ok: boolean, json: any, text: string }>}
 */
async function api(method, path) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

/** Descobre a api_key do admin via /users/current.json (fluxo real, Basic auth). */
async function fetchAdminApiKey() {
  const me = await api('GET', '/users/current.json');
  const key = me.json?.user?.api_key;
  if (me.status !== 200 || typeof key !== 'string' || key.length === 0) {
    fail(`não obtive a api_key do admin (status ${me.status}); o stack está up+seedado (ci:e2e:up)?`);
  }
  log(`api_key do admin obtida (len ${key.length})`);
  return key;
}

/** Resolve os ids das 3 fixtures por subject (na ordem base 1..3). */
async function resolveIds() {
  const got = await api('GET', '/issues.json?project_id=rc-fixtures&status_id=*&limit=100');
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

/** Roda a CLI `issue <id>` (Markdown) contra o ambiente, com api_key na env. */
async function cliIssue(/** @type {number} */ id, /** @type {string} */ apiKey, /** @type {string[]} */ extraArgs = []) {
  return run('node', [CLI, 'issue', String(id), '--url', BASE, '--insecure', ...extraArgs], {
    env: { REDMINE_API_KEY: apiKey, REDMINE_URL: BASE },
  });
}

/**
 * Cliente JSON-RPC stdio mínimo: sobe `mcp` como subprocess, faz o handshake e
 * chama a tool `get_issue_context`. Sem dependência — lê o stdout linha-a-linha.
 * @param {string} apiKey
 * @param {{ issue_id: number, format?: 'markdown'|'json' }} args
 * @returns {Promise<{ text: string, isError: boolean }>}
 */
function mcpGetIssueContext(apiKey, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI, 'mcp'], {
      cwd: ROOT,
      env: { ...process.env, REDMINE_URL: BASE, REDMINE_API_KEY: apiKey, REDMINE_INSECURE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    /** @type {Map<number, (msg: any) => void>} */
    const pending = new Map();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timeout no cliente MCP (sem resposta em 30s)'));
    }, 30000);

    const send = (/** @type {unknown} */ obj) => child.stdin.write(JSON.stringify(obj) + '\n');
    /** @type {{ (method: string, params: unknown): Promise<any>, next: number }} */
    const request = Object.assign(
      (/** @type {string} */ method, /** @type {unknown} */ params) =>
        new Promise((res) => {
          const id = request.next++;
          pending.set(id, res);
          send({ jsonrpc: '2.0', id, method, params });
        }),
      { next: 1 },
    );

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // linha não-JSON: ignora (não deveria ocorrer no stdio)
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const res = pending.get(msg.id);
          pending.delete(msg.id);
          if (res) res(msg);
        }
      }
    });
    child.on('error', reject);

    (async () => {
      const init = await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-ci-mcp-client', version: '0.0.0' },
      });
      if (init.error) throw new Error(`initialize falhou: ${JSON.stringify(init.error)}`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });

      const call = await request('tools/call', { name: 'get_issue_context', arguments: args });
      if (call.error) throw new Error(`tools/call falhou: ${JSON.stringify(call.error)}`);
      const content = call.result?.content ?? [];
      const text = content.map((/** @type {any} */ c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      resolve({ text, isError: Boolean(call.result?.isError) });
    })().catch((err) => {
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(err);
    });
  });
}

/** Verifica que todas as `needles` aparecem em `hay`. */
function grepAll(/** @type {string} */ label, /** @type {string} */ hay, /** @type {string[]} */ needles) {
  const missing = needles.filter((n) => !hay.includes(n));
  if (missing.length > 0) {
    process.stderr.write(`\n--- bundle de ${label} ---\n${hay}\n--- fim ---\n`);
    fail(`${label}: strings ausentes no bundle: ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
  }
  log(`${label}: OK — ${needles.length} strings de fixture presentes`);
}

/** Expectativas de conteúdo por issue, derivadas das fixtures do seed.mjs. */
function expectationsFor(/** @type {number[]} */ ids) {
  const [id1, id2, id3] = ids;
  return {
    [id1]: [
      'Issue base 1 gerada pelo seed',
      'Comentário de fixture na issue base 1',
      'Severidade',
      'Alta',
      ATTACH_FILENAME,
      'relates',
      `issue #${id2}`, // relation -> base 2
      `issue #${id3}`, // sub-issue (child base 3)
    ],
    [id2]: ['Issue base 2 gerada pelo seed', 'Comentário de fixture na issue base 2', 'Média', 'relates'],
    [id3]: [
      'Issue base 3 gerada pelo seed',
      'Comentário de fixture na issue base 3',
      'Baixa',
      'Issue Pai',
      `issue #${id1}`, // parent base 1
    ],
  };
}

/**
 * Segurança (b): anexo > limite é PULADO. Exercita o downloader REAL contra o
 * anexo de fixture da issue base 1, com um teto de 1 byte: o pré-check pelo
 * `filesize` reportado pelo Redmine devolve um SkippedDownload (degradação
 * graciosa, sem exceção) — sem sequer iniciar o download.
 * @param {number} issueId @param {string} apiKey
 */
async function assertAttachmentOverLimitSkipped(issueId, apiKey) {
  // Importa do core compilado (script de infra pode alcançar o dist).
  const { createHttpClient, getIssue, normalizeIssue } = await import(
    join(ROOT, 'dist', 'index.js')
  );
  const { downloadAttachment, isSkipped } = await import(join(ROOT, 'dist', 'extract', 'download.js'));

  const http = createHttpClient({ baseUrl: BASE, apiKey, insecure: true });
  const issue = normalizeIssue(await getIssue(http, issueId));
  const attachment = (issue.attachments ?? []).find(
    (/** @type {any} */ a) => a.filename === ATTACH_FILENAME,
  );
  if (!attachment) fail(`anexo "${ATTACH_FILENAME}" não encontrado na issue ${issueId} (seed ok?)`);
  if (!(attachment.filesize > 1)) fail(`anexo com filesize inesperado (${attachment.filesize}); teste de limite inviável`);

  const cacheDir = await mkdtemp(join(tmpdir(), 'rc-e2e-limit-'));
  const result = await downloadAttachment(http, attachment, { cacheDir, instanceUrl: BASE, maxBytes: 1 });
  if (!isSkipped(result)) {
    fail(`esperava anexo PULADO com maxBytes=1, mas o download retornou: ${JSON.stringify(result)}`);
  }
  if (!/excede o limite/i.test(result.reason)) {
    fail(`anexo pulado sem a razão esperada: ${result.reason}`);
  }
  log(`segurança OK: anexo > limite pulado (${attachment.filesize} B > 1 B) — "${result.reason}"`);
}

async function main() {
  log(`alvo: ${BASE} (stack assumido up+seedado via ci:e2e:up)`);

  // Credencial real (api_key do admin) + ids das fixtures.
  const apiKey = await fetchAdminApiKey();
  const ids = await resolveIds();
  const expects = expectationsFor(ids);

  // 1) CLI: as 3 issues, validando as strings das fixtures do seed.
  /** @type {Record<number, string>} */
  const cliBundles = {};
  for (const id of ids) {
    const r = await cliIssue(id, apiKey);
    if (r.code !== 0) fail(`CLI issue ${id} saiu ${r.code}: ${r.stderr}`);
    cliBundles[id] = r.stdout;
    grepAll(`CLI issue ${id}`, r.stdout, expects[id]);
  }

  // 2) MCP == CLI (byte-idêntico) para as 3 issues.
  for (const id of ids) {
    const mcp = await mcpGetIssueContext(apiKey, { issue_id: id, format: 'markdown' });
    if (mcp.isError) fail(`MCP get_issue_context(${id}) retornou isError: ${mcp.text}`);
    if (mcp.text !== cliBundles[id]) {
      process.stderr.write(`\n[MCP]\n${mcp.text}\n[CLI]\n${cliBundles[id]}\n`);
      fail(`MCP != CLI para a issue ${id} (bundles divergem)`);
    }
    log(`MCP == CLI para a issue ${id} (byte-idêntico, ${mcp.text.length} bytes)`);
  }

  // 3a) Segurança: http:// SEM --insecure deve ser recusado (exit != 0).
  const refused = await run('node', [CLI, 'issue', String(ids[0]), '--url', BASE], {
    env: { REDMINE_API_KEY: apiKey },
  });
  if (refused.code === 0) fail('esperava exit != 0 ao usar http:// sem --insecure, obtive 0');
  if (!/recusada|http:\/\//i.test(refused.stderr)) {
    fail(`recusa de http:// sem a mensagem esperada: ${refused.stderr}`);
  }
  log(`segurança OK: http:// recusado sem --insecure (exit ${refused.code}, TLS obrigatório)`);

  // 3b) Segurança: anexo > limite pulado (downloader real, pré-check por filesize).
  await assertAttachmentOverLimitSkipped(ids[0], apiKey);

  log('E2E OK: CLI valida o seed, MCP == CLI, http:// recusado e anexo > limite pulado.');
  log(`RESUMO: ids=${ids.join(',')}; mcp==cli em 3 issues; 2 cenários de segurança verdes.`);
}

main().catch((err) => {
  log(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
