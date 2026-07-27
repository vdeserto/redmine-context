/**
 * Testes do extrator OOXML (#184) — docx/pptx/xlsx, 100% local, sem binário.
 *
 * Usam FIXTURES REAIS geradas pelo `zip` do sistema (scripts/build-ooxml-fixtures.mjs),
 * NÃO zips produzidos pelo nosso próprio leitor — assim um bug no leitor não é
 * mascarado por um bug simétrico no gerador. Determinístico e sem dependência de
 * binário: roda na matriz mac/win/linux do CI.
 *
 * Provam: leitor ZIP zero-dep (stored + deflate), desambiguação docx/pptx/xlsx por
 * conteúdo, extração de texto (parágrafos, tab, entidades XML, ordem dos slides),
 * zip não-OOXML → unsupported, arquivo corrompido → failed, e a composição via
 * createDefaultRegistry + dispatchExtraction.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createDefaultRegistry } from '../../src/extract/index.js';
import { dispatchExtraction } from '../../src/extract/dispatcher.js';
import {
  createOoxmlExtractor,
  DOCX_DIALECT,
  extractTextFromXml,
  OoxmlExtractor,
  unescapeXml,
} from '../../src/extract/ooxml.js';
import { parseZip } from '../../src/extract/zip.js';

/** Caminho absoluto de uma fixture OOXML. */
const fx = (name: string): string => fileURLToPath(new URL(`../fixtures/ooxml/${name}`, import.meta.url));

const tmpFiles: string[] = [];
/** Cria um arquivo temporário com `bytes` e o registra para limpeza. */
function tmpFile(name: string, bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'ooxml-test-'));
  const p = join(dir, name);
  writeFileSync(p, bytes);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  tmpFiles.length = 0;
});

describe('parseZip (leitor ZIP zero-dep)', () => {
  it('lê entradas STORED (plain.zip, método 0)', () => {
    const zip = parseZip(readFileSync(fx('plain.zip')));
    expect(zip.names()).toContain('readme.txt');
    expect(zip.read('readme.txt')?.toString('utf8')).toContain('apenas um zip comum');
  });

  it('lê entradas DEFLATE (sample.docx, método 8)', () => {
    const zip = parseZip(readFileSync(fx('sample.docx')));
    const doc = zip.read('word/document.xml')?.toString('utf8');
    expect(doc).toContain('<w:t>Ofício nº 123</w:t>');
  });

  it('read() de entrada inexistente devolve undefined', () => {
    const zip = parseZip(readFileSync(fx('plain.zip')));
    expect(zip.read('nao/existe.xml')).toBeUndefined();
  });

  it('lança em buffer que não é um zip (sem EOCD)', () => {
    expect(() => parseZip(Buffer.from('não é um zip, apenas texto solto'))).toThrow();
  });
});

describe('OoxmlExtractor', () => {
  const extractor = new OoxmlExtractor();

  it('createOoxmlExtractor() devolve uma instância do extrator', () => {
    expect(createOoxmlExtractor()).toBeInstanceOf(OoxmlExtractor);
  });

  it('expõe contrato estável (id/model/version/mime/params)', () => {
    expect(extractor.supportedMimes).toContain('application/zip');
    expect(extractor.id).toBe('ooxml');
    expect(extractor.model).toBe('ooxml');
    expect(extractor.version).toMatch(/ooxml/);
    expect(extractor.extractorConfig).toEqual({
      version: extractor.version,
      model: 'ooxml',
      params: extractor.params,
    });
  });

  it('docx: extrai texto por parágrafo, com tab e entidades XML desescapadas', async () => {
    const r = await extractor.extract(fx('sample.docx'), { mime: 'application/zip' });
    expect(r.status).toBe('done');
    expect(r.text).toBe('Ofício nº 123\nLinha com  espaço\tapós tab\nA & B <fim>');
    expect(r.metadata?.format).toBe('docx');
  });

  it('pptx: extrai o texto dos slides na ORDEM dos slides (slide1 antes de slide2)', async () => {
    const r = await extractor.extract(fx('sample.pptx'), { mime: 'application/zip' });
    expect(r.status).toBe('done');
    expect(r.text).toBe('Título do slide 1\nBullet um\nSlide dois');
    expect(r.metadata?.format).toBe('pptx');
  });

  it('xlsx: extrai as sharedStrings', async () => {
    const r = await extractor.extract(fx('sample.xlsx'), { mime: 'application/zip' });
    expect(r.status).toBe('done');
    expect(r.text).toBe('Cabeçalho\nCélula A');
    expect(r.metadata?.format).toBe('xlsx');
  });

  it('zip comum (não-OOXML) → unsupported, sem erro', async () => {
    const r = await extractor.extract(fx('plain.zip'), { mime: 'application/zip' });
    expect(r.status).toBe('unsupported');
    expect(r.metadata?.reason).toBe('zip-nao-ooxml');
  });

  it('xlsx sem sharedStrings (só números) → failed (ooxml-sem-texto)', async () => {
    const r = await extractor.extract(fx('nostrings.xlsx'), { mime: 'application/zip' });
    expect(r.status).toBe('failed');
    expect(r.metadata?.reason).toBe('ooxml-sem-texto');
    expect(r.metadata?.format).toBe('xlsx');
  });

  it('pptx sem slides → failed (ooxml-sem-texto)', async () => {
    const r = await extractor.extract(fx('noslides.pptx'), { mime: 'application/zip' });
    expect(r.status).toBe('failed');
    expect(r.metadata?.reason).toBe('ooxml-sem-texto');
    expect(r.metadata?.format).toBe('pptx');
  });

  it('dados anexados após o EOCD (spoofing) → falha, não extrai conteúdo divergente', async () => {
    const tampered = Buffer.concat([readFileSync(fx('sample.docx')), Buffer.from('JUNK-APPENDED')]);
    const p = tmpFile('tampered.docx', tampered);
    const r = await extractor.extract(p, { mime: 'application/zip' });
    expect(r.status).toBe('failed');
    expect(r.metadata?.reason).toBe('zip-invalido');
  });

  it('arquivo corrompido (zip truncado) → failed, sem lançar', async () => {
    const truncated = readFileSync(fx('sample.docx')).subarray(0, 40);
    const p = tmpFile('corrupt.docx', truncated);
    const r = await extractor.extract(p, { mime: 'application/zip' });
    expect(r.status).toBe('failed');
    expect(r.metadata?.reason).toBeDefined();
  });

  it('arquivo inexistente → failed (erro-leitura), sem lançar', async () => {
    const r = await extractor.extract('/caminho/que/nao/existe.docx', { mime: 'application/zip' });
    expect(r.status).toBe('failed');
    expect(r.metadata?.reason).toBe('erro-leitura');
  });

  it('cancelamento via signal já abortado → cancelled', async () => {
    const r = await extractor.extract(fx('sample.docx'), {
      mime: 'application/zip',
      signal: AbortSignal.abort(),
    });
    expect(r.status).toBe('cancelled');
  });
});

describe('robustez adversarial (achados da review #184)', () => {
  it('extractTextFromXml é LINEAR: 200k tags <w:t> abertas e nunca fechadas terminam rápido', () => {
    // Guarda de regressão do BLOCKER (ReDoS O(n²)): a implementação antiga com
    // `regex.matchAll` degeneraria para minutos aqui e estouraria o timeout do teste.
    // O scanner de um passo resolve isto em milissegundos. Sem asserção de tempo
    // frágil — o próprio timeout do vitest (5s) é a guarda.
    const evil = '<w:t>'.repeat(200_000);
    const out = extractTextFromXml(evil, DOCX_DIALECT);
    // Cada `<w:t>` captura "até o próximo `<`" = string vazia → sem texto, sem travar.
    expect(out).toBe('');
  });

  it('unescapeXml mantém LITERAL entidade numérica fora do range Unicode (não lança)', () => {
    expect(unescapeXml('a &#99999999; b')).toBe('a &#99999999; b');
    expect(unescapeXml('a &#xFFFFFFFF; b')).toBe('a &#xFFFFFFFF; b');
    // ...e ainda resolve as válidas na mesma string.
    expect(unescapeXml('&#65; &amp; &#x42;')).toBe('A & B');
  });

  it('rejeita ZIP64 (parseZip lança)', () => {
    // EOCD mínimo (22 bytes) terminando no EOF, com totalEntries = 0xffff (marcador ZIP64).
    const buf = Buffer.alloc(22);
    buf.writeUInt32LE(0x06054b50, 0); // assinatura EOCD
    buf.writeUInt16LE(0xffff, 10); // total de entradas = sentinela ZIP64
    // commentLen (offset 20) = 0 → 0 + 22 + 0 === 22 === buf.length (EOCD no EOF)
    expect(() => parseZip(buf)).toThrow(/zip64/i);
  });
});

describe('integração via createDefaultRegistry + dispatchExtraction', () => {
  it('roteia application/zip (docx) para o OoxmlExtractor e extrai o texto', async () => {
    const registry = await createDefaultRegistry();
    const r = await dispatchExtraction(fx('sample.docx'), { registry, filename: 'oficio.docx' });
    expect(r.status).toBe('done');
    expect(r.text).toContain('Ofício nº 123');
  });
});
