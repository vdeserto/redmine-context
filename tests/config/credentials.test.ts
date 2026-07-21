import { mkdtemp, rm, stat, writeFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CascadingCredentialStore,
  CredentialStoreError,
  EnvCredentialStore,
  FileCredentialStore,
  createCredentialCascade,
  normalizeInstanceUrl,
  resolveApiKey,
} from '../../src/config/credentials.js';

const INSTANCE = 'https://redmine.example';
const OTHER_INSTANCE = 'https://redmine.other.example';
const API_KEY = 'abc123apikey';
const OTHER_API_KEY = 'def456apikey';
const ENV_API_KEY = 'env789apikey';

/** Permissões POSIX só valem fora do Windows (mesmo guard da implementação). */
const posix = process.platform !== 'win32';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rc-cred-'));
  filePath = join(dir, 'sub', 'credentials.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Lê os bits de permissão POSIX (mode & 0o777) de um caminho. */
async function perms(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

describe('normalizeInstanceUrl', () => {
  it('coloca host em minúsculas e remove barra final', () => {
    expect(normalizeInstanceUrl('HTTPS://Redmine.Example/')).toBe('https://redmine.example');
  });

  it('remove portas padrão (443/80) mas preserva portas não padrão', () => {
    expect(normalizeInstanceUrl('https://redmine.example:443')).toBe('https://redmine.example');
    expect(normalizeInstanceUrl('http://redmine.example:80')).toBe('http://redmine.example');
    expect(normalizeInstanceUrl('https://redmine.example:8443/')).toBe(
      'https://redmine.example:8443',
    );
  });

  it('preserva o subpath sem barra final', () => {
    expect(normalizeInstanceUrl('https://host.example/redmine/')).toBe(
      'https://host.example/redmine',
    );
  });

  it('normaliza formas equivalentes para a mesma chave', () => {
    expect(normalizeInstanceUrl('https://Redmine.Example:443/')).toBe(
      normalizeInstanceUrl('https://redmine.example'),
    );
  });
});

describe('FileCredentialStore', () => {
  it('grava a chave criando dir 0700 e arquivo 0600', async () => {
    const store = new FileCredentialStore({ filePath });
    await store.set(INSTANCE, API_KEY);

    expect(await store.get(INSTANCE)).toBe(API_KEY);
    if (posix) {
      expect(await perms(filePath)).toBe(0o600);
      expect(await perms(join(dir, 'sub'))).toBe(0o700);
    }
  });

  it('armazena uma entrada por instância normalizada (multi-instância)', async () => {
    const store = new FileCredentialStore({ filePath });
    await store.set(INSTANCE, API_KEY);
    await store.set(OTHER_INSTANCE, OTHER_API_KEY);

    expect(await store.get(INSTANCE)).toBe(API_KEY);
    expect(await store.get(OTHER_INSTANCE)).toBe(OTHER_API_KEY);
    // Forma equivalente (maiúsculas/porta padrão/barra) mapeia para a mesma entrada.
    expect(await store.get('https://Redmine.Example:443/')).toBe(API_KEY);
  });

  it('retorna undefined quando o arquivo não existe', async () => {
    const store = new FileCredentialStore({ filePath });
    expect(await store.get(INSTANCE)).toBeUndefined();
  });

  it('retorna undefined para instância desconhecida', async () => {
    const store = new FileCredentialStore({ filePath });
    await store.set(INSTANCE, API_KEY);
    expect(await store.get(OTHER_INSTANCE)).toBeUndefined();
  });

  it('remove uma entrada com delete', async () => {
    const store = new FileCredentialStore({ filePath });
    await store.set(INSTANCE, API_KEY);
    await store.set(OTHER_INSTANCE, OTHER_API_KEY);
    await store.delete(INSTANCE);

    expect(await store.get(INSTANCE)).toBeUndefined();
    expect(await store.get(OTHER_INSTANCE)).toBe(OTHER_API_KEY);
  });

  it('delete é no-op quando o arquivo não existe', async () => {
    const store = new FileCredentialStore({ filePath });
    await expect(store.delete(INSTANCE)).resolves.toBeUndefined();
  });

  it.runIf(posix)('lança erro acionável com chmod quando a permissão é 0644', async () => {
    const store = new FileCredentialStore({ filePath });
    await store.set(INSTANCE, API_KEY);
    await chmod(filePath, 0o644);

    const error = await store.get(INSTANCE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialStoreError);
    expect((error as Error).message).toContain(`chmod 600 ${filePath}`);
    // A api_key nunca aparece na mensagem de erro.
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('ignora conteúdo inválido no JSON e trata entradas ausentes', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true, mode: 0o700 });
    await writeFile(filePath, JSON.stringify({ [INSTANCE]: { nope: 1 }, bad: 5 }), {
      mode: 0o600,
    });
    const store = new FileCredentialStore({ filePath });
    expect(await store.get(INSTANCE)).toBeUndefined();
  });
});

describe('EnvCredentialStore', () => {
  it('lê a chave da variável de ambiente configurada', async () => {
    const store = new EnvCredentialStore({ varName: 'REDMINE_API_KEY', env: { REDMINE_API_KEY: ENV_API_KEY } });
    expect(await store.get(INSTANCE)).toBe(ENV_API_KEY);
  });

  it('retorna undefined quando a variável está vazia ou ausente', async () => {
    const store = new EnvCredentialStore({ env: { REDMINE_API_KEY: '' } });
    expect(await store.get(INSTANCE)).toBeUndefined();
  });

  it('set e delete lançam por ser somente leitura', async () => {
    const store = new EnvCredentialStore({ env: {} });
    await expect(store.set()).rejects.toBeInstanceOf(CredentialStoreError);
    await expect(store.delete()).rejects.toBeInstanceOf(CredentialStoreError);
  });
});

describe('cascata (arquivo → env)', () => {
  it('usa o arquivo quando presente (arquivo vence env)', async () => {
    const fileStore = new FileCredentialStore({ filePath });
    await fileStore.set(INSTANCE, API_KEY);

    const value = await resolveApiKey(INSTANCE, {
      filePath,
      env: { REDMINE_API_KEY: ENV_API_KEY },
    });
    expect(value).toBe(API_KEY);
  });

  it('cai para o env quando o arquivo não tem a instância (CI/headless)', async () => {
    const value = await resolveApiKey(INSTANCE, {
      filePath,
      env: { REDMINE_API_KEY: ENV_API_KEY },
    });
    expect(value).toBe(ENV_API_KEY);
  });

  it('retorna undefined quando nem arquivo nem env têm a chave', async () => {
    const value = await resolveApiKey(INSTANCE, { filePath, env: {} });
    expect(value).toBeUndefined();
  });

  it('createCredentialCascade grava via o primeiro store (arquivo)', async () => {
    const cascade = createCredentialCascade({ filePath, env: {} });
    await cascade.set(INSTANCE, API_KEY);
    expect(await cascade.get(INSTANCE)).toBe(API_KEY);
    if (posix) expect(await perms(filePath)).toBe(0o600);
  });

  it('CascadingCredentialStore exige ao menos um store', () => {
    expect(() => new CascadingCredentialStore([])).toThrow(CredentialStoreError);
  });
});
