/**
 * Testes da orquestração core de extração de anexos (M3-10, ADR-002/ADR-005).
 *
 * Cobrem o contrato observável de {@link extractIssueAttachments}: baixa cada
 * anexo de imagem (respeitando skip/limite), extrai via registry sob
 * {@link getOrCompute} (cache attachment-level com {@link buildAttachmentKey}) e
 * devolve `Map<attachmentId, ExtractionResult>`. Provam a degradação graciosa:
 * tesseract ausente ainda produz resultado (`failed` com motivo de instalação),
 * a falha de UM anexo não derruba os demais e o cache-hit não re-extrai.
 */

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryCacheStore } from '../src/cache/index.js';
import type { Attachment, ExtractionResult, Issue } from '../src/contract.js';
import { RedmineAuthError } from '../src/client/index.js';
import type { HttpClient } from '../src/client/index.js';
import {
  ExtractorRegistry,
  TesseractExtractor,
  type Extractor,
} from '../src/extract/index.js';
import { extractIssueAttachments } from '../src/index.js';

const INSTANCE_URL = 'https://redmine.example';

/** Assinatura PNG mínima — o suficiente para os magic bytes roteiarem o dispatcher. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** ReadableStream a partir de bytes fixos. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Anexo de imagem base; sobrescrevível por campo. */
function imageAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 7,
    filename: 'photo.png',
    filesize: 8,
    content_type: 'image/png',
    created_on: '2026-07-20T00:00:00Z',
    content_url: `${INSTANCE_URL}/attachments/download/7/photo.png`,
    digest: 'deadbeefcafe1234',
    ...overrides,
  };
}

/** Issue mínima com a lista de anexos informada. */
function issueWith(attachments: Attachment[]): Issue {
  return {
    id: 42,
    subject: 's',
    project: { id: 1, name: 'P' },
    tracker: { id: 1, name: 'T' },
    status: { id: 1, name: 'S' },
    priority: { id: 1, name: 'N' },
    author: { id: 1, name: 'A' },
    created_on: '2026-07-20T00:00:00Z',
    updated_on: '2026-07-20T00:00:00Z',
    custom_fields: [],
    journals: [],
    attachments,
    relations: [],
    children: [],
  };
}

/** Client HTTP falso: só `getBinary` importa aqui. */
function fakeHttp(getBinary: HttpClient['getBinary']): HttpClient {
  return { get: vi.fn(), getBinary };
}

/** Extrator fake registrável — expõe `model`/`params` para a chave de cache. */
function fakeExtractor(text = 'texto extraido do anexo'): Extractor & { extract: ReturnType<typeof vi.fn> } {
  return {
    id: 'fake-ocr',
    version: 'fake-1',
    model: 'fake-model',
    params: { lang: 'xx' },
    supportedMimes: ['image/png'],
    extract: vi.fn(async (_filePath: string, opts: { mime: string }): Promise<ExtractionResult> => ({
      status: 'done',
      text,
      mime: opts.mime,
      metadata: { extractorId: 'fake-ocr' },
    })),
  };
}

let cacheDir: string;
let store: InMemoryCacheStore<ExtractionResult>;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'rc-pipeline-'));
  store = new InMemoryCacheStore<ExtractionResult>();
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('extractIssueAttachments: pipeline feliz', () => {
  it('baixa, extrai via registry e devolve Map<id, result> com o texto', async () => {
    const extractor = fakeExtractor();
    const registry = new ExtractorRegistry().register(extractor);
    const http = fakeHttp(vi.fn().mockResolvedValue(streamOf(PNG_BYTES)));

    const map = await extractIssueAttachments(http, issueWith([imageAttachment()]), {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry,
    });

    const result = map.get(7);
    expect(result?.status).toBe('done');
    expect(result?.text).toBe('texto extraido do anexo');
    expect(extractor.extract).toHaveBeenCalledTimes(1);
  });

  it('ignora anexos que não são imagens (sem extrator registrado)', async () => {
    const registry = new ExtractorRegistry().register(fakeExtractor());
    const http = fakeHttp(vi.fn().mockResolvedValue(streamOf(PNG_BYTES)));

    const map = await extractIssueAttachments(
      http,
      issueWith([imageAttachment({ id: 9, filename: 'doc.pdf', content_type: 'application/pdf' })]),
      { instanceUrl: INSTANCE_URL, cacheDir, store, registry },
    );

    expect(map.has(9)).toBe(false);
  });

  it('anexo que excede o limite vira resultado skipped (não baixa)', async () => {
    const registry = new ExtractorRegistry().register(fakeExtractor());
    const getBinary = vi.fn();

    const map = await extractIssueAttachments(
      http_of(getBinary),
      issueWith([imageAttachment({ filesize: 5 })]),
      { instanceUrl: INSTANCE_URL, cacheDir, store, registry, maxBytes: 1 },
    );

    expect(map.get(7)?.status).toBe('skipped');
    expect(getBinary).not.toHaveBeenCalled();
  });
});

/** Atalho local para construir o http falso a partir de um getBinary. */
function http_of(getBinary: HttpClient['getBinary']): HttpClient {
  return fakeHttp(getBinary);
}

describe('extractIssueAttachments: degradação graciosa', () => {
  it('tesseract AUSENTE → resultado failed com motivo de instalação (não lança)', async () => {
    // Simula findTesseract() ausente: binaryPath undefined é exatamente o estado
    // que createDefaultRegistry monta quando o binário não é localizado.
    const registry = new ExtractorRegistry().register(
      new TesseractExtractor({ binaryPath: undefined, version: 'tesseract-integration-1' }),
    );
    const http = fakeHttp(vi.fn().mockResolvedValue(streamOf(PNG_BYTES)));

    const map = await extractIssueAttachments(http, issueWith([imageAttachment()]), {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry,
    });

    const result = map.get(7);
    expect(result?.status).toBe('failed');
    expect(String(result?.metadata?.['reason'])).toContain('tesseract-nao-instalado');
    expect(String(result?.metadata?.['hint'])).toContain('instale o tesseract');
  });

  it('falha de UM anexo não impede os demais (catch individual por anexo)', async () => {
    const registry = new ExtractorRegistry().register(fakeExtractor());
    const getBinary = vi.fn(async (path: string) => {
      if (path.includes('/download/99/')) throw new Error('conexão perdida');
      return streamOf(PNG_BYTES);
    });

    const map = await extractIssueAttachments(
      fakeHttp(getBinary),
      issueWith([imageAttachment({ id: 7 }), imageAttachment({ id: 99, digest: 'feedface00112233' })]),
      { instanceUrl: INSTANCE_URL, cacheDir, store, registry },
    );

    expect(map.get(7)?.status).toBe('done');
    expect(map.get(99)?.status).toBe('failed');
    expect(String(map.get(99)?.metadata?.['error'])).toContain('conexão perdida');
  });

  it('cache hit não re-extrai (getOrCompute serve do store, spy não é chamado)', async () => {
    const extractor = fakeExtractor();
    const registry = new ExtractorRegistry().register(extractor);
    const http = fakeHttp(vi.fn().mockResolvedValue(streamOf(PNG_BYTES)));
    const opts = { instanceUrl: INSTANCE_URL, cacheDir, store, registry } as const;

    await extractIssueAttachments(http, issueWith([imageAttachment()]), opts);
    await extractIssueAttachments(http, issueWith([imageAttachment()]), opts);

    // A segunda passada é servida do cache attachment-level: sem re-extração.
    expect(extractor.extract).toHaveBeenCalledTimes(1);
  });
});

describe('fixes do review #141', () => {
  it('RedmineAuthError propaga (credencial expirada não vira failed silencioso)', async () => {
    const registry = new ExtractorRegistry().register(fakeExtractor());
    const http = fakeHttp(vi.fn().mockRejectedValue(new RedmineAuthError('credencial expirada')));

    await expect(
      extractIssueAttachments(http, issueWith([imageAttachment()]), {
        instanceUrl: INSTANCE_URL,
        cacheDir,
        store,
        registry,
      }),
    ).rejects.toBeInstanceOf(RedmineAuthError);
  });
});
