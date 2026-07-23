/**
 * Teste de INTEGRAÇÃO do cache de 2 camadas (M3-12, ADR-004).
 *
 * É o critério de aceitação central do cache local: prova, ponta a ponta e com os
 * componentes REAIS (`DiskCacheStore` sobre um `mkdtemp`, `buildAttachmentKey`,
 * `getOrCompute`, os bundles Markdown/JSON), que as duas camadas do ADR-004 não se
 * confundem. Só o extrator (a peça CARA) é falso — um `vi.fn()` espionado — e o
 * HTTP é mockado, de modo que "o extrator NÃO rodou de novo" seja uma asserção
 * direta sobre o spy, não uma inferência.
 *
 * Invariantes exercitadas (ADR-004):
 * 1. A chave da camada de attachment NÃO depende de `updated_on` da issue: um
 *    comentário novo (novo journal → `updated_on` muda) regenera o bundle (camada
 *    de issue) REUTILIZANDO 100% da extração cara do anexo imutável — o extrator e
 *    o download não são invocados de novo.
 * 2. O `instance_hash` isola instâncias: o MESMO `attachment_id` em duas instâncias
 *    distintas gera extrações independentes (não há colisão de cache).
 * 3. A identidade do extrator participa da chave: trocar `version` OU um `param`
 *    (ex.: `lang`) invalida corretamente a entrada e força o reprocessamento.
 *
 * Roda na suíte NORMAL (não opt-in): é determinístico (bytes fixos, timestamps
 * fixos, mkdtemp isolado por teste) e barato.
 */

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMarkdownBundle } from '../../src/bundle/index.js';
import { DiskCacheStore } from '../../src/cache/index.js';
import type { HttpClient } from '../../src/client/index.js';
import type { Attachment, ExtractionResult, Issue, Journal } from '../../src/contract.js';
import { ExtractorRegistry, type Extractor } from '../../src/extract/index.js';
import { extractIssueAttachments } from '../../src/index.js';

const INSTANCE_URL = 'https://redmine.example';
const OTHER_INSTANCE_URL = 'https://redmine.other';
const TOOL_VERSION = '0.1.0-test';

/** Assinatura PNG mínima — magic bytes suficientes para o dispatcher rotear. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** ReadableStream a partir de bytes fixos (corpo do download mockado). */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Anexo de imagem base (digest hex real ⇒ path direto no DiskCacheStore). */
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

/** Issue mínima parametrizável por anexos, journals e `updated_on`. */
function issueWith(
  attachments: Attachment[],
  journals: Journal[] = [],
  updatedOn = '2026-07-20T00:00:00Z',
): Issue {
  return {
    id: 42,
    subject: 's',
    project: { id: 1, name: 'P' },
    tracker: { id: 1, name: 'T' },
    status: { id: 1, name: 'S' },
    priority: { id: 1, name: 'N' },
    author: { id: 1, name: 'A' },
    created_on: '2026-07-20T00:00:00Z',
    updated_on: updatedOn,
    custom_fields: [],
    journals,
    attachments,
    relations: [],
    children: [],
  };
}

/** Client HTTP falso: só `getBinary` (o download) importa aqui. */
function fakeHttp(getBinary: HttpClient['getBinary']): HttpClient {
  return { get: vi.fn(), getBinary };
}

/** Extrator fake registrável e espionável; `version`/`params` entram na chave. */
function fakeExtractor(
  overrides: { version?: string; params?: Extractor['params'] } = {},
): Extractor & { extract: ReturnType<typeof vi.fn> } {
  let calls = 0;
  return {
    id: 'fake-ocr',
    version: overrides.version ?? 'fake-1',
    model: 'fake-model',
    params: overrides.params ?? { lang: 'xx' },
    supportedMimes: ['image/png'],
    // O texto embute um contador ⇒ duas extrações distintas produzem textos
    // distintos, tornando a independência entre instâncias observável no bundle.
    extract: vi.fn(async (_filePath: string, opts: { mime: string }): Promise<ExtractionResult> => {
      calls += 1;
      return {
        status: 'done',
        text: `ocr-#${calls}`,
        mime: opts.mime,
        metadata: { extractorId: 'fake-ocr' },
      };
    }),
  };
}

let cacheDir: string;
let store: DiskCacheStore<ExtractionResult>;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'rc-two-layers-'));
  store = new DiskCacheStore<ExtractionResult>({ cacheDir });
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('cache 2 camadas: comentário novo não reprocessa extração', () => {
  it('novo journal (updated_on muda) regenera o bundle reutilizando a extração do cache', async () => {
    const extractor = fakeExtractor();
    const registry = new ExtractorRegistry().register(extractor);
    // Factory: cada download recebe um stream NOVO (um ReadableStream só é
    // consumível uma vez) — indispensável quando há mais de um download real.
    const getBinary = vi.fn(async () => streamOf(PNG_BYTES));
    const opts = { instanceUrl: INSTANCE_URL, cacheDir, store, registry } as const;

    // 1ª geração: issue sem comentários. Extrai (spy) e baixa (getBinary) uma vez.
    const issueV1 = issueWith([imageAttachment()]);
    const extractionsV1 = await extractIssueAttachments(fakeHttp(getBinary), issueV1, opts);
    const bundleV1 = buildMarkdownBundle(issueV1, {
      baseUrl: INSTANCE_URL,
      toolVersion: TOOL_VERSION,
      extractions: extractionsV1,
    });

    expect(extractionsV1.get(7)?.status).toBe('done');
    expect(bundleV1).toContain('ocr-#1');
    expect(extractor.extract).toHaveBeenCalledTimes(1);
    expect(getBinary).toHaveBeenCalledTimes(1);

    // Comentário novo: novo journal ⇒ `updated_on` avança. Mesmo anexo imutável.
    const journal: Journal = {
      id: 900,
      notes: 'comentario recem adicionado',
      created_on: '2026-07-21T09:00:00Z',
      details: [],
    };
    const issueV2 = issueWith([imageAttachment()], [journal], '2026-07-21T09:00:00Z');
    const extractionsV2 = await extractIssueAttachments(fakeHttp(getBinary), issueV2, opts);
    const bundleV2 = buildMarkdownBundle(issueV2, {
      baseUrl: INSTANCE_URL,
      toolVersion: TOOL_VERSION,
      extractions: extractionsV2,
    });

    // Camada de issue regenerada: o bundle mudou (traz o comentário novo)...
    expect(bundleV2).not.toBe(bundleV1);
    expect(bundleV2).toContain('comentario recem adicionado');
    // ...mas a camada de attachment foi REUTILIZADA: mesmo texto, sem re-extrair
    // nem re-baixar (os spies continuam em 1 chamada).
    expect(bundleV2).toContain('ocr-#1');
    expect(extractionsV2.get(7)?.text).toBe('ocr-#1');
    expect(extractor.extract).toHaveBeenCalledTimes(1);
    expect(getBinary).toHaveBeenCalledTimes(1);
  });
});

describe('cache 2 camadas: isolamento por instance_hash', () => {
  it('mesmo attachment_id em duas instâncias não colide (extrações independentes)', async () => {
    const extractor = fakeExtractor();
    const registry = new ExtractorRegistry().register(extractor);
    // Factory: cada download recebe um stream NOVO (um ReadableStream só é
    // consumível uma vez) — indispensável quando há mais de um download real.
    const getBinary = vi.fn(async () => streamOf(PNG_BYTES));
    const base = { cacheDir, store, registry } as const;
    const attachment = imageAttachment(); // MESMO id (7) e digest nas duas instâncias.

    // Instância A: primeira extração.
    const a1 = await extractIssueAttachments(fakeHttp(getBinary), issueWith([attachment]), {
      ...base,
      instanceUrl: INSTANCE_URL,
    });
    expect(extractor.extract).toHaveBeenCalledTimes(1);

    // Instância B (instance_hash distinto): NÃO herda o cache de A ⇒ extrai de novo.
    const b1 = await extractIssueAttachments(fakeHttp(getBinary), issueWith([attachment]), {
      ...base,
      instanceUrl: OTHER_INSTANCE_URL,
    });
    expect(extractor.extract).toHaveBeenCalledTimes(2);
    expect(a1.get(7)?.text).toBe('ocr-#1');
    expect(b1.get(7)?.text).toBe('ocr-#2');
    expect(a1.get(7)?.text).not.toBe(b1.get(7)?.text);

    // Cada instância tem sua própria entrada: reexecutar ambas é cache-hit puro.
    const a2 = await extractIssueAttachments(fakeHttp(getBinary), issueWith([attachment]), {
      ...base,
      instanceUrl: INSTANCE_URL,
    });
    const b2 = await extractIssueAttachments(fakeHttp(getBinary), issueWith([attachment]), {
      ...base,
      instanceUrl: OTHER_INSTANCE_URL,
    });
    expect(extractor.extract).toHaveBeenCalledTimes(2);
    expect(a2.get(7)?.text).toBe('ocr-#1');
    expect(b2.get(7)?.text).toBe('ocr-#2');
  });
});

describe('cache 2 camadas: identidade do extrator na chave', () => {
  it('trocar extractor_version força reprocessamento', async () => {
    // Factory: cada download recebe um stream NOVO (um ReadableStream só é
    // consumível uma vez) — indispensável quando há mais de um download real.
    const getBinary = vi.fn(async () => streamOf(PNG_BYTES));
    const issue = issueWith([imageAttachment()]);

    const v1 = fakeExtractor({ version: 'fake-1' });
    await extractIssueAttachments(fakeHttp(getBinary), issue, {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry: new ExtractorRegistry().register(v1),
    });
    expect(v1.extract).toHaveBeenCalledTimes(1);

    // Nova versão do extrator ⇒ chave diferente ⇒ recomputa (cache antigo intacto).
    const v2 = fakeExtractor({ version: 'fake-2' });
    await extractIssueAttachments(fakeHttp(getBinary), issue, {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry: new ExtractorRegistry().register(v2),
    });
    expect(v2.extract).toHaveBeenCalledTimes(1);
    expect(v1.extract).toHaveBeenCalledTimes(1);
  });

  it('trocar um param (lang) força reprocessamento', async () => {
    // Factory: cada download recebe um stream NOVO (um ReadableStream só é
    // consumível uma vez) — indispensável quando há mais de um download real.
    const getBinary = vi.fn(async () => streamOf(PNG_BYTES));
    const issue = issueWith([imageAttachment()]);

    const langXx = fakeExtractor({ params: { lang: 'xx' } });
    await extractIssueAttachments(fakeHttp(getBinary), issue, {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry: new ExtractorRegistry().register(langXx),
    });
    expect(langXx.extract).toHaveBeenCalledTimes(1);

    // Mesmo anexo e versão, `lang` diferente ⇒ chave diferente ⇒ recomputa.
    const langYy = fakeExtractor({ params: { lang: 'yy' } });
    await extractIssueAttachments(fakeHttp(getBinary), issue, {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry: new ExtractorRegistry().register(langYy),
    });
    expect(langYy.extract).toHaveBeenCalledTimes(1);

    // E o par (xx) segue cacheado: reexecutar não reprocessa.
    const langXxAgain = fakeExtractor({ params: { lang: 'xx' } });
    await extractIssueAttachments(fakeHttp(getBinary), issue, {
      instanceUrl: INSTANCE_URL,
      cacheDir,
      store,
      registry: new ExtractorRegistry().register(langXxAgain),
    });
    expect(langXxAgain.extract).not.toHaveBeenCalled();
  });
});
