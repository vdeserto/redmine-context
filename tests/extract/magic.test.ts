/**
 * Testes da detecção de MIME REAL por magic bytes (M3-08, ADR-005).
 *
 * Cobrem a decisão de tipo SEMPRE pelo conteúdo (nunca por extensão): cada
 * assinatura tabelada é exercida com seus bytes mágicos reais, o fallback de
 * texto plausível, e os casos-limite (vazio, curto, binário desconhecido, NUL).
 * As fixtures binárias são geradas no próprio teste (bytes reais), sem depender
 * de arquivos versionados.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectMime, detectMimeFromFile, mimeForExtension } from '../../src/extract/index.js';

/** Bytes mágicos reais de cada formato coberto pelo dispatcher. */
const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  webp: [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37],
  zip: [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00],
} as const;

/** Preenche uma sequência de bytes até `size` com zeros seguros para binário. */
function bytes(seed: readonly number[]): Uint8Array {
  return Uint8Array.from(seed);
}

describe('magic: detectMime (assinaturas por bytes)', () => {
  it('detecta cada formato por seus magic bytes reais', () => {
    expect(detectMime(bytes(MAGIC.png))).toBe('image/png');
    expect(detectMime(bytes(MAGIC.jpeg))).toBe('image/jpeg');
    expect(detectMime(bytes(MAGIC.gif))).toBe('image/gif');
    expect(detectMime(bytes(MAGIC.webp))).toBe('image/webp');
    expect(detectMime(bytes(MAGIC.pdf))).toBe('application/pdf');
    expect(detectMime(bytes(MAGIC.zip))).toBe('application/zip');
  });

  it('RIFF sem o segmento WEBP em offset 8 NÃO é webp (segmento dupla-checado)', () => {
    // RIFF de um WAV (áudio) começa igual, mas não tem "WEBP" no offset 8.
    const riffWav = bytes([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
    expect(detectMime(riffWav)).toBeUndefined();
  });

  it('classifica texto plausível (ASCII + acentos UTF-8) como text/plain', () => {
    const utf8 = new TextEncoder().encode('olá, mundo\nlinha 2\tcom tab');
    expect(detectMime(utf8)).toBe('text/plain');
  });

  it('amostra vazia → undefined (caso arquivo vazio)', () => {
    expect(detectMime(new Uint8Array(0))).toBeUndefined();
  });

  it('binário com byte NUL e sem assinatura → undefined', () => {
    const binary = bytes([0x01, 0x00, 0x02, 0x03, 0xff, 0x00]);
    expect(detectMime(binary)).toBeUndefined();
  });

  it('excesso de bytes de controle (não imprimíveis) → não é texto', () => {
    // Vários 0x07 (BEL) derrubam a razão de imprimíveis abaixo do limiar.
    const noisy = bytes([0x41, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07]);
    expect(detectMime(noisy)).toBeUndefined();
  });

  it('assinatura mais longa que a amostra não casa (não estoura buffer)', () => {
    // Só 3 dos 8 bytes do PNG + NUL: prefixo insuficiente e binário (não texto).
    const shortPng = bytes([0x89, 0x50, 0x4e, 0x00]);
    expect(detectMime(shortPng)).toBeUndefined();
  });
});

describe('magic: mimeForExtension (apenas para aviso de mismatch)', () => {
  it('mapeia extensões conhecidas (case-insensitive)', () => {
    expect(mimeForExtension('photo.PNG')).toBe('image/png');
    expect(mimeForExtension('a.jpg')).toBe('image/jpeg');
    expect(mimeForExtension('a.jpeg')).toBe('image/jpeg');
    expect(mimeForExtension('doc.pdf')).toBe('application/pdf');
    expect(mimeForExtension('sheet.docx')).toBe('application/zip');
    expect(mimeForExtension('notes.txt')).toBe('text/plain');
  });

  it('extensão ausente ou não mapeada → undefined (sem mismatch a avisar)', () => {
    expect(mimeForExtension('noext')).toBeUndefined();
    expect(mimeForExtension('trailingdot.')).toBeUndefined();
    expect(mimeForExtension('archive.rar')).toBeUndefined();
  });
});

describe('magic: detectMimeFromFile (lê o prefixo do arquivo)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rc-magic-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lê os magic bytes de um arquivo real e detecta o MIME', async () => {
    const file = join(dir, 'original.png');
    writeFileSync(file, Buffer.from([...MAGIC.png, 0x00, 0x00, 0x00]));
    expect(await detectMimeFromFile(file)).toBe('image/png');
  });

  it('arquivo vazio → undefined', async () => {
    const file = join(dir, 'empty.bin');
    writeFileSync(file, Buffer.alloc(0));
    expect(await detectMimeFromFile(file)).toBeUndefined();
  });

  it('arquivo de texto → text/plain', async () => {
    const file = join(dir, 'notes.txt');
    writeFileSync(file, 'linha de texto simples\n');
    expect(await detectMimeFromFile(file)).toBe('text/plain');
  });
});
