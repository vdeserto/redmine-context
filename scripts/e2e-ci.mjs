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
// Os helpers comuns (run/api/cliIssue/MCP/grep/expectativas) vêm de
// scripts/lib/e2e-shared.mjs (dedup — gap #87). Este arquivo mantém só o que é
// específico do CI: o cenário de anexo > limite e a orquestração do main().
//
// Uso (com o stack já up+seedado):
//   npm run build && npm run ci:e2e:up && node scripts/e2e-ci.mjs
//
// Config via ambiente (defaults combinam com o compose de teste):
//   REDMINE_URL             (default http://localhost:3080)
//   REDMINE_ADMIN_USER      (default admin)
//   REDMINE_ADMIN_PASSWORD  (default admin)

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ATTACH_FILENAME,
  BASE,
  CLI,
  ROOT,
  createE2E,
  expectationsFor,
  fail,
  run,
} from './lib/e2e-shared.mjs';

/** Loga uma linha em stderr (o eslint proíbe console; script de infra). */
const log = (/** @type {string} */ msg) => process.stderr.write(`[e2e-ci] ${msg}\n`);

const { fetchAdminApiKey, resolveIds, cliIssue, mcpGetIssueContext, grepAll } = createE2E({
  log,
  mcpClientName: 'e2e-ci-mcp-client',
});

/** Teto de tempo (ms) para uma execução isolada da CLI no cenário de segurança. */
const CLI_TIMEOUT_MS = 120000;

/**
 * Segurança (b): anexo > limite é PULADO. Exercita o downloader REAL contra o
 * anexo de fixture da issue base 1, com um teto de 1 byte: o pré-check pelo
 * `filesize` reportado pelo Redmine devolve um SkippedDownload (degradação
 * graciosa, sem exceção) — sem sequer iniciar o download.
 * @param {number} issueId @param {string} apiKey
 */
async function assertAttachmentOverLimitSkipped(issueId, apiKey) {
  // Importa do core compilado (script de infra pode alcançar o dist).
  const { createHttpClient, getIssue, normalizeIssue } = await import(join(ROOT, 'dist', 'index.js'));
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
    timeoutMs: CLI_TIMEOUT_MS,
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
