/**
 * Testes do store de settings não-secretas e do resolvedor de instância (#187).
 * Store real em arquivo temporário (sem mock de fs); resolvedor puro.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSettingsStore, resolveInstanceUrl } from '../../src/config/settings.js';

const dirs: string[] = [];
function tmpPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rc-settings-'));
  dirs.push(dir);
  return join(dir, 'nested', 'settings.json'); // 'nested' prova o mkdir recursivo
}

afterEach(() => {
  dirs.length = 0;
});

describe('FileSettingsStore', () => {
  it('get em arquivo inexistente → undefined (sem lançar)', async () => {
    const store = new FileSettingsStore({ filePath: tmpPath() });
    expect(await store.getInstanceUrl()).toBeUndefined();
  });

  it('set persiste e normaliza a URL; get devolve a normalizada', async () => {
    const filePath = tmpPath();
    const store = new FileSettingsStore({ filePath });
    await store.setInstanceUrl('HTTPS://Redmine.Example:443/');
    expect(await store.getInstanceUrl()).toBe('https://redmine.example');
    // Round-trip por uma nova instância (lê do disco).
    expect(await new FileSettingsStore({ filePath }).getInstanceUrl()).toBe('https://redmine.example');
  });

  it('clear remove a URL persistida', async () => {
    const store = new FileSettingsStore({ filePath: tmpPath() });
    await store.setInstanceUrl('https://redmine.example');
    await store.clearInstanceUrl();
    expect(await store.getInstanceUrl()).toBeUndefined();
  });

  it('clear é no-op quando não há nada persistido', async () => {
    const store = new FileSettingsStore({ filePath: tmpPath() });
    await expect(store.clearInstanceUrl()).resolves.toBeUndefined();
  });

  it('JSON corrompido degrada para "sem config" (não trava o boot)', async () => {
    const filePath = tmpPath();
    const store = new FileSettingsStore({ filePath });
    await store.setInstanceUrl('https://redmine.example'); // cria o diretório
    writeFileSync(filePath, '{ isto não é json');
    expect(await store.getInstanceUrl()).toBeUndefined();
  });

  it('preserva chaves desconhecidas ao regravar (formato evolutivo)', async () => {
    const filePath = tmpPath();
    const store = new FileSettingsStore({ filePath });
    await store.setInstanceUrl('https://a.example'); // garante o diretório
    writeFileSync(filePath, JSON.stringify({ instanceUrl: 'https://a.example', futuro: 42 }));
    await store.setInstanceUrl('https://b.example');
    const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(onDisk.instanceUrl).toBe('https://b.example');
    expect(onDisk.futuro).toBe(42);
  });
});

describe('resolveInstanceUrl (precedência flag → env → config)', () => {
  it('flag vence env e persistida', () => {
    expect(
      resolveInstanceUrl({ flagUrl: 'https://flag', envUrl: 'https://env', persistedUrl: 'https://cfg' }),
    ).toEqual({ url: 'https://flag', origin: 'flag' });
  });

  it('env vence persistida quando não há flag', () => {
    expect(resolveInstanceUrl({ envUrl: 'https://env', persistedUrl: 'https://cfg' })).toEqual({
      url: 'https://env',
      origin: 'env',
    });
  });

  it('cai na persistida quando flag/env ausentes ou vazios', () => {
    expect(resolveInstanceUrl({ flagUrl: '  ', envUrl: '', persistedUrl: 'https://cfg' })).toEqual({
      url: 'https://cfg',
      origin: 'config',
    });
  });

  it('undefined quando nenhuma fonte tem valor', () => {
    expect(resolveInstanceUrl({ envUrl: '', persistedUrl: undefined })).toBeUndefined();
  });
});
