import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rc-clean-install-'));

  // Build explícito ANTES do pack com --ignore-scripts: assim o `prepack` (que
  // roda `tsc`) não roda de novo nem contamina o JSON de `npm pack --json`.
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });

  const raw = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', workDir],
    { cwd: ROOT, encoding: 'utf8' },
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

  // Instala o tarball local. spawnSync (não execFileSync) para capturar o LOG
  // COMPLETO mesmo se o install falhar — precisamos do log para a asserção e do
  // status para provar que o install em si teve sucesso.
  const install = spawnSync(
    'npm',
    [
      'install',
      tarball,
      '--prefer-offline',
      '--no-audit',
      '--no-fund',
      '--foreground-scripts',
      '--loglevel',
      'verbose',
    ],
    { cwd: projDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  installStatus = install.status;
  installLog = `${install.stdout ?? ''}\n${install.stderr ?? ''}`;

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

describe('instalação limpa: bin executável via symlink (npx) (#75)', () => {
  it('expõe o bin como SYMLINK em node_modules/.bin (caminho npx)', () => {
    expect(lstatSync(binViaSymlink).isSymbolicLink()).toBe(true);
  });

  it('roda --help pelo symlink com exit 0 e imprime a ajuda', () => {
    // Executa o próprio symlink (shebang + exec bit que o npm aplica): argv[1] é
    // o caminho do symlink, reproduzindo o que `npx` faz. execFileSync lança se o
    // exit code != 0 ⇒ sucesso implica exit 0.
    const out = execFileSync(binViaSymlink, ['--help'], { encoding: 'utf8' });
    expect(out).toContain('Uso:');
    expect(out).toContain('redmine-context');
    // Rule #33 / ADR: nada de referências a ferramentas de IA na saída.
    expect(out).not.toMatch(/claude|gpt|openai|copilot/i);
  }, 60_000);
});
