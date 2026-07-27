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
// Os helpers comuns (run/api/cliIssue/MCP/grep/expectativas) vêm de
// scripts/lib/e2e-shared.mjs (dedup — gap #87). Este arquivo mantém só o que é
// específico do dogfood local: orquestração do docker compose, waitReady, o
// warm-cache timing e o teardown.
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

import { join } from 'node:path';

import {
  BASE,
  CLI,
  ROOT,
  api,
  createE2E,
  expectationsFor,
  fail,
  run,
  sleep,
} from './lib/e2e-shared.mjs';

const COMPOSE = join(ROOT, 'docker', 'docker-compose.yml');
const ASSUME_UP = /^(1|true)$/i.test(process.env.E2E_ASSUME_UP ?? '');
const NO_TEARDOWN = /^(1|true)$/i.test(process.env.E2E_NO_TEARDOWN ?? '');

/** Loga uma linha em stderr (o eslint proíbe console; script de infra). */
const log = (/** @type {string} */ msg) => process.stderr.write(`[e2e] ${msg}\n`);

const { fetchAdminApiKey, resolveIds, cliIssue, mcpGetIssueContext, grepAll } = createE2E({
  log,
  mcpClientName: 'e2e-mcp-client',
});

/** Roda um `docker compose` sobre o compose de teste (com stderr espelhado). */
function compose(/** @type {string[]} */ args, /** @type {{ env?: NodeJS.ProcessEnv }} */ opts = {}) {
  return run('docker', ['compose', '-f', COMPOSE, ...args], { mirror: true, ...opts });
}

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
          (cf.json?.custom_fields ?? []).some((/** @type {any} */ f) => f.name === 'Severidade');
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

async function main() {
  /** @type {Record<string, string[]>} */
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
    /** @type {Record<number, string>} */
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
      timeoutMs: 120000,
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
