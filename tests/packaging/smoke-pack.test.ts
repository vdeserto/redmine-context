import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { runOrThrow } from './exec-async';

/**
 * Smoke de empacotamento npm/npx (M5-03, #76).
 *
 * Constrói o `dist/`, gera o tarball real com `npm pack` e verifica, de forma
 * hermética e determinística, o contrato de distribuição:
 *  - o tarball só carrega `dist/` + metadados (SEM testes/fixtures/src/tsconfig);
 *  - NENHUM binário/asset de mídia é embutido (política OUT do PRD / ADR-002);
 *  - o entrypoint do `bin` tem shebang e roda `--help`/`--version` com exit 0
 *    a partir dos arquivos EMPACOTADOS (o que o `npx` executaria).
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

interface PackFileEntry {
  readonly path: string;
}
interface PackResult {
  readonly filename: string;
  readonly files: readonly PackFileEntry[];
}

/** Caminhos declarados dentro do tarball (relativos à raiz do pacote). */
let tarballFiles: readonly string[] = [];
/** Caminho do entrypoint do bin extraído do tarball. */
let extractedBin = '';
let binViaSymlink = '';

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rc-pack-'));

  // Build explícito ANTES do pack (com --ignore-scripts) para que a saída do
  // tsc nunca contamine o JSON de `npm pack --json`. Determinístico. Async (await)
  // para não bloquear o event loop do worker do Vitest (#77).
  await runOrThrow(NPM_BIN, [...NPM_PREFIX, 'run', 'build'], { cwd: ROOT });

  const { stdout: raw } = await runOrThrow(
    NPM_BIN,
    [...NPM_PREFIX, 'pack', '--json', '--ignore-scripts', '--pack-destination', tmp],
    { cwd: ROOT },
  );
  const meta = (JSON.parse(raw) as readonly PackResult[])[0];
  if (meta === undefined) {
    throw new Error('npm pack --json não retornou metadados do tarball');
  }
  tarballFiles = meta.files.map((entry) => entry.path);

  // Extrai o tarball e liga os node_modules já instalados (sem rede): rodamos
  // exatamente os arquivos empacotados, como o npx faria após o download. Caminho
  // RELATIVO com `cwd: tmp`: um `C:\...tgz` absoluto faz o GNU tar (Git Bash no
  // runner Windows) interpretar `C:` como host remoto ("Cannot connect to C:").
  await runOrThrow('tar', ['-xf', meta.filename], { cwd: tmp });
  const pkgDir = join(tmp, 'package');
  // `junction` liga o dir sem exigir privilégio de symlink no Windows (no POSIX o
  // tipo é ignorado e vira um symlink normal).
  symlinkSync(join(ROOT, 'node_modules'), join(pkgDir, 'node_modules'), 'junction');
  extractedBin = join(pkgDir, 'dist', 'surfaces', 'cli', 'main.js');
  // No POSIX executamos o bin por um SYMLINK (reproduz argv[1]=symlink vs.
  // import.meta.url=realpath, exercitando o guard do #76). No Windows, symlink de
  // ARQUIVO exige privilégio e o shim do npm já passa o realpath ao node (o guard é
  // trivial lá), então rodamos o realpath direto.
  if (process.platform === 'win32') {
    binViaSymlink = extractedBin;
  } else {
    binViaSymlink = join(tmp, 'redmine-context');
    symlinkSync(extractedBin, binViaSymlink);
  }
}, 180_000);

describe('empacotamento: conteúdo do tarball (files/exports)', () => {
  it('empacota apenas dist/ + metadados; sem tests/fixtures/src/config', () => {
    const isAllowed = (p: string): boolean =>
      p === 'package.json' || p === 'README.md' || p === 'LICENSE' || p.startsWith('dist/');
    for (const path of tarballFiles) {
      expect(isAllowed(path), `arquivo inesperado no tarball: ${path}`).toBe(true);
    }

    // Essenciais presentes.
    expect(tarballFiles).toContain('package.json');
    expect(tarballFiles).toContain('dist/index.js');
    expect(tarballFiles).toContain('dist/index.d.ts');
    expect(tarballFiles).toContain('dist/surfaces/cli/main.js');

    // Nada de artefatos de desenvolvimento/teste vaza.
    expect(tarballFiles.some((p) => p.startsWith('tests/'))).toBe(false);
    expect(tarballFiles.some((p) => p.startsWith('src/'))).toBe(false);
    expect(tarballFiles.some((p) => p.includes('.test.'))).toBe(false);
    expect(tarballFiles.some((p) => p.includes('.spec.'))).toBe(false);
    expect(tarballFiles.some((p) => p.toLowerCase().includes('fixture'))).toBe(false);
    expect(tarballFiles).not.toContain('tsconfig.json');
    expect(tarballFiles).not.toContain('vitest.config.ts');
    expect(tarballFiles).not.toContain('eslint.config.js');
  });

  it('não embute binários nem assets de mídia (PRD OUT / ADR-002)', () => {
    // Modelos/binários nativos e assets de mídia jamais devem ir no pacote —
    // a distribuição é 100% JS; a mídia é extraída localmente pelo usuário.
    const mediaOrBinary =
      /\.(gguf|bin|onnx|traineddata|wasm|node|exe|dll|dylib|so|mp4|mkv|mov|mp3|wav|m4a|png|jpe?g|gif|webp|pdf)$/i;
    for (const path of tarballFiles) {
      expect(mediaOrBinary.test(path), `binário/asset de mídia no tarball: ${path}`).toBe(false);
    }
  });

  it('TOOL_VERSION do core está em sincronia com package.json', async () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      readonly version: string;
    };
    const { stdout: version } = await runOrThrow('node', [binViaSymlink, '--version']);
    expect(version.trim()).toBe(pkg.version);
  });
});

describe('empacotamento: bin executável (npx)', () => {
  it('o entrypoint do bin começa com shebang de node', () => {
    const firstLine = readFileSync(extractedBin, 'utf8').split('\n', 1)[0];
    expect(firstLine).toBe('#!/usr/bin/env node');
  });

  it('roda --help do tarball com exit 0', async () => {
    // runOrThrow rejeita se o exit code != 0; sucesso ⇒ exit 0.
    const { stdout: out } = await runOrThrow('node', [binViaSymlink, '--help']);
    expect(out).toContain('Uso:');
    expect(out).not.toMatch(/claude|gpt|openai|copilot/i);
  }, 60_000);

  it('roda --version do tarball com exit 0 e imprime semver', async () => {
    const { stdout: out } = await runOrThrow('node', [binViaSymlink, '--version']);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 60_000);
});
