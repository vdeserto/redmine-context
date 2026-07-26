import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

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

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'rc-pack-'));

  // Build explícito ANTES do pack (com --ignore-scripts) para que a saída do
  // tsc nunca contamine o JSON de `npm pack --json`. Determinístico.
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });

  const raw = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const meta = (JSON.parse(raw) as readonly PackResult[])[0];
  if (meta === undefined) {
    throw new Error('npm pack --json não retornou metadados do tarball');
  }
  tarballFiles = meta.files.map((entry) => entry.path);

  // Extrai o tarball e liga os node_modules já instalados (sem rede): rodamos
  // exatamente os arquivos empacotados, como o npx faria após o download.
  execFileSync('tar', ['-xf', join(tmp, meta.filename), '-C', tmp]);
  const pkgDir = join(tmp, 'package');
  symlinkSync(join(ROOT, 'node_modules'), join(pkgDir, 'node_modules'), 'dir');
  // realpathSync: em macOS `tmpdir()` é /var → /private/var (symlink). O node
  // resolve `import.meta.url` pelo realpath, mas `process.argv[1]` preserva o
  // caminho passado — se divergirem, o guard de auto-invocação do bin não
  // dispara. Passamos o realpath para que argv[1] case com import.meta.url.
  extractedBin = realpathSync(join(pkgDir, 'dist', 'surfaces', 'cli', 'main.js'));
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

  it('TOOL_VERSION do core está em sincronia com package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      readonly version: string;
    };
    const version = execFileSync('node', [extractedBin, '--version'], { encoding: 'utf8' });
    expect(version.trim()).toBe(pkg.version);
  });
});

describe('empacotamento: bin executável (npx)', () => {
  it('o entrypoint do bin começa com shebang de node', () => {
    const firstLine = readFileSync(extractedBin, 'utf8').split('\n', 1)[0];
    expect(firstLine).toBe('#!/usr/bin/env node');
  });

  it('roda --help do tarball com exit 0', () => {
    // execFileSync lança se o exit code != 0; sucesso ⇒ exit 0.
    const out = execFileSync('node', [extractedBin, '--help'], { encoding: 'utf8' });
    expect(out).toContain('Uso:');
    expect(out).not.toMatch(/claude|gpt|openai|copilot/i);
  }, 60_000);

  it('roda --version do tarball com exit 0 e imprime semver', () => {
    const out = execFileSync('node', [extractedBin, '--version'], { encoding: 'utf8' });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 60_000);
});
