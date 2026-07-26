import { describe, expect, it, vi } from 'vitest';

import type { CacheKey, CacheStore } from '../src/cache/index.js';
import type { Attachment, ExtractionResult, Issue } from '../src/index.js';
import {
  extractIssueAttachmentsCacheFirst,
  makeQueueBackgroundExtractor,
  processingResult,
  type BackgroundExtractionTarget,
} from '../src/index.js';
import { ExtractorRegistry, type Extractor } from '../src/extract/index.js';

/** Extrator fake que aceita um MIME e nunca é realmente executado no caminho cache-first. */
function fakeExtractor(mimes: readonly string[]): Extractor {
  return {
    id: 'fake-extractor',
    version: '1.0.0',
    supportedMimes: mimes,
    extract: vi.fn(async (): Promise<ExtractionResult> => ({ status: 'done', text: 'COMPUTED' })),
  };
}

/** Registry com um extrator fake registrado para os MIMEs dados. */
function registryFor(mimes: readonly string[]): ExtractorRegistry {
  return new ExtractorRegistry().register(fakeExtractor(mimes));
}

/** Anexo de imagem (probableMime → image/png). */
function pngAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 77,
    filename: 'shot.png',
    filesize: 8,
    content_type: 'image/png',
    created_on: '2024-01-01T00:00:00Z',
    content_url: 'https://redmine.example/attachments/download/77/shot.png',
    digest: 'abcdef0123456789',
    ...overrides,
  };
}

/** Issue mínima com os anexos dados. */
function issueWith(attachments: Attachment[]): Issue {
  return {
    id: 42,
    subject: 'Assunto',
    project: { id: 1, name: 'P' },
    tracker: { id: 2, name: 'Bug' },
    status: { id: 3, name: 'New' },
    priority: { id: 4, name: 'Normal' },
    author: { id: 5, name: 'Alice' },
    created_on: '2024-01-01T00:00:00Z',
    updated_on: '2024-01-02T00:00:00Z',
    custom_fields: [],
    journals: [],
    attachments,
    relations: [],
    children: [],
  };
}

/** Store fake: `get` controlável; as demais operações são no-op. */
function fakeStore(getImpl: (key: CacheKey) => Promise<ExtractionResult | undefined>): CacheStore<ExtractionResult> {
  return {
    get: vi.fn(getImpl),
    put: vi.fn(async () => undefined),
    invalidate: vi.fn(async () => undefined),
    lock: vi.fn(async <T>(_key: CacheKey, critical: () => Promise<T>) => critical()),
    gc: vi.fn(async () => undefined),
  };
}

const instanceUrl = 'https://redmine.example';

describe('extractIssueAttachmentsCacheFirst (leitura cache-first não-bloqueante)', () => {
  it('cache-hit: devolve a extração pronta imediatamente, sem disparar background', async () => {
    const store = fakeStore(async () => ({ status: 'done', text: 'READY' }));
    const background = vi.fn();

    const map = await extractIssueAttachmentsCacheFirst(issueWith([pngAttachment()]), {
      instanceUrl,
      registry: registryFor(['image/png']),
      store,
      background,
    });

    expect(map.get(77)).toEqual({ status: 'done', text: 'READY' });
    expect(background).not.toHaveBeenCalled();
  });

  it('cache-miss: marca processing e dispara o background com o alvo (chave inclusa)', async () => {
    const store = fakeStore(async () => undefined);
    const background = vi.fn();

    const map = await extractIssueAttachmentsCacheFirst(issueWith([pngAttachment()]), {
      instanceUrl,
      registry: registryFor(['image/png']),
      store,
      background,
    });

    expect(map.get(77)?.status).toBe('processing');
    expect(background).toHaveBeenCalledTimes(1);
    const target = background.mock.calls[0]?.[0] as BackgroundExtractionTarget;
    expect(target.attachment.id).toBe(77);
    expect(target.key.kind).toBe('attachment');
    expect(target.key.attachmentId).toBe(77);
  });

  it('sem extrator registrado: o anexo nem entra no mapa (paridade com o bloqueante)', async () => {
    const store = fakeStore(async () => undefined);

    const map = await extractIssueAttachmentsCacheFirst(
      issueWith([{ ...pngAttachment(), content_type: 'text/plain', filename: 'notes.txt' }]),
      { instanceUrl, registry: new ExtractorRegistry(), store },
    );

    expect(map.size).toBe(0);
  });

  it('miss sem background injetado: apenas sinaliza processing (não exige disparo — #71)', async () => {
    const store = fakeStore(async () => undefined);

    const map = await extractIssueAttachmentsCacheFirst(issueWith([pngAttachment()]), {
      instanceUrl,
      registry: registryFor(['image/png']),
      store,
    });

    expect(map.get(77)?.status).toBe('processing');
  });

  it('falha ao ler o cache: trata como miss (processing) e avisa pelo logger', async () => {
    const store = fakeStore(async () => {
      throw new Error('io-corrompido');
    });
    const warn = vi.fn();

    const map = await extractIssueAttachmentsCacheFirst(issueWith([pngAttachment()]), {
      instanceUrl,
      registry: registryFor(['image/png']),
      store,
      logger: { warn },
    });

    expect(map.get(77)?.status).toBe('processing');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('io-corrompido'));
  });

  it('TIMER: retorna em < 5s mesmo com extração pesada pendente (background que NUNCA resolve)', async () => {
    const store = fakeStore(async () => undefined);
    // Simula um vídeo cuja extração demoraria muito: o dispatcher lança uma
    // promise que jamais resolve. Se o handler a aguardasse, o teste travaria.
    const background = vi.fn(() => {
      void new Promise<never>(() => {
        /* nunca resolve */
      });
    });

    const started = performance.now();
    const map = await extractIssueAttachmentsCacheFirst(issueWith([pngAttachment()]), {
      instanceUrl,
      registry: registryFor(['image/png']),
      store,
      background,
    });
    const elapsedMs = performance.now() - started;

    expect(elapsedMs).toBeLessThan(5000);
    expect(map.get(77)?.status).toBe('processing');
    expect(background).toHaveBeenCalledTimes(1);
  });
});

describe('makeQueueBackgroundExtractor (job em background pela fila #67)', () => {
  it('não-bloqueante: retorna imediatamente, antes de o compute resolver', async () => {
    let resolveCompute: ((r: ExtractionResult) => void) | undefined;
    const computeStarted = vi.fn();
    const dispatcher = makeQueueBackgroundExtractor(async () => {
      computeStarted();
      return new Promise<ExtractionResult>((resolve) => {
        resolveCompute = resolve;
      });
    });

    const target: BackgroundExtractionTarget = {
      attachment: pngAttachment(),
      extractor: fakeExtractor(['image/png']),
      key: { kind: 'attachment', instanceHash: 'h', attachmentId: 77, digest: 'd', extractorVersion: 'v', model: 'm', params: {} },
    };

    const started = performance.now();
    dispatcher(target); // fire-and-forget: retorna já
    const elapsedMs = performance.now() - started;

    expect(elapsedMs).toBeLessThan(5000);
    // O compute é agendado pela fila; ainda não terminou (a promise segue pendente).
    await Promise.resolve();
    expect(resolveCompute).toBeDefined();
    resolveCompute?.({ status: 'done', text: 'ok' });
  });

  it('isolamento: um compute que rejeita vira aviso no logger, sem relançar', async () => {
    const warn = vi.fn();
    const dispatcher = makeQueueBackgroundExtractor(
      async () => {
        throw new Error('extracao-explodiu');
      },
      { logger: { warn } },
    );

    dispatcher({
      attachment: pngAttachment(),
      extractor: fakeExtractor(['image/png']),
      key: { kind: 'attachment', instanceHash: 'h', attachmentId: 77, digest: 'd', extractorVersion: 'v', model: 'm', params: {} },
    });

    // Aguarda a fila drenar (microtasks) e reportar a falha.
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('falhou')));
  });
});

describe('processingResult', () => {
  it('produz status processing com motivo/dica legíveis e sem texto', () => {
    const result = processingResult();
    expect(result.status).toBe('processing');
    expect(result.text).toBeUndefined();
    expect(typeof result.metadata?.['reason']).toBe('string');
    expect(typeof result.metadata?.['hint']).toBe('string');
  });
});
