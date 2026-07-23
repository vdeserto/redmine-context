import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchIssueBundle, type CoreEvent, type IssueBundleResult } from '../src/index.js';

/** Response mínima OK com corpo JSON, no formato que o client espera. */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response;
}

/** Payload de issue suficiente para exercitar normalize + bundle. */
const payload = {
  issue: {
    id: 42,
    subject: 'Assunto de teste',
    description: 'Corpo da issue',
    project: { id: 1, name: 'Projeto' },
    tracker: { id: 2, name: 'Bug' },
    status: { id: 3, name: 'New' },
    priority: { id: 4, name: 'Normal' },
    author: { id: 5, name: 'Alice' },
    created_on: '2024-01-01T00:00:00Z',
    updated_on: '2024-01-02T00:00:00Z',
    journals: [],
    attachments: [],
    relations: [],
    children: [],
  },
};

const baseOpts = {
  baseUrl: 'https://redmine.example',
  apiKey: 'secret-key',
  issueId: 42,
  toolVersion: '0.1.0',
} as const;

/** Drena o iterable coletando estágios de progresso e o resultado final. */
async function drain(
  iterable: AsyncIterable<CoreEvent<IssueBundleResult>>,
): Promise<{ stages: string[]; result: IssueBundleResult | undefined }> {
  const stages: string[] = [];
  let result: IssueBundleResult | undefined;
  for await (const event of iterable) {
    if (event.kind === 'progress') stages.push(event.stage);
    else result = event.value;
  }
  return { stages, result };
}

describe('fetchIssueBundle (orquestração get → normalize → bundle)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('emite progresso e finaliza com bundle Markdown por padrão', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    const { stages, result } = await drain(fetchIssueBundle({ ...baseOpts, format: 'md' }));

    expect(stages).toEqual(['connect', 'fetch', 'normalize', 'bundle']);
    expect(result?.format).toBe('md');
    expect(result?.issueId).toBe(42);
    expect(result?.content).toContain('Assunto de teste');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('emite JSON canônico e determinístico com format json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));

    const first = await drain(fetchIssueBundle({ ...baseOpts, format: 'json' }));
    const second = await drain(fetchIssueBundle({ ...baseOpts, format: 'json' }));

    expect(first.result?.content).toBe(second.result?.content);
    const parsed = JSON.parse(first.result?.content ?? '{}') as { schema_version: string; issue: { id: number } };
    expect(parsed.schema_version).toBe('1.0');
    expect(parsed.issue.id).toBe(42);
  });

  it('extractAttachments=false (default) não emite estágio de extração', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));
    const { stages } = await drain(fetchIssueBundle({ ...baseOpts, format: 'md' }));
    expect(stages).not.toContain('extract');
  });

  it('extractAttachments=true embute a seção de texto extraído do anexo no bundle', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'rc-fib-extract-'));
    // PNG mínimo para os magic bytes roteiarem ao extrator de imagem.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const withAttachment = {
      issue: {
        ...payload.issue,
        attachments: [
          {
            id: 77,
            filename: 'shot.png',
            filesize: 8,
            content_type: 'image/png',
            created_on: '2024-01-01T00:00:00Z',
            content_url: 'https://redmine.example/attachments/download/77/shot.png',
            digest: 'abcdef0123456789',
          },
        ],
      },
    };
    // fetch serve JSON no detalhe da issue e bytes no download do anexo.
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/attachments/download/')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(pngBytes);
              controller.close();
            },
          }),
        } as unknown as Response;
      }
      return jsonResponse(withAttachment);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { stages, result } = await drain(
      fetchIssueBundle({ ...baseOpts, format: 'md', extractAttachments: true, cacheDir }),
    );

    expect(stages).toContain('extract');
    expect(result?.content).toContain('Anexo #77');
    expect(result?.content).toContain('Texto extraído');

    await rm(cacheDir, { recursive: true, force: true });
  });

  it('propaga erro tipado para issue inexistente (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      } as unknown as Response),
    );

    await expect(drain(fetchIssueBundle({ ...baseOpts, issueId: 999, format: 'md' }))).rejects.toMatchObject({
      status: 404,
    });
  });
});
