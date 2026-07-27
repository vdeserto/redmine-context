// @ts-check
//
// e2e-shared.mjs — helpers COMPARTILHADOS entre os dois runners E2E do projeto:
//   - scripts/e2e.mjs     (dogfood local, issue #20 / M1-14 — sobe/derruba o stack)
//   - scripts/e2e-ci.mjs  (job de CI, issue #80 / M5-05.2 — assume o stack up+seedado)
//
// CORREÇÃO DO GAP #87 (MINOR-4): antes ~200 linhas eram duplicadas nos dois
// arquivos (run/api/fetchAdminApiKey/resolveIds/cliIssue/mcpGetIssueContext/grepAll/
// expectationsFor), com drift já começando. Agora vivem aqui, atrás da factory
// `createE2E({ log, mcpClientName })`. Cada runner injeta seu prefixo de log.
//
// CORREÇÃO DO GAP #87 (MINOR-5): `run()` e `api()` ganharam timeout POR-CHAMADA
// (`opts.timeoutMs`) — antes um subprocesso/fetch travado corria até o timeout de
// 30min do job. `cliIssue()` aplica um teto default; `api()` usa AbortSignal.timeout.
//
// Node puro, sem dependência nova. As constantes de ambiente têm os mesmos
// defaults nos dois runners (combinam com docker/docker-compose.yml).

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Raiz do repo (scripts/lib → ../..). */
export const ROOT = join(HERE, '..', '..');
/** CLI compilada (dist/). */
export const CLI = join(ROOT, 'dist', 'surfaces', 'cli', 'main.js');

/** URL base do Redmine de teste (default = compose). */
export const BASE = (process.env.REDMINE_URL ?? 'http://localhost:3080').replace(/\/+$/, '');
const USER = process.env.REDMINE_ADMIN_USER ?? 'admin';
const PASS = process.env.REDMINE_ADMIN_PASSWORD ?? 'admin';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

/** Subjects das fixtures (chave de idempotência do seed), na ordem base 1..3. */
export const SUBJECTS = [
  'RC Fixture: issue base 1',
  'RC Fixture: issue base 2',
  'RC Fixture: issue base 3',
];

/** Nome do anexo de texto que o seed cria na issue base 1. */
export const ATTACH_FILENAME = 'fixture-note.txt';

/** Timeout default (ms) de uma chamada REST (`api`). */
const DEFAULT_API_TIMEOUT_MS = 30000;
/** Timeout default (ms) de uma execução da CLI (`cliIssue`). */
const DEFAULT_CLI_TIMEOUT_MS = 120000;
/** Timeout (ms) do handshake+chamada do cliente MCP stdio. */
const MCP_TIMEOUT_MS = 30000;

/** Pausa por `ms` milissegundos. */
export const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Roda um comando e resolve com {code, stdout, stderr}. Nunca rejeita por exit
 * != 0 (o chamador decide). Com `opts.timeoutMs`, mata o processo (SIGKILL) e
 * resolve com code 124 + marcador no stderr (não rejeita — o chamador vê o code).
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, mirror?: boolean, timeoutMs?: number }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...opts.env },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs);
    }
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (opts.mirror) process.stderr.write(d);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        stderr += `\n[timeout após ${opts.timeoutMs}ms — processo morto (SIGKILL)]\n`;
        resolve({ code: 124, stdout, stderr });
      } else {
        resolve({ code: code ?? 0, stdout, stderr });
      }
    });
  });
}

/** Aborta o passo atual com erro (sai != 0). */
export function fail(/** @type {string} */ msg) {
  throw new Error(msg);
}

/**
 * Chama a REST do Redmine com Basic auth admin. Com timeout por-chamada
 * (AbortSignal.timeout) para não pendurar até o timeout do job.
 * @param {string} method @param {string} path @param {unknown} [body]
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ status: number, ok: boolean, json: any, text: string }>}
 */
export async function api(method, path, body, opts = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_API_TIMEOUT_MS),
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

/**
 * Cria os helpers que dependem de um logger (prefixo por runner) e do nome do
 * cliente MCP. `log` escreve uma linha em stderr já prefixada.
 * @param {{ log: (msg: string) => void, mcpClientName?: string }} deps
 */
export function createE2E({ log, mcpClientName = 'e2e-mcp-client' }) {
  /** Descobre a api_key do admin via /users/current.json (Basic auth, fluxo real). */
  async function fetchAdminApiKey() {
    const me = await api('GET', '/users/current.json');
    const key = me.json?.user?.api_key;
    if (me.status !== 200 || typeof key !== 'string' || key.length === 0) {
      fail(`não obtive a api_key do admin (status ${me.status}); o stack está up+seedado?`);
    }
    log(`api_key do admin obtida (len ${key.length})`);
    return key;
  }

  /** Resolve os ids das 3 fixtures por subject (na ordem base 1..3). */
  async function resolveIds() {
    const got = await api('GET', '/issues.json?project_id=rc-fixtures&status_id=*&limit=100');
    if (got.status !== 200) fail(`GET issues falhou: status ${got.status} — o seed rodou?`);
    const bySubject = new Map(
      (got.json?.issues ?? []).map((/** @type {any} */ i) => [i.subject, i.id]),
    );
    const ids = SUBJECTS.map((s) => {
      const id = bySubject.get(s);
      if (typeof id !== 'number') fail(`não achei o id da fixture "${s}" — o seed rodou?`);
      return id;
    });
    log(`ids das fixtures: base1=${ids[0]}, base2=${ids[1]}, base3=${ids[2]}`);
    return ids;
  }

  /**
   * Roda a CLI `issue <id>` (Markdown) contra o ambiente, com api_key na env.
   * Teto de tempo por-chamada (uma issue não deve levar minutos).
   * @param {number} id @param {string} apiKey @param {string[]} [extraArgs]
   */
  async function cliIssue(id, apiKey, extraArgs = []) {
    return run('node', [CLI, 'issue', String(id), '--url', BASE, '--insecure', ...extraArgs], {
      env: { REDMINE_API_KEY: apiKey, REDMINE_URL: BASE },
      timeoutMs: DEFAULT_CLI_TIMEOUT_MS,
    });
  }

  /**
   * Cliente JSON-RPC stdio mínimo: sobe `mcp` como subprocess, faz o handshake e
   * chama `get_issue_context`. Sem dependência — lê o stdout linha-a-linha.
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
        reject(new Error(`timeout no cliente MCP (sem resposta em ${MCP_TIMEOUT_MS}ms)`));
      }, MCP_TIMEOUT_MS);

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
          clientInfo: { name: mcpClientName, version: '0.0.0' },
        });
        if (init.error) throw new Error(`initialize falhou: ${JSON.stringify(init.error)}`);
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });

        const call = await request('tools/call', { name: 'get_issue_context', arguments: args });
        if (call.error) throw new Error(`tools/call falhou: ${JSON.stringify(call.error)}`);
        const content = call.result?.content ?? [];
        const text = content
          .map((/** @type {any} */ c) => (c.type === 'text' ? (c.text ?? '') : ''))
          .join('');
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

  /**
   * Verifica que todas as `needles` aparecem em `hay`; retorna as encontradas.
   * @param {string} label @param {string} hay @param {string[]} needles
   */
  function grepAll(label, hay, needles) {
    const missing = needles.filter((n) => !hay.includes(n));
    if (missing.length > 0) {
      process.stderr.write(`\n--- bundle de ${label} ---\n${hay}\n--- fim ---\n`);
      fail(`${label}: strings ausentes no bundle: ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
    }
    log(`${label}: OK — ${needles.length} strings de fixture presentes`);
    return needles.filter((n) => hay.includes(n));
  }

  return { fetchAdminApiKey, resolveIds, cliIssue, mcpGetIssueContext, grepAll };
}

/**
 * Expectativas de conteúdo por issue, derivadas das fixtures do seed.mjs.
 * Conjunto CANÔNICO (interseção do que ambos os runners já asseravam — evita o
 * drift do gap #87 sem introduzir asserção nova que pudesse quebrar o CI).
 * @param {number[]} ids
 */
export function expectationsFor(ids) {
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
    [id2]: [
      'Issue base 2 gerada pelo seed',
      'Comentário de fixture na issue base 2',
      'Média',
      'relates',
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
