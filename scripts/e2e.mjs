#!/usr/bin/env node
// @ts-check
//
// e2e.mjs — Roteiro E2E de dogfood do redmine-context (issue #20 / M1-14).
//
// Valida o fluxo real ponta-a-ponta contra o ambiente Redmine descartável de
// `docker/`: sobe o stack (ou assume up), espera healthy + one-shots, roda o
// seed, builda, exercita a CLI para as 3 issues do seed (grep das strings das
// fixtures), sobe o MCP server como subprocess e chama `get_issue_context` via
// um cliente JSON-RPC stdio mínimo (initialize → initialized → tools/call),
// compara MCP vs CLI byte-a-byte, mede o tempo issue→bundle (cache quente),
// testa a recusa de http:// sem --insecure e faz o teardown (down -v).
//
// Node puro, sem dependência nova (mesmo estilo do seed.mjs): loga em stderr e
// sai com código != 0 em qualquer falha. O teardown roda sempre no final.
//
// Uso:
//   node scripts/e2e.mjs
//
// Config via ambiente (defaults combinam com o compose de teste):
//   REDMINE_URL             (default http://localhost:3080)
//   REDMINE_ADMIN_USER      (default admin)
//   REDMINE_ADMIN_PASSWORD  (default admin)
//   E2E_ASSUME_UP=1         não roda `up` (assume o stack já de pé)
//   E2E_NO_TEARDOWN=1       pula o `down -v` final (debug)

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMPOSE = join(ROOT, 'docker', 'docker-compose.yml');
const CLI = join(ROOT, 'dist', 'surfaces', 'cli', 'main.js');

const BASE = (process.env.REDMINE_URL ?? 'http://localhost:3080').replace(/\/+$/, '');
const USER = process.env.REDMINE_ADMIN_USER ?? 'admin';
const PASS = process.env.REDMINE_ADMIN_PASSWORD ?? 'admin';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const ASSUME_UP = /^(1|true)$/i.test(process.env.E2E_ASSUME_UP ?? '');
const NO_TEARDOWN = /^(1|true)$/i.test(process.env.E2E_NO_TEARDOWN ?? '');

/** Loga uma linha em stderr (o eslint proíbe console; script de infra). */
const log = (msg) => process.stderr.write(`[e2e] ${msg}\n`);

/** Subjects das fixtures (chave de idempotência do seed), na ordem base 1..3. */
const SUBJECTS = ['RC Fixture: issue base 1', 'RC Fixture: issue base 2', 'RC Fixture: issue base 3'];

/**
 * Roda um comando e resolve com {code, stdout, stderr}. Nunca rejeita por exit
 * != 0 (o chamador decide). stdout/stderr são capturados; stderr também pode ser
 * espelhado para o terminal quando `mirror` é true.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, mirror?: boolean }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...opts.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (opts.mirror) process.stderr.write(d);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/** Roda um `docker compose` sobre o compose de teste. */
function compose(args, opts = {}) {
  return run('docker', ['compose', '-f', COMPOSE, ...args], { mirror: true, ...opts });
}

/** Aborta o passo atual com erro (sai != 0 depois do teardown). */
function fail(msg) {
  throw new Error(msg);
}

/**
 * Chama a REST do Redmine com Basic auth admin.
 * @param {string} method @param {string} path @param {unknown} [body]
 */
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Bloqueia até o ambiente estar pronto: REST autenticando (admin), dados default
 * (trackers) e o one-shot enable-rest-api (custom field 'Severidade') concluídos.
 * @param {number} timeoutMs
 */
async function waitReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const me = await api('GET', '/users/current.json');
      if (me.status === 200 && me.json?.user?.id) {
        const cf = await api('GET', '/custom_fields.json');
        const has =
          cf.status === 200 &&
          (cf.json?.custom_fields ?? []).some((f) => f.name === 'Severidade');
        if (has) {
          log(`ambiente pronto: autenticado como ${me.json.user.login}, custom field Severidade ok`);
          return;
        }
        last = 'REST ok, aguardando one-shot enable-rest-api (custom field Severidade)';
      } else {
        last = `REST ainda não autentica (status ${me.status})`;
      }
    } catch (err) {
      last = `sem conexão (${err instanceof Error ? err.message : String(err)})`;
    }
    process.stderr.write('.');
    await sleep(3000);
  }
  process.stderr.write('\n');
  fail(`timeout esperando o ambiente ficar pronto — último estado: ${last}`);
}

/** Descobre a api_key do admin via /users/current.json (fluxo real, Basic auth). */
async function fetchAdminApiKey() {
  const me = await api('GET', '/users/current.json');
  const key = me.json?.user?.api_key;
  if (me.status !== 200 || typeof key !== 'string' || key.length === 0) {
    fail(`não obtive a api_key do admin (status ${me.status}); a REST expõe api_key só p/ o próprio/admin`);
  }
  log(`api_key do admin obtida (len ${key.length})`);
  return key;
}

/** Resolve os ids das 3 fixtures por subject (na ordem base 1..3). */
async function resolveIds() {
  const got = await api('GET', '/issues.json?project_id=rc-fixtures&status_id=*&limit=100');
  if (got.status !== 200) fail(`GET issues falhou: status ${got.status}`);
  const bySubject = new Map((got.json?.issues ?? []).map((i) => [i.subject, i.id]));
  const ids = SUBJECTS.map((s) => {
    const id = bySubject.get(s);
    if (typeof id !== 'number') fail(`não achei o id da fixture "${s}"`);
    return id;
  });
  log(`ids das fixtures resolvidos: base1=${ids[0]}, base2=${ids[1]}, base3=${ids[2]}`);
  return ids;
}

/** Roda a CLI `issue <id>` (Markdown) contra o ambiente, com api_key na env. */
async function cliIssue(id, apiKey, extraArgs = []) {
  return run('node', [CLI, 'issue', String(id), '--url', BASE, '--insecure', ...extraArgs], {
    env: { REDMINE_API_KEY: apiKey, REDMINE_URL: BASE },
  });
}

/**
 * Cliente JSON-RPC stdio mínimo: sobe `mcp` como subprocess, faz o handshake e
 * chama a tool. Sem dependência — lê mensagens do stdout linha-a-linha.
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
    const pending = new Map(); // id -> {resolve}
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timeout no cliente MCP (sem resposta em 30s)'));
    }, 30000);

    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
    const request = (method, params) =>
      new Promise((res) => {
        const id = request.next++;
        pending.set(id, res);
        send({ jsonrpc: '2.0', id, method, params });
      });
    request.next = 1;

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
          res(msg);
        }
      }
    });
    child.on('error', reject);

    (async () => {
      const init = await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-mcp-client', version: '0.0.0' },
      });
      if (init.error) throw new Error(`initialize falhou: ${JSON.stringify(init.error)}`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });

      const call = await request('tools/call', { name: 'get_issue_context', arguments: args });
      if (call.error) throw new Error(`tools/call falhou: ${JSON.stringify(call.error)}`);
      const content = call.result?.content ?? [];
      const text = content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
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

/** Verifica que todas as `needles` aparecem em `hay`; acumula as encontradas. */
function grepAll(label, hay, needles) {
  const found = [];
  const missing = [];
  for (const n of needles) (hay.includes(n) ? found : missing).push(n);
  if (missing.length > 0) {
    process.stderr.write(`\n--- bundle de ${label} ---\n${hay}\n--- fim ---\n`);
    fail(`${label}: strings ausentes no bundle: ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
  }
  log(`${label}: OK — encontrei ${found.length} strings de fixture`);
  return found;
}

/** Expectativas de conteúdo por issue, derivadas das fixtures do seed.mjs. */
function expectationsFor(ids) {
  const [id1, id2, id3] = ids;
  return {
    [id1]: [
      'Issue base 1 gerada pelo seed',
      'Comentário de fixture na issue base 1',
      'Severidade',
      'Alta',
      'fixture-note.txt',
      'relates',
      `issue #${id2}`, // relation -> base 2
      `issue #${id3}`, // sub-issue (child base 3)
    ],
    [id2]: [
      'Issue base 2 gerada pelo seed',
      'Comentário de fixture na issue base 2',
      'Média',
      'relates', // relação espelhada aparece no lado da base 2 (renderizada por issue_to_id)
      `issue #${id2}`,
    ],
    [id3]: [
      'Issue base 3 gerada pelo seed',
      'Comentário de fixture na issue base 3',
      'Baixa',
      'Issue Pai',
      `issue #${id1}`, // parent base 1
    ],
  };
}

async function main() {
  const evidence = {};
  try {
    log(`alvo: ${BASE} (compose ${COMPOSE})`);

    // 1) Sobe o stack (ou assume up).
    if (!ASSUME_UP) {
      log('subindo docker (up -d)...');
      const up = await compose(['up', '-d']);
      if (up.code !== 0) fail(`docker compose up -d falhou (code ${up.code})`);
    } else {
      log('E2E_ASSUME_UP: assumindo stack já de pé');
    }

    // 2) Espera healthy + one-shots (REST + trackers + custom field).
    log('aguardando ambiente ficar pronto...');
    await waitReady(300000);

    // 3) Seed idempotente.
    log('rodando seed...');
    const seed = await run('node', [join(ROOT, 'scripts', 'seed.mjs')], { mirror: true });
    if (seed.code !== 0) fail(`seed falhou (code ${seed.code})`);

    // 4) Build.
    log('buildando (npm run build)...');
    const build = await run('npm', ['run', 'build'], { mirror: true });
    if (build.code !== 0) fail(`build falhou (code ${build.code})`);

    // 5) Credencial real (api_key do admin) + ids das fixtures.
    const apiKey = await fetchAdminApiKey();
    const ids = await resolveIds();
    const expects = expectationsFor(ids);

    // 6) CLI para as 3 issues, validando strings das fixtures.
    const cliBundles = {};
    for (const id of ids) {
      const r = await cliIssue(id, apiKey);
      if (r.code !== 0) fail(`CLI issue ${id} saiu ${r.code}: ${r.stderr}`);
      cliBundles[id] = r.stdout;
      evidence[`issue ${id}`] = grepAll(`CLI issue ${id}`, r.stdout, expects[id]);
    }

    // 7) Tempo issue→bundle com cache quente (2ª execução da issue base 1).
    const warmId = ids[0];
    await cliIssue(warmId, apiKey); // aquece
    const t0 = performance.now();
    const warm = await cliIssue(warmId, apiKey);
    const elapsedMs = Math.round(performance.now() - t0);
    if (warm.code !== 0) fail(`CLI (warm) issue ${warmId} saiu ${warm.code}`);
    if (elapsedMs >= 30000) fail(`tempo issue→bundle ${elapsedMs}ms >= 30000ms (orçamento estourado)`);
    log(`tempo issue→bundle (warm, texto) = ${elapsedMs}ms (< 30000ms) OK`);

    // 8) MCP vs CLI: mesmo conteúdo para as 3 issues.
    for (const id of ids) {
      const mcp = await mcpGetIssueContext(apiKey, { issue_id: id, format: 'markdown' });
      if (mcp.isError) fail(`MCP get_issue_context(${id}) retornou isError: ${mcp.text}`);
      if (mcp.text !== cliBundles[id]) {
        process.stderr.write(`\n[MCP]\n${mcp.text}\n[CLI]\n${cliBundles[id]}\n`);
        fail(`MCP != CLI para a issue ${id} (bundles divergem)`);
      }
      log(`MCP == CLI para a issue ${id} (byte-idêntico, ${mcp.text.length} bytes)`);
    }

    // 9) Segurança: http:// sem --insecure deve ser recusado (exit != 0).
    const insecureTest = await run('node', [CLI, 'issue', String(ids[0]), '--url', BASE], {
      env: { REDMINE_API_KEY: apiKey },
    });
    if (insecureTest.code === 0) fail('esperava exit != 0 ao usar http:// sem --insecure, obtive 0');
    if (!/recusada|http:\/\//i.test(insecureTest.stderr)) {
      fail(`recusa de http:// sem mensagem esperada: ${insecureTest.stderr}`);
    }
    log(`segurança OK: http:// recusado (exit ${insecureTest.code}, TLS obrigatório)`);

    log('E2E OK: todas as validações passaram.');
    log(`RESUMO: tempo_warm=${elapsedMs}ms; ids=${ids.join(',')}; mcp==cli em 3 issues.`);
  } finally {
    if (!NO_TEARDOWN) {
      log('teardown: docker compose down -v ...');
      await compose(['down', '-v']).catch((e) => log(`aviso no teardown: ${e?.message ?? e}`));
      const ps = await run('docker', ['ps', '--filter', 'name=redmine-context-test', '--format', '{{.Names}}']);
      log(`containers remanescentes do stack: "${ps.stdout.trim() || '(nenhum)'}"`);
    } else {
      log('E2E_NO_TEARDOWN: pulando down -v');
    }
  }
}

main().catch((err) => {
  log(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
