/**
 * Testes da {@link DiskCacheStore} (M3-02, ADR-004).
 *
 * Além de passar na MESMA suíte de contrato reutilizável (`runCacheContractSuite`,
 * garantindo substituibilidade pela in-memory), estes testes cobrem o que é
 * específico do backend em disco e NÃO exercitado pela suíte (nota do review
 * #129): layout de diretórios do ADR (`<instance_hash>/attachments/<id>-<digest8>/`
 * e `issues/`), criação sob demanda, escrita atômica write-then-rename, valores
 * como JSON, persistência real entre instâncias e normalização do `instance_hash`
 * no contexto do layout.
 */

import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DiskCacheStore, defaultCacheDir, instanceHash } from '../../src/cache/index.js';

import { contractKeys, runCacheContractSuite } from './contract-suite.js';

let baseDir: string;

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'rc-disk-cache-'));
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

/** Cria um diretório de cache limpo e isolado para um único store/teste. */
function freshCacheDir(): string {
  return mkdtempSync(join(baseDir, 'store-'));
}

describe('DiskCacheStore (contrato)', () => {
  runCacheContractSuite(
    (options) => new DiskCacheStore<string>({ ...(options ?? {}), cacheDir: freshCacheDir() }),
  );
});

describe('DiskCacheStore: layout de diretórios (ADR-004)', () => {
  it('mapeia a chave de attachment para <instance_hash>/attachments/<id>-<digest8>/', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.attachment({ instanceHash: 'a1b2c3d4e5f60718', attachmentId: 7, digest: 'deadbeefcafe' });

    await store.put(key, 'extracao');

    const attachmentDir = join(cacheDir, 'a1b2c3d4e5f60718', 'attachments', '7-deadbeef');
    expect(existsSync(attachmentDir)).toBe(true);
    const files = readdirSync(attachmentDir);
    expect(files).toHaveLength(1);
    // Nome de arquivo derivado SÓ de hash — nunca de conteúdo externo.
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it('coloca entradas de issue em subdir próprio (issues/<issue_id>/)', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });

    await store.put(contractKeys.issue({ issueId: 42 }), 'bundle-42');

    const issueDir = join(cacheDir, 'issues', '42');
    expect(existsSync(issueDir)).toBe(true);
    expect(readdirSync(issueDir)).toHaveLength(1);
  });

  it('cria diretórios sob demanda: nada existe antes do primeiro put', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    expect(readdirSync(cacheDir)).toHaveLength(0);

    await store.put(contractKeys.attachment(), 'v');
    expect(readdirSync(cacheDir).length).toBeGreaterThan(0);
  });

  it('isola instâncias distintas em diretórios de instance_hash diferentes', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    await store.put(contractKeys.attachment({ instanceHash: 'aaaa000011112222' }), 'a');
    await store.put(contractKeys.attachment({ instanceHash: 'bbbb333344445555' }), 'b');

    expect(existsSync(join(cacheDir, 'aaaa000011112222'))).toBe(true);
    expect(existsSync(join(cacheDir, 'bbbb333344445555'))).toBe(true);
  });
});

describe('DiskCacheStore: escrita atômica e formato', () => {
  it('grava o valor como JSON legível em disco', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<{ text: string; score: number }>({ cacheDir });
    const key = contractKeys.issue({ issueId: 99 });

    await store.put(key, { text: 'olá', score: 3 });

    const file = join(cacheDir, 'issues', '99', readdirSync(join(cacheDir, 'issues', '99'))[0] ?? '');
    const raw = await readFile(file, 'utf8');
    expect(JSON.parse(raw)).toEqual({ text: 'olá', score: 3 });
  });

  it('não deixa arquivos .tmp após o put (rename concluído)', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.issue({ issueId: 7 });

    await store.put(key, 'v');

    const dir = join(cacheDir, 'issues', '7');
    const leftovers = readdirSync(dir).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toHaveLength(0);
  });

  it('substitui o valor de uma chave sem duplicar arquivos', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const key = contractKeys.issue({ issueId: 5 });

    await store.put(key, 'v1');
    await store.put(key, 'v2');

    expect(await store.get(key)).toBe('v2');
    expect(readdirSync(join(cacheDir, 'issues', '5'))).toHaveLength(1);
  });
});

describe('DiskCacheStore: persistência real entre instâncias', () => {
  it('entradas sobrevivem a uma NOVA instância do store (mesmo cacheDir)', async () => {
    const cacheDir = freshCacheDir();
    const writer = new DiskCacheStore<string>({ cacheDir });
    await writer.put(contractKeys.attachment(), 'extraido');
    await writer.put(contractKeys.issue(), 'bundle');

    // Novo processo simulado: outra instância apontando para o mesmo diretório.
    const reader = new DiskCacheStore<string>({ cacheDir });
    expect(await reader.get(contractKeys.attachment())).toBe('extraido');
    expect(await reader.get(contractKeys.issue())).toBe('bundle');
  });

  it('invalidação persiste: a nova instância não vê a entrada removida', async () => {
    const cacheDir = freshCacheDir();
    const first = new DiskCacheStore<string>({ cacheDir });
    await first.put(contractKeys.issue(), 'bundle');
    await first.invalidate(contractKeys.issue());

    const second = new DiskCacheStore<string>({ cacheDir });
    expect(await second.get(contractKeys.issue())).toBeUndefined();
  });
});

describe('DiskCacheStore: normalização do instance_hash no layout', () => {
  it('URLs equivalentes (case, porta padrão, barra final) usam o MESMO diretório', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });

    const hashA = instanceHash('HTTPS://Redmine.Example:443/');
    const hashB = instanceHash('https://redmine.example');
    expect(hashA).toBe(hashB);

    // Gravar sob a forma "suja" e ler sob a forma "limpa" cai no mesmo path.
    await store.put(contractKeys.attachment({ instanceHash: hashA }), 'compartilhado');
    expect(await store.get(contractKeys.attachment({ instanceHash: hashB }))).toBe('compartilhado');

    const instanceDirs = readdirSync(cacheDir);
    expect(instanceDirs).toEqual([hashA]);
  });

  it('instâncias distintas nunca colidem no layout', async () => {
    const cacheDir = freshCacheDir();
    const store = new DiskCacheStore<string>({ cacheDir });
    const hashA = instanceHash('https://a.example');
    const hashB = instanceHash('https://b.example');

    await store.put(contractKeys.attachment({ instanceHash: hashA }), 'a');
    await store.put(contractKeys.attachment({ instanceHash: hashB }), 'b');

    expect(await store.get(contractKeys.attachment({ instanceHash: hashA }))).toBe('a');
    expect(await store.get(contractKeys.attachment({ instanceHash: hashB }))).toBe('b');
    expect(new Set(readdirSync(cacheDir))).toEqual(new Set([hashA, hashB]));
  });
});

describe('defaultCacheDir', () => {
  it('devolve um caminho absoluto do cache do usuário', () => {
    const dir = defaultCacheDir();
    expect(dir.length).toBeGreaterThan(0);
    expect(dir).toContain('redmine-context');
  });
});


/** Lista recursiva simples de arquivos sob `dir` (absolutos). */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

describe('fixes do review #131: JSON corrompido e digest hostil', () => {
  it('entrada corrompida em disco vira cache-miss com aviso (nunca crash)', async () => {
    const dir = freshCacheDir();
    const warn = vi.fn();
    const store = new DiskCacheStore<{ v: number }>({ cacheDir: dir, logger: { warn } });
    const key = contractKeys.attachment();
    await store.put(key, { v: 1 });
    const target = listFiles(dir).find((f) => f.endsWith('.json'));
    await writeFile(target as string, '{ nao é json', 'utf8');
    await expect(store.get(key)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('digest com ../ não escapa do cacheDir (normalizado por sha256) e continua recuperável', async () => {
    const dir = freshCacheDir();
    const store = new DiskCacheStore<{ v: number }>({ cacheDir: dir });
    const evil = contractKeys.attachment({ digest: '../../../../tmp/evil' });
    await store.put(evil, { v: 7 });
    const files = listFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f.startsWith(dir)).toBe(true);
    await expect(store.get(evil)).resolves.toEqual({ v: 7 });
  });

  it('digest não-hex (fallback Redmine antigo) é determinístico entre instâncias', async () => {
    const dir = freshCacheDir();
    const key = contractKeys.attachment({ digest: '123-4567-2026-01-01' });
    await new DiskCacheStore<{ v: number }>({ cacheDir: dir }).put(key, { v: 3 });
    await expect(new DiskCacheStore<{ v: number }>({ cacheDir: dir }).get(key)).resolves.toEqual({ v: 3 });
  });
});
