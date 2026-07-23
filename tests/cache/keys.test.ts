/**
 * Testes do builder de chave attachment-level (M3-03, ADR-004).
 *
 * Cobrem: uso de `attachment.digest` quando presente; FALLBACK determinístico a
 * partir de `(id, filesize, created_on)` para Redmine < 4.x sem digest;
 * distinção de chave por qualquer componente (digest, versão, modelo, params);
 * invariância a `updated_on` da issue (o builder sequer o recebe); e a garantia,
 * exercitada contra a {@link DiskCacheStore} real, de que o digest de fallback
 * atravessa a sanitização hex do disk store por construção (é hex puro).
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DiskCacheStore, instanceHash, serializeCacheKey } from '../../src/cache/index.js';
import {
  buildAttachmentKey,
  deriveAttachmentDigest,
  type ExtractorConfig,
} from '../../src/cache/keys.js';
import type { Attachment } from '../../src/contract.js';

const INSTANCE_URL = 'https://redmine.example';

/** Extrator de exemplo reusado nos testes. */
const extractor: ExtractorConfig = {
  version: '1.0.0',
  model: 'whisper-large-v3',
  params: { language: 'pt', beam_size: 5 },
};

/** Anexo de exemplo; `digest` presente por padrão (Redmine ≥ 4.x). */
function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 7,
    filename: 'audio.mp3',
    filesize: 12345,
    created_on: '2026-07-20T00:00:00Z',
    content_url: 'https://redmine.example/attachments/download/7/audio.mp3',
    digest: 'deadbeefcafe0011',
    ...overrides,
  };
}

/** Cria um anexo SEM digest (simula Redmine < 4.x). */
function withoutDigest(overrides: Partial<Attachment> = {}): Attachment {
  const attachment = makeAttachment(overrides);
  delete attachment.digest;
  return attachment;
}

describe('buildAttachmentKey: digest presente', () => {
  it('usa attachment.digest verbatim e mapeia extractor+instância', () => {
    const key = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: makeAttachment(), extractor });

    expect(key).toEqual({
      kind: 'attachment',
      instanceHash: instanceHash(INSTANCE_URL),
      attachmentId: 7,
      digest: 'deadbeefcafe0011',
      extractorVersion: '1.0.0',
      model: 'whisper-large-v3',
      params: { language: 'pt', beam_size: 5 },
    });
  });

  it('colapsa URLs equivalentes no mesmo instanceHash (ADR-003)', () => {
    const a = buildAttachmentKey({ instanceUrl: 'https://redmine.example', attachment: makeAttachment(), extractor });
    const b = buildAttachmentKey({ instanceUrl: 'HTTPS://Redmine.Example:443/', attachment: makeAttachment(), extractor });

    expect(a.instanceHash).toBe(b.instanceHash);
  });

  it('trata digest de string vazia como AUSENTE e cai no fallback', () => {
    const key = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: makeAttachment({ digest: '' }), extractor });

    expect(key.digest).toBe(deriveAttachmentDigest(makeAttachment()));
  });
});

describe('buildAttachmentKey: fallback sem digest (Redmine < 4.x)', () => {
  it('deriva digest determinístico de (id, filesize, created_on)', () => {
    const a = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: withoutDigest(), extractor });
    const b = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: withoutDigest(), extractor });

    expect(a.digest).toBe(b.digest);
    expect(a.digest).toBe(deriveAttachmentDigest(withoutDigest()));
  });

  it('produz digest hex puro (atravessa a sanitização hex do disk store por construção)', () => {
    const key = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: withoutDigest(), extractor });

    // 64 chars hex → satisfaz /^[0-9a-fA-F]{8,64}$/ do disk store: usado direto,
    // sem re-hash. Confirma o requisito da AC "por construção".
    expect(key.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['id', withoutDigest({ id: 8 })],
    ['filesize', withoutDigest({ filesize: 999 })],
    ['created_on', withoutDigest({ created_on: '2026-01-01T00:00:00Z' })],
  ])('gera chave distinta quando %s muda', (_field, changed) => {
    const base = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: withoutDigest(), extractor });
    const other = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: changed, extractor });

    expect(serializeCacheKey(other)).not.toBe(serializeCacheKey(base));
  });
});

describe('buildAttachmentKey: distinção por componente do extrator', () => {
  const base = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: makeAttachment(), extractor });

  it.each([
    ['digest', makeAttachment({ digest: 'feedface0000' }), extractor],
    ['extractor_version', makeAttachment(), { ...extractor, version: '2.0.0' }],
    ['model', makeAttachment(), { ...extractor, model: 'whisper-medium' }],
    ['params', makeAttachment(), { ...extractor, params: { language: 'en' } }],
  ] as const)('muda a chave quando %s muda', (_field, attachment, cfg) => {
    const other = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment, extractor: cfg });

    expect(serializeCacheKey(other)).not.toBe(serializeCacheKey(base));
  });
});

describe('buildAttachmentKey: invariância a updated_on da issue', () => {
  it('não recebe nem embute updated_on na chave', () => {
    const key = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: makeAttachment(), extractor });

    // A chave attachment-level não carrega updated_on: um novo updated_on da
    // issue (edição, comentário) nunca invalida a extração do anexo imutável.
    expect(key).not.toHaveProperty('updatedOn');
  });

  it('produz a MESMA chave para o mesmo anexo entre edições da issue', () => {
    // O anexo é idêntico; apenas a issem-mãe foi editada (updated_on mudou).
    // Como o builder recebe só o anexo, a chave é bit-a-bit idêntica.
    const before = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: makeAttachment(), extractor });
    const after = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment: makeAttachment(), extractor });

    expect(serializeCacheKey(after)).toBe(serializeCacheKey(before));
  });
});

describe('buildAttachmentKey: integração com DiskCacheStore (path por construção)', () => {
  let baseDir: string;

  beforeAll(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'rc-keys-'));
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('o digest de fallback vira o <digest8> do path SEM re-hash', async () => {
    const cacheDir = mkdtempSync(join(baseDir, 'store-'));
    const store = new DiskCacheStore<string>({ cacheDir });
    const attachment = withoutDigest();
    const key = buildAttachmentKey({ instanceUrl: INSTANCE_URL, attachment, extractor });

    await store.put(key, 'extracao');

    const digest8 = deriveAttachmentDigest(attachment).slice(0, 8);
    const dir = join(cacheDir, key.instanceHash, 'attachments', `${key.attachmentId}-${digest8}`);
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(await store.get(key)).toBe('extracao');
  });
});
