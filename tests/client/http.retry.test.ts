import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createHttpClient,
  RedmineHttpError,
  RedmineNotFoundError,
  type HttpClientOptions,
} from '../../src/client/index.js';

const API_KEY = 'super-secret-key-123';
const BASE_URL = 'https://redmine.example';

/** Cria uma Response fake para o mock de fetch (mesmo padrão de http.test.ts). */
function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? 'OK',
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Fake timers para não esperar de verdade o backoff.
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeClient(overrides: Partial<HttpClientOptions> = {}): ReturnType<typeof createHttpClient> {
  return createHttpClient({ baseUrl: BASE_URL, apiKey: API_KEY, ...overrides });
}

/**
 * Executa a promise sob fake timers, avançando todos os backoffs pendentes,
 * e devolve o resultado (ou o erro capturado) já resolvido.
 */
async function settleWithTimers<T>(promise: Promise<T>): Promise<T | unknown> {
  const captured = promise.catch((e: unknown) => e);
  await vi.runAllTimersAsync();
  return captured;
}

describe('createHttpClient: retry/backoff (issue #10)', () => {
  // --- Falha transiente: falha → sucesso ---

  it('retenta em 429 e resolve no sucesso seguinte', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(null, { status: 429, statusText: 'Too Many Requests' }))
      .mockResolvedValueOnce(jsonResponse({ issue: { id: 1 } }));

    const result = await settleWithTimers(makeClient().get('/issues/1.json'));

    expect(result).toEqual({ issue: { id: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retenta em 503 (5xx) e resolve no sucesso seguinte', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(null, { status: 503, statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await settleWithTimers(makeClient().get('/issues/1.json'));

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retenta em erro de rede transiente e resolve no sucesso seguinte', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await settleWithTimers(makeClient().get('/issues/1.json'));

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // --- Falha permanente: esgota as tentativas ---

  it('esgota as tentativas em 5xx persistente e lança o erro tipado (status preservado)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 500, statusText: 'Server Error' }));

    const err = await settleWithTimers(makeClient().get('/issues/1.json'));

    expect(err).toBeInstanceOf(RedmineHttpError);
    expect((err as RedmineHttpError).status).toBe(500);
    // Default = 3 tentativas.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('esgota as tentativas em erro de rede persistente sem vazar a api_key', async () => {
    fetchMock.mockRejectedValue(new Error(`ECONNREFUSED for key=${API_KEY}`));

    const err = await settleWithTimers(makeClient().get('/issues/1.json'));

    expect((err as Error).message).toMatch(/Falha de rede/i);
    expect((err as Error).message).not.toContain(API_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // --- Sem retry em 4xx (exceto 429) ---

  it('NÃO retenta em 404 e lança de imediato', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 404, statusText: 'Not Found' }));

    const err = await settleWithTimers(makeClient().get('/issues/1.json'));

    expect(err).toBeInstanceOf(RedmineNotFoundError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('NÃO retenta em 400 (bad request)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 400, statusText: 'Bad Request' }));

    const err = await settleWithTimers(makeClient().get('/issues/1.json'));

    expect((err as RedmineHttpError).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // --- maxAttempts configurável ---

  it('respeita maxAttempts configurável (1 = sem retry)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 500, statusText: 'Server Error' }));

    const err = await settleWithTimers(
      makeClient({ retry: { maxAttempts: 1 } }).get('/issues/1.json'),
    );

    expect((err as RedmineHttpError).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respeita maxAttempts maior que o default', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 429, statusText: 'Too Many Requests' }));

    const err = await settleWithTimers(
      makeClient({ retry: { maxAttempts: 5, baseDelayMs: 10 } }).get('/issues/1.json'),
    );

    expect((err as RedmineHttpError).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('sucesso na primeira tentativa não agenda nenhum backoff', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    const result = await settleWithTimers(makeClient().get('/issues/1.json'));

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
