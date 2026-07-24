/**
 * Teste de INTEGRAÇÃO cross-surface do cache de anexos (achado do review #143).
 *
 * Prova que as DUAS tools MCP do M3 compartilham a MESMA camada de cache de
 * attachment (ADR-004): `get_issue_context` com `extract_attachments: true`
 * extrai o OCR de um anexo e o grava no cache em disco; a chamada seguinte de
 * `get_attachment_text` para o MESMO anexo SERVE do cache — o extrator (a peça
 * CARA) roda EXATAMENTE UMA VEZ no total, não uma por superfície.
 *
 * Diferente do teste de 2 camadas (que exercita `extractIssueAttachments`
 * diretamente), aqui as duas chamadas passam pelos HANDLERS MCP REAIS
 * (`createGetIssueContextHandler`/`createGetAttachmentTextHandler`), incluindo a
 * resolução de instância pela env e a renderização (fence `<untrusted-content>`).
 * A #143 flagra o risco de as duas superfícies derivarem chaves de cache
 * DISTINTAS (o `get_attachment_text` filtra a issue a um único anexo): se as
 * chaves divergissem, o spy do extrator marcaria 2 chamadas — a asserção `1`
 * garante a identidade de chave entre superfícies.
 *
 * Só o extrator e o HTTP são falsos; o `DiskCacheStore` é REAL sobre um `mkdtemp`
 * e o `getOrCompute` é o de produção — o cache-hit é fato observável, não mock.
 * Determinístico e barato: roda na suíte normal.
 */

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMarkdownBundle } from '../../src/bundle/index.js';
import { DiskCacheStore } from '../../src/cache/index.js';
import type { HttpClient } from '../../src/client/index.js';
import type {
  Attachment,
  CoreEvent,
  ExtractionResult,
  IssueBundleResult,
  Issue,
} from '../../src/contract.js';
import { extractIssueAttachments } from '../../src/index.js';
import { ExtractorRegistry, type Extractor } from '../../src/extract/index.js';
import type {
  AttachmentTextResult,
  FetchAttachmentTextOptions,
  FetchIssueBundleOptions,
} from '../../src/index.js';
import {
  createGetAttachmentTextHandler,
  createGetIssueContextHandler,
  type McpServerDeps,
} from '../../src/surfaces/mcp/server.js';

const INSTANCE_URL = 'https://redmine.example';
const TOOL_VERSION = '0.1.0-test';
const ATTACHMENT_ID = 7;
const ISSUE_ID = 42;

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
function imageAttachment(): Attachment {
  return {
    id: ATTACHMENT_ID,
    filename: 'photo.png',
    filesize: 8,
    content_type: 'image/png',
    created_on: '2026-07-20T00:00:00Z',
    content_url: `${INSTANCE_URL}/attachments/download/${ATTACHMENT_ID}/photo.png`,
    digest: 'deadbeefcafe1234',
  };
}

/** Issue mínima com um único anexo de imagem. */
function issueWithImage(): Issue {
  return {
    id: ISSUE_ID,
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
    attachments: [imageAttachment()],
    relations: [],
    children: [],
  };
}

/** Client HTTP falso: só `getBinary` (o download) importa aqui. */
function fakeHttp(getBinary: HttpClient['getBinary']): HttpClient {
  return { get: vi.fn(), getBinary };
}

/** Extrator fake espionável; texto de OCR fixo e conhecido. */
const OCR_TEXT = 'HELLO';
function spyExtractor(): Extractor & { extract: ReturnType<typeof vi.fn> } {
  return {
    id: 'fake-ocr',
    version: 'fake-1',
    model: 'fake-model',
    params: { lang: 'xx' },
    supportedMimes: ['image/png'],
    extract: vi.fn(async (_filePath: string, opts: { mime: string }): Promise<ExtractionResult> => ({
      status: 'done',
      text: OCR_TEXT,
      mime: opts.mime,
      metadata: { extractorId: 'fake-ocr' },
    })),
  };
}

let cacheDir: string;
let store: DiskCacheStore<ExtractionResult>;
let extractor: Extractor & { extract: ReturnType<typeof vi.fn> };
let getBinary: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'rc-cross-surface-'));
  store = new DiskCacheStore<ExtractionResult>({ cacheDir });
  extractor = spyExtractor();
  getBinary = vi.fn(async () => streamOf(PNG_BYTES));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Deps do MCP que espelham EXATAMENTE o wiring do core (`extractIssueAttachments`
 * + `getOrCompute`), mas partilhando UM único `store`/`registry`/`cacheDir` entre
 * as duas superfícies — o ponto exato que o review #143 exige verificar.
 */
function crossSurfaceDeps(): McpServerDeps {
  const registry = new ExtractorRegistry().register(extractor);
  const http = fakeHttp(getBinary);
  const opts = { instanceUrl: INSTANCE_URL, cacheDir, store, registry } as const;

  const fetchIssueBundle = (options: FetchIssueBundleOptions): AsyncIterable<CoreEvent<IssueBundleResult>> =>
    (async function* () {
      const issue = issueWithImage();
      const extractions = options.extractAttachments
        ? await extractIssueAttachments(http, issue, opts)
        : undefined;
      const content = buildMarkdownBundle(issue, {
        baseUrl: INSTANCE_URL,
        toolVersion: TOOL_VERSION,
        ...(extractions !== undefined ? { extractions } : {}),
      });
      yield { kind: 'result', value: { issueId: options.issueId, format: 'md', content } };
    })();

  const fetchAttachmentText = async (
    options: FetchAttachmentTextOptions,
  ): Promise<AttachmentTextResult> => {
    // Espelha o real: filtra a issue ao anexo pedido e passa pelo MESMO pipeline.
    const single: Issue = { ...issueWithImage() };
    const map = await extractIssueAttachments(http, single, opts);
    return { attachmentId: options.attachmentId, extraction: map.get(options.attachmentId)! };
  };

  return {
    fetchIssueBundle: fetchIssueBundle as unknown as McpServerDeps['fetchIssueBundle'],
    searchIssues: vi.fn() as unknown as McpServerDeps['searchIssues'],
    fetchAttachmentText: fetchAttachmentText as unknown as McpServerDeps['fetchAttachmentText'],
    resolveApiKey: vi.fn(async () => 'api-key') as unknown as McpServerDeps['resolveApiKey'],
    env: { REDMINE_URL: INSTANCE_URL } as NodeJS.ProcessEnv,
    toolVersion: TOOL_VERSION,
  };
}

/** Extrai o texto concatenado de um CallToolResult. */
function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
}

describe('cross-surface (#143): get_issue_context(extract) + get_attachment_text compartilham o cache', () => {
  it('o extrator roda UMA vez no total; a 2ª superfície serve do cache em disco', async () => {
    const deps = crossSurfaceDeps();
    const issueContext = createGetIssueContextHandler(deps);
    const attachmentText = createGetAttachmentTextHandler(deps);

    // 1ª superfície: get_issue_context com extração ligada → extrai e cacheia.
    const ctx = await issueContext({ issue_id: ISSUE_ID, extract_attachments: true });
    expect(ctx.isError).toBeFalsy();
    expect(textOf(ctx)).toContain(OCR_TEXT);
    expect(extractor.extract).toHaveBeenCalledTimes(1);
    expect(getBinary).toHaveBeenCalledTimes(1);

    // 2ª superfície: get_attachment_text do MESMO anexo → cache-hit, sem re-extrair.
    const att = await attachmentText({ issue_id: ISSUE_ID, attachment_id: ATTACHMENT_ID });
    expect(att.isError).toBeFalsy();
    // Texto do OCR devolvido dentro da fence de conteúdo não confiável.
    expect(textOf(att)).toContain('<untrusted-content>');
    expect(textOf(att)).toContain(OCR_TEXT);

    // Invariante central do #143: chave de cache idêntica entre superfícies ⇒
    // o extrator caro e o download NÃO rodaram de novo.
    expect(extractor.extract).toHaveBeenCalledTimes(1);
    expect(getBinary).toHaveBeenCalledTimes(1);
  });
});
