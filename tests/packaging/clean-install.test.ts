import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCapture, runOrThrow } from './exec-async';

/**
 * Teste de instalação limpa ponta a ponta (M5-02, #75).
 *
 * Prova, de forma determinística e hermética, que uma instalação REAL do pacote
 * num ambiente vazio NÃO dispara compilação nativa e que o `bin` roda:
 *  1. constrói o `dist/` e gera o tarball real (`npm pack`);
 *  2. instala o `.tgz` num projeto vazio isolado (`mkdtemp`) capturando o LOG
 *     verboso do install;
 *  3. assere que o LOG do install NUNCA menciona `node-gyp`/`node-pre-gyp`/
 *     `prebuild-install`/`gyp info` — o `@napi-rs/keyring` distribui binários via
 *     `optionalDependencies` (prebuilds, #74), então nada compila. Não removemos o
 *     compilador do host (inviável e não-hermético); a asserção sobre o log é o
 *     sinal correto e determinístico do AC ("asserção no log do install");
 *  4. executa `--help` pelo SYMLINK que o npm cria em `node_modules/.bin`
 *     (reproduz o caminho `npx`/`npm i -g`: argv[1] = symlink, não realpath — o
 *     guard de auto-invocação, corrigido no #76, precisa resolver o realpath).
 *
 * Falha bloqueia release: se o install compilar (log com node-gyp) ou o bin não
 * rodar via symlink, o teste falha na suíte unit/CI.
 *
 * Robustez/rede: usamos `--prefer-offline` (usa o cache do npm preenchido por
 * `npm ci`; só busca metadados ausentes) + `--no-audit --no-fund` para um install
 * rápido e estável, sem depender de rede volátil nem de `--offline` estrito (que
 * quebraria em cache frio). `--foreground-scripts` garante que qualquer build
 * nativo eventual apareceria no log capturado.
 */

/** Raiz do pacote (tests/packaging → raiz). */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Reinvoca o npm cross-SO via `node <npm-cli.js>` (npm_execpath é setado pelo
// `npm test`) — evita o shim `npm.cmd` do Windows, que dá EINVAL em
// execFileSync/spawnSync sem `shell` (e a lint rule do #83 proíbe `shell: true`).
const NPM_CLI = process.env.npm_execpath;
const NPM_VIA_NODE = typeof NPM_CLI === 'string' && NPM_CLI.endsWith('.js');
const NPM_BIN = NPM_VIA_NODE ? process.execPath : (NPM_CLI ?? 'npm');
const NPM_PREFIX: readonly string[] = NPM_VIA_NODE && NPM_CLI !== undefined ? [NPM_CLI] : [];

/** Padrão de qualquer ferramenta/etapa de compilação nativa (deve estar AUSENTE). */
const NATIVE_BUILD = /node-gyp|node-pre-gyp|prebuild-install|gyp info|node-gyp rebuild/i;

interface PackFileEntry {
  readonly path: string;
}
interface PackResult {
  readonly filename: string;
  readonly files: readonly PackFileEntry[];
}

/** Diretório temporário raiz do teste (tarball + projeto de instalação). */
let workDir = '';
/** Log combinado (stdout+stderr) do `npm install <tarball>`. */
let installLog = '';
/** Exit code do `npm install <tarball>`. */
let installStatus: number | null = null;
/** Symlink do bin criado pelo npm: node_modules/.bin/redmine-context. */
let binViaSymlink = '';

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'rc-clean-install-'));

  // Build explícito ANTES do pack com --ignore-scripts: assim o `prepack` (que
  // roda `tsc`) não roda de novo nem contamina o JSON de `npm pack --json`. Async
  // (await) para não bloquear o event loop do worker do Vitest (#77).
  await runOrThrow(NPM_BIN, [...NPM_PREFIX, 'run', 'build'], { cwd: ROOT });

  const { stdout: raw } = await runOrThrow(
    NPM_BIN,
    [...NPM_PREFIX, 'pack', '--json', '--ignore-scripts', '--pack-destination', workDir],
    { cwd: ROOT },
  );
  const meta = (JSON.parse(raw) as readonly PackResult[])[0];
  if (meta === undefined) {
    throw new Error('npm pack --json não retornou metadados do tarball');
  }
  const tarball = join(workDir, meta.filename);

  // Projeto de instalação: um diretório VAZIO com um package.json mínimo. Nada é
  // herdado da raiz — a árvore é resolvida do zero, exatamente como no cliente.
  const projDir = join(workDir, 'consumer');
  const nodeBin = join(projDir, 'node_modules', '.bin');
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, 'package.json'),
    `${JSON.stringify(
      { name: 'clean-install-consumer', version: '1.0.0', private: true },
      null,
      2,
    )}\n`,
  );

  // Instala o tarball local. runCapture (spawn async, NÃO execFileAsync) para
  // capturar o LOG COMPLETO mesmo se o install falhar — precisamos do log para a
  // asserção e do status para provar que o install em si teve sucesso; execFileAsync
  // REJEITARIA em exit != 0 e perderíamos ambos. É async (await) para não bloquear o
  // event loop do worker do Vitest (#77).
  // `--prefer-offline` usa o cache do npm (aquecido pelo `npm ci` do job) e só vai
  // à rede para packuments ausentes; os `--fetch-retries`/timeouts toleram blips de
  // rede num gate release-blocking (M1 do review). Hermetismo pleno (lockfile fixo no
  // consumer + `--offline`) fica como follow-up se surgir flakiness.
  const install = await runCapture(
    NPM_BIN,
    [
      ...NPM_PREFIX,
      'install',
      tarball,
      '--prefer-offline',
      '--no-audit',
      '--no-fund',
      '--fetch-retries',
      '5',
      '--fetch-retry-mintimeout',
      '2000',
      '--fetch-retry-maxtimeout',
      '60000',
      '--foreground-scripts',
      '--loglevel',
      'verbose',
    ],
    { cwd: projDir, maxBuffer: 64 * 1024 * 1024 },
  );
  installStatus = install.status;
  installLog = `${install.stdout}\n${install.stderr}`;

  binViaSymlink = join(nodeBin, 'redmine-context');
}, 300_000);

afterAll(() => {
  if (workDir !== '') {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe('instalação limpa: sem toolchain nativo (#75)', () => {
  it('instala o tarball num ambiente vazio com exit 0', () => {
    expect(installStatus).toBe(0);
  });

  it('produziu um log de install verboso (a asserção negativa é significativa)', () => {
    // Guarda contra falso-positivo: se o log viesse vazio, "não contém node-gyp"
    // passaria trivialmente. Exigimos que o install realmente tenha logado o reify.
    expect(installLog.length).toBeGreaterThan(0);
    expect(installLog).toMatch(/reify|added|redmine-context/i);
  });

  it('o LOG do install NUNCA invoca node-gyp/node-pre-gyp/prebuild-install', () => {
    const offending = installLog
      .split('\n')
      .filter((line) => NATIVE_BUILD.test(line));
    expect(
      offending,
      `compilação nativa detectada no log do install:\n${offending.join('\n')}`,
    ).toEqual([]);
  });
});

describe('instalação limpa: bin executável (npx) (#75)', () => {
  // O npm expõe o bin de forma diferente por SO: SYMLINK Unix (executa o shebang
  // com argv[1]=symlink) vs. shims `redmine-context.cmd`/`.ps1` no Windows (que
  // chamam `node <realpath>`). Ambos são o caminho que `npx`/`npm i -g` usam.
  const isWindows = process.platform === 'win32';

  it('expõe o bin em node_modules/.bin (symlink no Unix; shim .cmd no Windows)', () => {
    if (isWindows) {
      expect(existsSync(`${binViaSymlink}.cmd`)).toBe(true);
    } else {
      expect(lstatSync(binViaSymlink).isSymbolicLink()).toBe(true);
    }
  });

  it('roda --help pelo entrypoint instalado com exit 0 e imprime a ajuda', async () => {
    // Unix: executa o próprio symlink (argv[1]=symlink, reproduz o npx e exercita o
    // guard de realpath do #76). Windows: o shim `.cmd` via `cmd /c` (sem shell:true
    // — `cmd` é o programa; `/c` o argumento). runOrThrow rejeita se exit != 0.
    const { stdout: out } = isWindows
      ? await runOrThrow('cmd', ['/c', `${binViaSymlink}.cmd`, '--help'])
      : await runOrThrow(binViaSymlink, ['--help']);
    expect(out).toContain('Uso:');
    expect(out).toContain('redmine-context');
    // Rule #33 / ADR: nada de referências a ferramentas de IA na saída.
    expect(out).not.toMatch(/claude|gpt|openai|copilot/i);
  }, 60_000);
});
