/**
 * Testes do `getBinary` do client HTTP (M3-06, issue #48).
 *
 * `getBinary` baixa o corpo BRUTO (sem parse JSON), herdando a mesma autenticação,
 * política de TLS e retry/backoff transiente de `get`, e falhando com os MESMOS
 * erros tipados (401/403/404/…). Cobre: header de auth, stream de bytes de volta,
 * mapeamento de 404 tipado, retry em 5xx e ausência de corpo (204).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createHttpClient,
  RedmineNotFoundError,
  type HttpClientOptions,
} from '../../src/client/index.js';

const API_KEY = 'super-secret-key-123';
const BASE_URL = 'https://redmine.example';

/** Response fake com corpo binário (ReadableStream) para o mock de fetch. */
function binaryResponse(
  chunks: Uint8Array[],
  init: { status?: number; statusText?: string } = {},
): Response {
  const status = init.status ?? 200;
  const body =
    status === 204
      ? null
      : new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(chunk);
            }
            controller.close();
          },
        });
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? 'OK',
    body,
  } as unknown as Response;
}

/** Lê um ReadableStream até o fim, concatenando os bytes. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) parts.push(...value);
  }
  return new Uint8Array(parts);
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

describe('getBinary: download bruto autenticado', () => {
  it('envia a api_key no header e retorna o stream de bytes', async () => {
    fetchMock.mockResolvedValue(binaryResponse([new Uint8Array([1, 2, 3])]));
    const stream = await makeClient().getBinary('/attachments/download/7/foo.png');

    const headers = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((headers?.headers as Record<string, string>)['X-Redmine-API-Key']).toBe(API_KEY);
    expect(await drain(stream)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('não faz parse JSON: devolve exatamente os bytes recebidos', async () => {
    fetchMock.mockResolvedValue(binaryResponse([new Uint8Array([255, 0, 128])]));
    const stream = await makeClient().getBinary('/attachments/download/1/x.bin');
    expect(await drain(stream)).toEqual(new Uint8Array([255, 0, 128]));
  });

  it('mapeia 404 para RedmineNotFoundError', async () => {
    fetchMock.mockResolvedValue(binaryResponse([], { status: 404, statusText: 'Not Found' }));
    await expect(makeClient().getBinary('/attachments/download/9/x.png')).rejects.toBeInstanceOf(
      RedmineNotFoundError,
    );
  });

  it('faz retry em 5xx e sucede na tentativa seguinte', async () => {
    fetchMock
      .mockResolvedValueOnce(binaryResponse([], { status: 503, statusText: 'Unavailable' }))
      .mockResolvedValueOnce(binaryResponse([new Uint8Array([7])]));
    const stream = await makeClient({ retry: { maxAttempts: 2, baseDelayMs: 0 } }).getBinary(
      '/attachments/download/2/y.png',
    );
    expect(await drain(stream)).toEqual(new Uint8Array([7]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lança erro claro quando a resposta 2xx vem sem corpo (204)', async () => {
    fetchMock.mockResolvedValue(binaryResponse([], { status: 204, statusText: 'No Content' }));
    await expect(makeClient().getBinary('/attachments/download/3/z.png')).rejects.toThrow(
      /sem corpo/i,
    );
  });
});
