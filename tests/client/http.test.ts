import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createHttpClient,
  redactSecret,
  RedmineAuthError,
  RedmineForbiddenError,
  RedmineNotFoundError,
  RedmineHttpError,
  type HttpClientOptions,
} from '../../src/client/index.js';

const API_KEY = 'super-secret-key-123';
const BASE_URL = 'https://redmine.example';

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

/** Extrai a URL efetivamente passada ao fetch mockado. */
function fetchedUrl(mock: ReturnType<typeof vi.fn>): string {
  const arg = mock.mock.calls[0]?.[0] as URL | string | undefined;
  return arg instanceof URL ? arg.toString() : String(arg);
}

/** Extrai os headers efetivamente passados ao fetch mockado. */
function fetchedHeaders(mock: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = mock.mock.calls[0]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
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

function makeClient(overrides: Partial<HttpClientOptions> = {}): ReturnType<typeof createHttpClient> {
  return createHttpClient({ baseUrl: BASE_URL, apiKey: API_KEY, ...overrides });
}

describe('createHttpClient: autenticação (ADR-003)', () => {
  // Caso esperado: api_key vai no header X-Redmine-API-Key por default.
  it('envia a api_key no header X-Redmine-API-Key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await makeClient().get('/issues/1.json');

    expect(fetchedHeaders(fetchMock)['X-Redmine-API-Key']).toBe(API_KEY);
    expect(fetchedUrl(fetchMock)).not.toContain('key=');
  });

  // Fallback explícito: com keyInQuery, a key vai em ?key= e NÃO no header.
  it('usa fallback ?key= quando keyInQuery=true e não envia o header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await makeClient({ keyInQuery: true }).get('/issues/1.json');

    const url = new URL(fetchedUrl(fetchMock));
    expect(url.searchParams.get('key')).toBe(API_KEY);
    expect(fetchedHeaders(fetchMock)['X-Redmine-API-Key']).toBeUndefined();
  });

  it('aplica params de query e retorna o JSON parseado', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ issue: { id: 1 } }));
    const body = await makeClient().get('/issues/1.json', { include: 'journals', limit: 10 });

    const url = new URL(fetchedUrl(fetchMock));
    expect(url.searchParams.get('include')).toBe('journals');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(body).toEqual({ issue: { id: 1 } });
  });

  it('rejeita apiKey vazia', () => {
    expect(() => makeClient({ apiKey: '' })).toThrow(/apiKey/);
  });
});

describe('createHttpClient: política de TLS (ADR-003)', () => {
  // Falha acionável: http:// recusado por default.
  it('recusa http:// por default com erro acionável', () => {
    expect(() => makeClient({ baseUrl: 'http://redmine.example' })).toThrow(/TLS.*obrigatório/i);
  });

  it('aceita https:// sem aviso', () => {
    const warn = vi.fn();
    makeClient({ logger: { warn } });
    expect(warn).not.toHaveBeenCalled();
  });

  // insecure só com aviso ruidoso via logger (nunca console.*).
  it('permite http:// com insecure=true e emite warn ruidoso', () => {
    const warn = vi.fn();
    makeClient({ baseUrl: 'http://redmine.example', insecure: true, logger: { warn } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/insegura/i);
  });

  it('rejeita baseUrl malformada', () => {
    expect(() => makeClient({ baseUrl: 'not a url' })).toThrow(/baseUrl inválida/i);
  });

  it('rejeita esquema não http(s)', () => {
    expect(() => makeClient({ baseUrl: 'ftp://redmine.example' })).toThrow(/Esquema não suportado/i);
  });
});

describe('createHttpClient: mapeamento de erros HTTP', () => {
  it('mapeia 401 para RedmineAuthError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 401, statusText: 'Unauthorized' }));
    await expect(makeClient().get('/issues/1.json')).rejects.toBeInstanceOf(RedmineAuthError);
  });

  it('mapeia 403 para RedmineForbiddenError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 403, statusText: 'Forbidden' }));
    await expect(makeClient().get('/issues/1.json')).rejects.toBeInstanceOf(RedmineForbiddenError);
  });

  it('mapeia 404 para RedmineNotFoundError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 404, statusText: 'Not Found' }));
    await expect(makeClient().get('/issues/1.json')).rejects.toBeInstanceOf(RedmineNotFoundError);
  });

  it('mapeia demais status ≥400 para RedmineHttpError com status preservado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 500, statusText: 'Server Error' }));
    const err = await makeClient()
      .get('/issues/1.json')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedmineHttpError);
    expect((err as RedmineHttpError).status).toBe(500);
    // Subclasses NÃO devem casar para status genérico.
    expect(err).not.toBeInstanceOf(RedmineAuthError);
  });

  it('encapsula falha de rede sem vazar a api_key', async () => {
    fetchMock.mockRejectedValue(new Error(`ECONNREFUSED for key=${API_KEY}`));
    const err = await makeClient()
      .get('/issues/1.json')
      .catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/Falha de rede/i);
    expect((err as Error).message).not.toContain(API_KEY);
  });

  it('lança erro legível quando o corpo não é JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new Error('Unexpected token');
      },
    } as unknown as Response);
    await expect(makeClient().get('/issues/1.json')).rejects.toThrow(/não é JSON válido/i);
  });
});

describe('redação de segredos (api_key NUNCA logada)', () => {
  it('não inclui a api_key na mensagem de erro nem em url (keyInQuery)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 404, statusText: 'Not Found' }));
    const err = await makeClient({ keyInQuery: true })
      .get('/issues/1.json')
      .catch((e: unknown) => e);
    const e = err as RedmineNotFoundError;
    expect(e.message).not.toContain(API_KEY);
    expect(e.url).not.toContain(API_KEY);
    expect(e.url).toContain('[REDACTED]');
  });

  it('redactSecret remove o segredo em texto e em ?key=', () => {
    expect(redactSecret(`token=${API_KEY} end`, API_KEY)).toBe('token=[REDACTED] end');
    expect(redactSecret('https://x/y?key=ABC123&z=1', 'nomatch')).toBe(
      'https://x/y?key=[REDACTED]&z=1',
    );
  });

  it('redactSecret é no-op seguro com segredo vazio', () => {
    expect(redactSecret('nada a redigir', '')).toBe('nada a redigir');
  });
});

describe('redactSecret: api_key com caracteres URL-unsafe', () => {
  it('redige a forma bruta e a forma percent-encoded da key', async () => {
    const { redactSecret } = await import('../../src/client/http.js');
    const key = 'ab&c=d/e f';
    const encoded = encodeURIComponent(key);
    const text = `raw:${key} url:https://r.example/issues.json?key=${encoded}&x=1`;
    const out = redactSecret(text, key);
    expect(out).not.toContain(key);
    expect(out).not.toContain(encoded);
  });
});
