/**
 * Testes do módulo Cache (M3-01, ADR-004).
 *
 * A {@link InMemoryCacheStore} é validada pela suíte de contrato reutilizável
 * (`runCacheContractSuite`), o que garante que a futura implementação em disco,
 * ao passar na MESMA suíte, seja substituível sem alterar consumidores. Testes
 * adicionais cobrem os utilitários de chave (serialização estável, instance_hash).
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryCacheStore,
  instanceHash,
  serializeCacheKey,
  type AttachmentCacheKey,
  type IssueCacheKey,
} from '../../src/cache/index.js';

import { runCacheContractSuite } from './contract-suite.js';

describe('InMemoryCacheStore', () => {
  runCacheContractSuite((options) => new InMemoryCacheStore<string>(options));
});

describe('serializeCacheKey', () => {
  it('é estável para params independentemente da ordem de inserção', () => {
    const a: AttachmentCacheKey = {
      kind: 'attachment',
      instanceHash: 'abc',
      attachmentId: 1,
      digest: 'd',
      extractorVersion: '1.0.0',
      model: 'm',
      params: { language: 'pt', beam_size: 5 },
    };
    const b: AttachmentCacheKey = { ...a, params: { beam_size: 5, language: 'pt' } };
    expect(serializeCacheKey(a)).toBe(serializeCacheKey(b));
  });

  it('separa as camadas issue e attachment por prefixo', () => {
    const issue: IssueCacheKey = { kind: 'issue', issueId: 1, updatedOn: '2026-07-20T00:00:00Z' };
    expect(serializeCacheKey(issue).startsWith('iss')).toBe(true);
  });

  it('distingue chaves de attachment por versão/modelo do extrator (ADR-004)', () => {
    const base: AttachmentCacheKey = {
      kind: 'attachment',
      instanceHash: 'abc',
      attachmentId: 1,
      digest: 'd',
      extractorVersion: '1.0.0',
      model: 'm',
      params: {},
    };
    expect(serializeCacheKey(base)).not.toBe(
      serializeCacheKey({ ...base, extractorVersion: '2.0.0' }),
    );
    expect(serializeCacheKey(base)).not.toBe(serializeCacheKey({ ...base, model: 'other' }));
  });
});

describe('instanceHash', () => {
  it('colapsa formas equivalentes da mesma URL (ADR-003/ADR-004)', () => {
    expect(instanceHash('HTTPS://Redmine.Example:443/')).toBe(
      instanceHash('https://redmine.example'),
    );
  });

  it('produz hashes distintos para instâncias distintas', () => {
    expect(instanceHash('https://a.example')).not.toBe(instanceHash('https://b.example'));
  });

  it('devolve um hash hex truncado de 16 chars', () => {
    expect(instanceHash('https://redmine.example')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('lança para URL inválida', () => {
    expect(() => instanceHash('nao-e-uma-url')).toThrow();
  });
});
