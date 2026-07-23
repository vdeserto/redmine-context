import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAttachmentText, AttachmentNotFoundError } from '../src/index.js';

/** Response mínima OK com corpo JSON, no formato que o client espera. */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response;
}

/** Payload base de issue com uma lista de anexos injetável. */
function payloadWith(attachments: unknown[]): unknown {
  return {
    issue: {
      id: 42,
      subject: 'Assunto',
      description: 'Corpo',
      project: { id: 1, name: 'Projeto' },
      tracker: { id: 2, name: 'Bug' },
      status: { id: 3, name: 'New' },
      priority: { id: 4, name: 'Normal' },
      author: { id: 5, name: 'Alice' },
      created_on: '2024-01-01T00:00:00Z',
      updated_on: '2024-01-02T00:00:00Z',
      journals: [],
      attachments,
      relations: [],
      children: [],
    },
  };
}

/** Anexo de imagem PNG (magic bytes roteiam ao extrator de imagem). */
const pngAttachment = {
  id: 77,
  filename: 'shot.png',
  filesize: 8,
  content_type: 'image/png',
  created_on: '2024-01-01T00:00:00Z',
  content_url: 'https://redmine.example/attachments/download/77/shot.png',
  digest: 'abcdef0123456789',
};

/** Anexo textual sem extrator de imagem registrado (deve virar unsupported). */
const txtAttachment = {
  id: 88,
  filename: 'notes.txt',
  filesize: 12,
  content_type: 'text/plain',
  created_on: '2024-01-01T00:00:00Z',
  content_url: 'https://redmine.example/attachments/download/88/notes.txt',
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** fetch que serve o JSON da issue e bytes PNG no download do anexo. */
function stubFetch(payload: unknown): void {
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input).includes('/attachments/download/')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(PNG_BYTES);
            controller.close();
          },
        }),
      } as unknown as Response;
    }
    return jsonResponse(payload);
  });
  vi.stubGlobal('fetch', fetchMock);
}

const baseOpts = {
  baseUrl: 'https://redmine.example',
  apiKey: 'secret-key',
  issueId: 42,
} as const;

describe('fetchAttachmentText (orquestração get → normalize → extração de um anexo)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('anexo de imagem: roda o pipeline e devolve um ExtractionResult com status', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'rc-fat-ok-'));
    stubFetch(payloadWith([pngAttachment]));

    const result = await fetchAttachmentText({ ...baseOpts, attachmentId: 77, cacheDir });

    expect(result.attachmentId).toBe(77);
    // tesseract pode estar ausente no CI (failed) ou presente (done/text) — o
    // status sempre existe e nunca é 'unsupported' para uma imagem com extrator.
    expect(result.extraction.status).not.toBe('unsupported');

    await rm(cacheDir, { recursive: true, force: true });
  });

  it('cache-hit: a segunda chamada não baixa o anexo de novo (getOrCompute)', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'rc-fat-cache-'));
    stubFetch(payloadWith([pngAttachment]));

    await fetchAttachmentText({ ...baseOpts, attachmentId: 77, cacheDir });
    const downloadsBefore = vi.mocked(globalThis.fetch).mock.calls.filter((c) =>
      String(c[0]).includes('/attachments/download/'),
    ).length;

    await fetchAttachmentText({ ...baseOpts, attachmentId: 77, cacheDir });
    const downloadsAfter = vi.mocked(globalThis.fetch).mock.calls.filter((c) =>
      String(c[0]).includes('/attachments/download/'),
    ).length;

    expect(downloadsBefore).toBe(1);
    expect(downloadsAfter).toBe(1); // segunda chamada serviu do cache

    await rm(cacheDir, { recursive: true, force: true });
  });

  it('anexo sem extrator registrado: devolve status unsupported com motivo legível', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'rc-fat-unsup-'));
    stubFetch(payloadWith([txtAttachment]));

    const result = await fetchAttachmentText({ ...baseOpts, attachmentId: 88, cacheDir });

    expect(result.extraction.status).toBe('unsupported');
    expect(typeof result.extraction.metadata?.['reason']).toBe('string');

    await rm(cacheDir, { recursive: true, force: true });
  });

  it('anexo inexistente na issue: lança AttachmentNotFoundError tipado', async () => {
    stubFetch(payloadWith([pngAttachment]));

    await expect(fetchAttachmentText({ ...baseOpts, attachmentId: 999 })).rejects.toBeInstanceOf(
      AttachmentNotFoundError,
    );
  });

  it('issue inexistente: propaga o erro tipado 404 do Redmine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      } as unknown as Response),
    );

    await expect(fetchAttachmentText({ ...baseOpts, issueId: 999, attachmentId: 77 })).rejects.toMatchObject({
      status: 404,
    });
  });
});
