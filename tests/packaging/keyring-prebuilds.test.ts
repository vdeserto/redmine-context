import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runOrThrow } from './exec-async';

/**
 * Contrato de instalação do keychain nativo via prebuilds (M5-01, #74).
 *
 * O `@napi-rs/keyring` distribui os binários nativos como pacotes por plataforma
 * em `optionalDependencies` (padrão napi-rs): em plataformas com prebuild o npm
 * instala o binário; onde não há prebuild (musl, arquiteturas exóticas), o npm
 * simplesmente PULA o pacote opcional que falha — sem `node-gyp`, sem erro de
 * instalação — e o módulo de credenciais degrada para o arquivo `0600` (ADR-003).
 *
 * Estes testes travam esse contrato no manifesto:
 *  - as 4 plataformas de prebuild alvo são declaradas explicitamente em
 *    `optionalDependencies`, na mesma faixa do pacote principal (ficam em sincronia);
 *  - NENHUM script de ciclo de vida (pre/post/install) existe para acionar
 *    compilação nativa;
 *  - NENHUMA dependência de compilação (`node-gyp`/`node-pre-gyp`/`prebuild*`)
 *    entra na árvore, garantindo que `npm ci` nunca compile o keychain.
 */

/** Raiz do pacote (tests/packaging → raiz). */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Reinvoca o npm cross-SO via `node <npm-cli.js>` (npm_execpath é setado pelo
// `npm test`) — evita o shim `npm.cmd` do Windows, que dá EINVAL em
// execFileSync sem `shell` (e a lint rule do #83 proíbe `shell: true`).
const NPM_CLI = process.env.npm_execpath;
const NPM_VIA_NODE = typeof NPM_CLI === 'string' && NPM_CLI.endsWith('.js');
const NPM_BIN = NPM_VIA_NODE ? process.execPath : (NPM_CLI ?? 'npm');
const NPM_PREFIX: readonly string[] = NPM_VIA_NODE && NPM_CLI !== undefined ? [NPM_CLI] : [];

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

/** As 4 plataformas de prebuild alvo do AC #74. */
const TARGET_PREBUILDS = [
  '@napi-rs/keyring-darwin-arm64',
  '@napi-rs/keyring-darwin-x64',
  '@napi-rs/keyring-linux-x64-gnu',
  '@napi-rs/keyring-win32-x64-msvc',
] as const;

function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest;
}

describe('keychain nativo: prebuilds via optionalDependencies (#74)', () => {
  const manifest = readManifest();

  it('declara @napi-rs/keyring como dependência principal', () => {
    expect(manifest.dependencies?.['@napi-rs/keyring']).toBeDefined();
  });

  it('declara as 4 plataformas de prebuild em optionalDependencies', () => {
    const optional = manifest.optionalDependencies ?? {};
    for (const pkg of TARGET_PREBUILDS) {
      expect(optional[pkg], `optionalDependencies deve conter ${pkg}`).toBeDefined();
    }
  });

  it('mantém os prebuilds na mesma faixa do pacote principal (sincronia)', () => {
    const mainRange = manifest.dependencies?.['@napi-rs/keyring'];
    const optional = manifest.optionalDependencies ?? {};
    for (const pkg of TARGET_PREBUILDS) {
      expect(optional[pkg], `${pkg} deve casar com @napi-rs/keyring (${String(mainRange)})`).toBe(
        mainRange,
      );
    }
  });

  it('não tem scripts de ciclo de vida que acionem compilação nativa', () => {
    const scripts = manifest.scripts ?? {};
    for (const hook of ['preinstall', 'install', 'postinstall'] as const) {
      expect(scripts[hook], `script "${hook}" não deve existir (evita node-gyp)`).toBeUndefined();
    }
  });

  it('cada plataforma alvo existe nas optionalDependencies REAIS do @napi-rs/keyring (pega typo)', () => {
    // Um typo no triple (ex.: `-linux-x64-glibc`) passaria nos testes acima mas
    // cairia em always-fallback silencioso. Valida contra o pacote instalado: as
    // 4 alvo DEVEM ser um subconjunto das optionalDependencies do upstream.
    const upstream = JSON.parse(
      readFileSync(join(ROOT, 'node_modules', '@napi-rs', 'keyring', 'package.json'), 'utf8'),
    ) as Manifest;
    const upstreamPlatforms = Object.keys(upstream.optionalDependencies ?? {});
    for (const pkg of TARGET_PREBUILDS) {
      expect(upstreamPlatforms, `${pkg} deve ser um pacote de plataforma real do @napi-rs/keyring`).toContain(
        pkg,
      );
    }
  });
});

describe('keychain nativo: instalação sem node-gyp (#74)', () => {
  it('não traz node-gyp/node-pre-gyp/prebuild na árvore de dependências', async () => {
    // `npm ls` sobre a árvore instalada (offline): se qualquer ferramenta de
    // compilação nativa estivesse presente, o keychain seria compilado no install.
    // Async (await) para não bloquear o event loop do worker do Vitest (#77).
    const { stdout: out } = await runOrThrow(
      NPM_BIN,
      [...NPM_PREFIX, 'ls', '--all', '--omit=dev', '--parseable'],
      { cwd: ROOT },
    );
    expect(out).not.toMatch(/node_modules\/(node-gyp|node-pre-gyp|@mapbox\/node-pre-gyp|prebuild(-install)?)(\/|$)/m);
  }, 60_000);
});
