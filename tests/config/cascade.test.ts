import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../src/client/index.js';
import {
  FileCredentialStore,
  createCredentialCascade,
  normalizeInstanceUrl,
  resolveApiKey,
} from '../../src/config/credentials.js';
import type { KeyringModule, KeyringModuleLoader } from '../../src/config/keyring.js';

const INSTANCE = 'https://redmine.example';
const KEYCHAIN_KEY = 'keychainKey123';
const FILE_KEY = 'fileKey456';
const ENV_KEY = 'envKey789';

/** Permissões POSIX só valem fora do Windows (mesmo guard da implementação). */
const posix = process.platform !== 'win32';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rc-cascade-'));
  filePath = join(dir, 'sub', 'credentials.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Lê os bits de permissão POSIX (mode & 0o777) de um caminho. */
async function perms(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

/**
 * Keychain nativo em memória: um `Map` guarda os segredos por `service account`,
 * exatamente como o binding real, permitindo simular disponibilidade sem tocar o
 * keychain do SO. Devolve também o `map` para seed/asserções.
 */
function memKeyring(): { loader: KeyringModuleLoader; map: Map<string, string> } {
  const map = new Map<string, string>();
  const loader: KeyringModuleLoader = () =>
    Promise.resolve({
      Entry: class {
        private readonly key: string;
        constructor(service: string, account: string) {
          this.key = `${service} ${account}`;
        }
        getPassword(): string | null {
          return map.get(this.key) ?? null;
        }
        setPassword(password: string): void {
          map.set(this.key, password);
        }
        deleteCredential(): boolean {
          return map.delete(this.key);
        }
      },
    } as unknown as KeyringModule);
  return { loader, map };
}

/** Loader que sempre falha — simula a ausência de prebuild (keychain indisponível). */
const failingLoader: KeyringModuleLoader = () =>
  Promise.reject(new Error('prebuild ausente para esta plataforma'));

/** Logger espião: captura mensagens de aviso para asserções. */
function spyLogger(): { logger: Logger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  return { logger: { warn }, warn };
}

/** Chave do keychain em memória para a instância (service default + account normalizado). */
function keychainKeyFor(instance: string): string {
  return `redmine-context ${normalizeInstanceUrl(instance)}`;
}

describe('cascata M2: ordem keychain → arquivo → env', () => {
  it('keychain vence arquivo e env', async () => {
    const { loader, map } = memKeyring();
    map.set(keychainKeyFor(INSTANCE), KEYCHAIN_KEY);
    await new FileCredentialStore({ filePath }).set(INSTANCE, FILE_KEY);

    const value = await resolveApiKey(INSTANCE, {
      filePath,
      keyringLoader: loader,
      env: { REDMINE_API_KEY: ENV_KEY },
    });
    expect(value).toBe(KEYCHAIN_KEY);
  });

  it('quando keychain vence, o arquivo NÃO é migrado nem alterado', async () => {
    const { loader, map } = memKeyring();
    map.set(keychainKeyFor(INSTANCE), KEYCHAIN_KEY);
    const file = new FileCredentialStore({ filePath });
    await file.set(INSTANCE, FILE_KEY);

    await resolveApiKey(INSTANCE, { filePath, keyringLoader: loader, env: {} });
    // Arquivo intacto: nada foi removido (a chave veio do keychain, não do arquivo).
    expect(await file.get(INSTANCE)).toBe(FILE_KEY);
  });

  it('arquivo vence env quando o keychain não tem a chave', async () => {
    const { loader } = memKeyring();
    await new FileCredentialStore({ filePath }).set(INSTANCE, FILE_KEY);

    const value = await resolveApiKey(INSTANCE, {
      filePath,
      keyringLoader: loader,
      env: { REDMINE_API_KEY: ENV_KEY },
    });
    expect(value).toBe(FILE_KEY);
  });

  it('env só vence quando keychain e arquivo não têm a chave', async () => {
    const { loader } = memKeyring();
    const value = await resolveApiKey(INSTANCE, {
      filePath,
      keyringLoader: loader,
      env: { REDMINE_API_KEY: ENV_KEY },
    });
    expect(value).toBe(ENV_KEY);
  });

  it('retorna undefined quando nenhuma fonte tem a chave', async () => {
    const { loader } = memKeyring();
    const value = await resolveApiKey(INSTANCE, { filePath, keyringLoader: loader, env: {} });
    expect(value).toBeUndefined();
  });
});

describe('cascata M2: migração automática arquivo → keychain', () => {
  it('migra do arquivo para o keychain, removendo do arquivo, com aviso único', async () => {
    const { loader, map } = memKeyring();
    const { logger, warn } = spyLogger();
    const file = new FileCredentialStore({ filePath });
    await file.set(INSTANCE, FILE_KEY);

    const value = await resolveApiKey(INSTANCE, { filePath, keyringLoader: loader, logger, env: {} });

    expect(value).toBe(FILE_KEY);
    // Gravado no keychain...
    expect(map.get(keychainKeyFor(INSTANCE))).toBe(FILE_KEY);
    // ...e removido do arquivo.
    expect(await file.get(INSTANCE)).toBeUndefined();
    // Aviso único e informativo.
    expect(warn).toHaveBeenCalledOnce();
  });

  it('nunca expõe a api_key no aviso de migração', async () => {
    const { loader } = memKeyring();
    const { logger, warn } = spyLogger();
    await new FileCredentialStore({ filePath }).set(INSTANCE, FILE_KEY);

    await resolveApiKey(INSTANCE, { filePath, keyringLoader: loader, logger, env: {} });

    const messages = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).not.toContain(FILE_KEY);
  });

  it('avisa apenas uma vez mesmo com múltiplas resoluções na mesma cascata', async () => {
    const { loader } = memKeyring();
    const { logger, warn } = spyLogger();
    await new FileCredentialStore({ filePath }).set(INSTANCE, FILE_KEY);

    const cascade = createCredentialCascade({ filePath, keyringLoader: loader, logger, env: {} });
    expect(await cascade.get(INSTANCE)).toBe(FILE_KEY); // migra + avisa
    expect(await cascade.get(INSTANCE)).toBe(FILE_KEY); // já no keychain, sem novo aviso
    expect(warn).toHaveBeenCalledOnce();
  });

  it('após migrar, a resolução seguinte vem do keychain', async () => {
    const { loader, map } = memKeyring();
    const file = new FileCredentialStore({ filePath });
    await file.set(INSTANCE, FILE_KEY);

    await resolveApiKey(INSTANCE, { filePath, keyringLoader: loader, env: {} });
    map.set(keychainKeyFor(INSTANCE), KEYCHAIN_KEY); // outra origem sobrescreve

    const value = await resolveApiKey(INSTANCE, { filePath, keyringLoader: loader, env: {} });
    expect(value).toBe(KEYCHAIN_KEY);
  });
});

describe('cascata M2: keychain indisponível degrada para arquivo', () => {
  it('resolve pelo arquivo e NÃO migra (sem aviso de migração)', async () => {
    const { logger, warn } = spyLogger();
    const file = new FileCredentialStore({ filePath });
    await file.set(INSTANCE, FILE_KEY);

    const value = await resolveApiKey(INSTANCE, {
      filePath,
      keyringLoader: failingLoader,
      logger,
      env: {},
    });

    expect(value).toBe(FILE_KEY);
    // Arquivo permanece — nada foi migrado.
    expect(await file.get(INSTANCE)).toBe(FILE_KEY);
    // A cascata não emite aviso de migração (o aviso de indisponibilidade é do store do #37).
    const messages = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).not.toMatch(/migr/i);
  });

  it('env continua vencível quando keychain indisponível e arquivo vazio', async () => {
    const value = await resolveApiKey(INSTANCE, {
      filePath,
      keyringLoader: failingLoader,
      env: { REDMINE_API_KEY: ENV_KEY },
    });
    expect(value).toBe(ENV_KEY);
  });
});

describe('cascata M2: escrita (login) prefere keychain', () => {
  it('set grava no keychain quando disponível, sem criar o arquivo', async () => {
    const { loader, map } = memKeyring();
    const cascade = createCredentialCascade({ filePath, keyringLoader: loader, env: {} });

    await cascade.set(INSTANCE, KEYCHAIN_KEY);

    expect(map.get(keychainKeyFor(INSTANCE))).toBe(KEYCHAIN_KEY);
    // Arquivo não foi criado.
    await expect(stat(filePath)).rejects.toThrow();
  });

  it('set degrada para o arquivo 0600 quando o keychain está indisponível', async () => {
    const cascade = createCredentialCascade({ filePath, keyringLoader: failingLoader, env: {} });

    await cascade.set(INSTANCE, FILE_KEY);

    expect(await new FileCredentialStore({ filePath }).get(INSTANCE)).toBe(FILE_KEY);
    if (posix) expect(await perms(filePath)).toBe(0o600);
  });

  it('delete remove a credencial do keychain e do arquivo', async () => {
    const { loader, map } = memKeyring();
    map.set(keychainKeyFor(INSTANCE), KEYCHAIN_KEY);
    const file = new FileCredentialStore({ filePath });
    await file.set(INSTANCE, FILE_KEY);

    await createCredentialCascade({ filePath, keyringLoader: loader, env: {} }).delete(INSTANCE);

    expect(map.has(keychainKeyFor(INSTANCE))).toBe(false);
    expect(await file.get(INSTANCE)).toBeUndefined();
  });
});
