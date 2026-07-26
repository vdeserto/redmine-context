/**
 * Portabilidade de PATH do cache em disco (#83, M5-08 — hardening Windows).
 *
 * A {@link DiskCacheStore} monta TODO caminho com `path.join` (separador nativo do
 * SO), nunca com `/` literal nem template `${dir}/${file}`. Este teste torna essa
 * garantia TESTÁVEL e anti-regressão: grava um anexo e prova que o arquivo criado
 * fica sob um layout cujos segmentos são separados pelo `path.sep` do host e que
 * NENHUM segmento carrega um separador embutido (o que denunciaria concatenação
 * hardcoded que quebraria no Windows). Roda de forma idêntica em POSIX e Windows.
 */

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DiskCacheStore } from '../../src/cache/index.js';

import { contractKeys } from './contract-suite.js';

let baseDir: string;

beforeAll(() => {
  // os.tmpdir() + mkdtemp: raiz temporária portável (nada de '/tmp' hardcoded).
  baseDir = mkdtempSync(join(tmpdir(), 'rc-winpath-'));
});

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

/** Caminho relativo do único arquivo `.json` sob `dir` (busca recursiva). */
function findValueFile(dir: string, root: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findValueFile(full, root);
      if (found !== undefined) return found;
    } else if (entry.name.endsWith('.json') && entry.name !== 'index.json') {
      return relative(root, full);
    }
  }
  return undefined;
}

describe('DiskCacheStore: portabilidade de path (#83)', () => {
  it('usa o separador nativo do SO (path.sep) e não embute "/" nos segmentos', async () => {
    const cacheDir = mkdtempSync(join(baseDir, 'store-'));
    const store = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.attachment({
      instanceHash: 'a1b2c3d4e5f60718',
      attachmentId: 7,
      digest: 'deadbeefcafe',
    });

    await store.put(key, 'extracao');

    const relativePath = findValueFile(cacheDir, cacheDir);
    expect(relativePath).toBeDefined();

    // Reason: separado pelo path.sep do host — em Windows seria '\', em POSIX '/'.
    // Se o código concatenasse com '/' hardcoded, no Windows o split por sep
    // (='\') veria UM único segmento com '/' embutido — e a asserção falharia.
    const segments = (relativePath ?? '').split(sep);
    expect(segments).toEqual([
      'a1b2c3d4e5f60718',
      'attachments',
      '7-deadbeef',
      segments[segments.length - 1],
    ]);
    expect(segments[segments.length - 1]).toMatch(/^[0-9a-f]{64}\.json$/);
    for (const segment of segments) {
      expect(segment).not.toContain('/');
      expect(segment).not.toContain('\\');
    }
    // Sanidade: o arquivo realmente existe no caminho remontado com join.
    expect(statSync(join(cacheDir, ...segments)).isFile()).toBe(true);
  });
});
