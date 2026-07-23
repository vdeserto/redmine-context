import { Buffer } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedmineAuthError } from '../../src/client/index.js';
import {
  loginWithPassword,
  validateApiKey,
  RedmineLoginError,
  type LoginOptions,
  type ValidateApiKeyOptions,
} from '../../src/config/login.js';

const BASE_URL = 'https://redmine.example';
const USERNAME = 'alice';
const PASSWORD = 'sup3r-s3cr3t-p4ss';
const API_KEY = 'abc123apikey';

/** Cria uma Response fake para o mock de fetch. */
function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? 'OK',
    json: async () => body,
  } as unknown as Response;
}

/** Corpo típico de `/users/current.json`. */
function currentUserBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    user: {
      id: 42,
      login: USERNAME,
      firstname: 'Alice',
      lastname: 'Liddell',
      api_key: API_KEY,
      ...overrides,
    },
  };
}

/** Extrai os headers efetivamente passados ao fetch mockado. */
function fetchedHeaders(mock: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = mock.mock.calls[0]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}

/** Extrai a URL efetivamente passada ao fetch mockado. */
function fetchedUrl(mock: ReturnType<typeof vi.fn>): string {
  return String(mock.mock.calls[0]?.[0]);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function login(overrides: Partial<LoginOptions> = {}): Promise<Awaited<ReturnType<typeof loginWithPassword>>> {
  return loginWithPassword({
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD,
    ...overrides,
  });
}

describe('loginWithPassword: sucesso', () => {
  it('faz Basic auth em /users/current.json e retorna api_key + user', async () => {
    fetchMock.mockResolvedValue(jsonResponse(currentUserBody()));

    const result = await login();

    expect(result).toEqual({
      apiKey: API_KEY,
      user: { id: 42, login: USERNAME, name: 'Alice Liddell' },
    });
    expect(fetchedUrl(fetchMock)).toBe(`${BASE_URL}/users/current.json`);
  });

  it('envia o header Authorization: Basic base64(user:pass)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(currentUserBody()));
    await login();

    const token = Buffer.from(`${USERNAME}:${PASSWORD}`, 'utf8').toString('base64');
    expect(fetchedHeaders(fetchMock).Authorization).toBe(`Basic ${token}`);
    // A senha em texto puro NUNCA vai no header.
    expect(JSON.stringify(fetchedHeaders(fetchMock))).not.toContain(PASSWORD);
  });

  it('usa o login como name quando firstname/lastname ausentes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(currentUserBody({ firstname: undefined, lastname: undefined })),
    );
    const result = await login();
    expect(result.user.name).toBe(USERNAME);
  });

  it('preserva subpath da baseUrl e remove barra final', async () => {
    fetchMock.mockResolvedValue(jsonResponse(currentUserBody()));
    await login({ baseUrl: 'https://host.example/redmine/' });
    expect(fetchedUrl(fetchMock)).toBe('https://host.example/redmine/users/current.json');
  });
});

describe('loginWithPassword: falha de autenticação (401 / 2FA)', () => {
  it('lança RedmineAuthError com instrução acionável para /my/account', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 401, statusText: 'Unauthorized' }));

    const err = await login().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RedmineAuthError);
    const message = (err as RedmineAuthError).message;
    expect(message).toMatch(/2FA|dois fatores/i);
    expect(message).toContain(`${BASE_URL}/my/account`);
    expect((err as RedmineAuthError).status).toBe(401);
  });
});

describe('loginWithPassword: REST desabilitada (sem api_key)', () => {
  it('lança RedmineLoginError claro quando a resposta não traz api_key', async () => {
    fetchMock.mockResolvedValue(jsonResponse(currentUserBody({ api_key: undefined })));

    const err = await login().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RedmineLoginError);
    expect((err as RedmineLoginError).message).toMatch(/api.?key|REST/i);
    expect((err as RedmineLoginError).message).toContain(`${BASE_URL}/my/account`);
  });

  it('lança RedmineLoginError quando o corpo não tem usuário válido', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nope: true }));
    await expect(login()).rejects.toBeInstanceOf(RedmineLoginError);
  });
});

describe('loginWithPassword: senha NUNCA vaza em mensagens de erro', () => {
  it('redige a senha se ela aparecer numa falha de rede de baixo nível', async () => {
    fetchMock.mockRejectedValue(new Error(`connect failed leaking ${PASSWORD} oops`));

    const err = await login().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RedmineLoginError);
    expect((err as Error).message).not.toContain(PASSWORD);
    expect((err as Error).message).toContain('[REDACTED]');
  });

  it('não inclui a senha em erro de status genérico', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(null, { status: 500, statusText: `boom ${PASSWORD}` }),
    );
    const err = await login().catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(PASSWORD);
  });

  it('não inclui a senha em erro de JSON inválido', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new Error(`parse failed near ${PASSWORD}`);
      },
    } as unknown as Response);
    const err = await login().catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(PASSWORD);
    expect((err as Error).message).toMatch(/não é JSON válido/i);
  });
});

describe('loginWithPassword: validações de entrada e TLS', () => {
  it('rejeita username vazio antes de qualquer fetch', async () => {
    await expect(login({ username: '' })).rejects.toBeInstanceOf(RedmineLoginError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita password vazia antes de qualquer fetch', async () => {
    await expect(login({ password: '' })).rejects.toBeInstanceOf(RedmineLoginError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa http:// por default (política de TLS reutilizada)', async () => {
    await expect(login({ baseUrl: 'http://redmine.example' })).rejects.toThrow(
      /TLS.*obrigatório/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('permite http:// com insecure=true e emite warn ruidoso', async () => {
    const warn = vi.fn();
    fetchMock.mockResolvedValue(jsonResponse(currentUserBody()));
    await login({ baseUrl: 'http://redmine.example', insecure: true, logger: { warn } });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

function validate(
  overrides: Partial<ValidateApiKeyOptions> = {},
): Promise<Awaited<ReturnType<typeof validateApiKey>>> {
  return validateApiKey({ baseUrl: BASE_URL, apiKey: API_KEY, ...overrides });
}

describe('validateApiKey: sucesso (fallback de 2FA — colar api_key)', () => {
  it('autentica via X-Redmine-API-Key em /users/current.json e retorna api_key + user', async () => {
    fetchMock.mockResolvedValue(jsonResponse(currentUserBody()));

    const result = await validate();

    expect(result).toEqual({
      apiKey: API_KEY,
      user: { id: 42, login: USERNAME, name: 'Alice Liddell' },
    });
    expect(fetchedUrl(fetchMock)).toBe(`${BASE_URL}/users/current.json`);
    expect(fetchedHeaders(fetchMock)['X-Redmine-API-Key']).toBe(API_KEY);
  });

  it('preserva subpath da baseUrl e remove barra final', async () => {
    fetchMock.mockResolvedValue(jsonResponse(currentUserBody()));
    await validate({ baseUrl: 'https://host.example/redmine/' });
    expect(fetchedUrl(fetchMock)).toBe('https://host.example/redmine/users/current.json');
  });
});

describe('validateApiKey: key inválida (401)', () => {
  it('lança RedmineAuthError com instrução acionável para /my/account', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 401, statusText: 'Unauthorized' }));

    const err = await validate().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RedmineAuthError);
    const message = (err as RedmineAuthError).message;
    expect(message).toMatch(/inválida|expirada/i);
    expect(message).toContain(`${BASE_URL}/my/account`);
    expect((err as RedmineAuthError).status).toBe(401);
  });
});

describe('validateApiKey: validações de entrada, TLS e vazamento de segredo', () => {
  it('rejeita api_key vazia antes de qualquer fetch', async () => {
    await expect(validate({ apiKey: '' })).rejects.toBeInstanceOf(RedmineLoginError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa http:// por default (política de TLS reutilizada)', async () => {
    await expect(validate({ baseUrl: 'http://redmine.example' })).rejects.toThrow(
      /TLS.*obrigatório/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lança RedmineLoginError quando o corpo não tem usuário válido', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nope: true }));
    await expect(validate()).rejects.toBeInstanceOf(RedmineLoginError);
  });

  it('redige a api_key se ela aparecer numa falha de rede de baixo nível', async () => {
    fetchMock.mockRejectedValue(new Error(`connect failed leaking ${API_KEY} oops`));

    const err = await validate().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RedmineLoginError);
    expect((err as Error).message).not.toContain(API_KEY);
    expect((err as Error).message).toContain('[REDACTED]');
  });
});
