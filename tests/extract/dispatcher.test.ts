/**
 * Testes do dispatcher de extratores por magic bytes (M3-08, ADR-005).
 *
 * Provam o roteamento fim-a-fim com um extrator FAKE (nenhum extrator real vive
 * aqui — OCR é a #51): roteia pelo MIME REAL, avisa (logger.warn) no mismatch
 * extensão vs magic byte fazendo o magic byte vencer, devolve `unsupported` sem
 * extrator registrado ou com arquivo indetectável (vazio/curto), e o registry
 * indexa/sobrescreve por MIME. Fixtures binárias geradas no teste (bytes reais).
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtractionResult } from '../../src/contract.js';
import {
  dispatchExtraction,
  ExtractorRegistry,
  type ExtractOptions,
  type Extractor,
} from '../../src/extract/index.js';

/** Bytes mágicos reais usados nas fixtures. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

/** Logger fake que só captura `warn` (o único nível que o dispatcher usa). */
function fakeLogger(): { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() };
}

/**
 * Extrator FAKE que registra a chamada e devolve um resultado `done`. Prova que
 * o roteamento entrega o arquivo e o MIME real corretos ao extrator certo.
 */
function fakeExtractor(overrides: Partial<Extractor> = {}): Extractor & {
  readonly calls: { filePath: string; options: ExtractOptions }[];
} {
  const calls: { filePath: string; options: ExtractOptions }[] = [];
  return {
    id: overrides.id ?? 'fake-image',
    version: overrides.version ?? '1.0.0',
    supportedMimes: overrides.supportedMimes ?? ['image/png', 'image/jpeg'],
    calls,
    async extract(filePath: string, options: ExtractOptions): Promise<ExtractionResult> {
      calls.push({ filePath, options });
      return { status: 'done', text: 'ok', confidence: 1, mime: options.mime };
    },
  };
}

describe('dispatcher: roteamento por magic bytes', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rc-dispatch-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Grava uma fixture com bytes dados e devolve o caminho. */
  function fixture(name: string, seed: readonly number[]): string {
    const file = join(dir, name);
    writeFileSync(file, Buffer.from(seed));
    return file;
  }

  it('roteia para o extrator do MIME real e repassa filePath + mime', async () => {
    const extractor = fakeExtractor();
    const registry = new ExtractorRegistry().register(extractor);
    const file = fixture('original.png', [...PNG_MAGIC, 0x00, 0x00]);

    const result = await dispatchExtraction(file, { registry, filename: 'photo.png' });

    expect(result.status).toBe('done');
    expect(result.mime).toBe('image/png');
    expect(extractor.calls).toHaveLength(1);
    expect(extractor.calls[0]?.filePath).toBe(file);
    expect(extractor.calls[0]?.options.mime).toBe('image/png');
  });

  it('mismatch extensão vs magic byte → logger.warn e o MAGIC BYTE vence', async () => {
    const extractor = fakeExtractor();
    const registry = new ExtractorRegistry().register(extractor);
    const logger = fakeLogger();
    // Conteúdo é PNG, mas o filename mente ".jpg" (na verdade jpeg≠png).
    // Ainda mais forte: filename ".pdf" contradiz o png real.
    const file = fixture('claims.pdf', [...PNG_MAGIC, 0x00]);

    const result = await dispatchExtraction(file, { registry, filename: 'claims.pdf', logger });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain('image/png');
    // Roteou pelo magic byte (png), não pela extensão (pdf).
    expect(result.status).toBe('done');
    expect(result.mime).toBe('image/png');
    expect(extractor.calls[0]?.options.mime).toBe('image/png');
  });

  it('extensão coerente com o magic byte → nenhum aviso', async () => {
    const extractor = fakeExtractor();
    const registry = new ExtractorRegistry().register(extractor);
    const logger = fakeLogger();
    const file = fixture('photo.png', [...PNG_MAGIC]);

    await dispatchExtraction(file, { registry, filename: 'photo.png', logger });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('MIME real sem extrator registrado → unsupported com metadados (sem erro)', async () => {
    const registry = new ExtractorRegistry(); // vazio
    const file = fixture('doc.pdf', [...PDF_MAGIC]);

    const result = await dispatchExtraction(file, { registry, filename: 'doc.pdf' });

    expect(result.status).toBe('unsupported');
    expect(result.mime).toBe('application/pdf');
    expect(result.metadata?.reason).toBe('sem-extrator-registrado');
    expect(result.metadata?.filename).toBe('doc.pdf');
  });

  it('arquivo vazio (MIME indetectável) → unsupported sem mime', async () => {
    const registry = new ExtractorRegistry().register(fakeExtractor());
    const file = fixture('empty.bin', []);

    const result = await dispatchExtraction(file, { registry, filename: 'empty.bin' });

    expect(result.status).toBe('unsupported');
    expect(result.mime).toBeUndefined();
    expect(result.metadata?.reason).toBe('mime-indetectavel');
  });

  it('arquivo curto/binário desconhecido → unsupported (indetectável)', async () => {
    const registry = new ExtractorRegistry().register(fakeExtractor());
    const file = fixture('short.bin', [0x00, 0x01]);

    const result = await dispatchExtraction(file, { registry });

    expect(result.status).toBe('unsupported');
    expect(result.metadata?.reason).toBe('mime-indetectavel');
    // Sem filename: metadata não inclui a chave.
    expect(result.metadata && 'filename' in result.metadata).toBe(false);
  });

  it('sem filename e com extrator: roteia normalmente sem checar mismatch', async () => {
    const extractor = fakeExtractor();
    const registry = new ExtractorRegistry().register(extractor);
    const file = fixture('original.png', [...PNG_MAGIC]);

    const result = await dispatchExtraction(file, { registry });

    expect(result.status).toBe('done');
    expect(extractor.calls[0]?.options.logger).toBeUndefined();
  });
});

describe('dispatcher: ExtractorRegistry', () => {
  it('indexa um extrator por todos os seus supportedMimes', () => {
    const extractor = fakeExtractor({ supportedMimes: ['image/png', 'image/jpeg', 'image/gif'] });
    const registry = new ExtractorRegistry().register(extractor);

    expect(registry.find('image/png')).toBe(extractor);
    expect(registry.find('image/jpeg')).toBe(extractor);
    expect(registry.find('image/gif')).toBe(extractor);
    expect(registry.find('application/pdf')).toBeUndefined();
  });

  it('registrar de novo o mesmo MIME sobrescreve o extrator anterior', () => {
    const first = fakeExtractor({ id: 'first', supportedMimes: ['image/png'] });
    const second = fakeExtractor({ id: 'second', supportedMimes: ['image/png'] });
    const registry = new ExtractorRegistry().register(first).register(second);

    expect(registry.find('image/png')).toBe(second);
  });
});
