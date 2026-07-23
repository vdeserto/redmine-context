/**
 * Gerador de PNG determinístico com texto — utilitário de TESTE (M3-09).
 *
 * Renderiza uma palavra curta usando uma fonte bitmap 5x7 embutida, ampliada em
 * blocos, sobre fundo branco com texto preto, e codifica um PNG grayscale 8-bit
 * (grava filtro 0 por linha, comprime com `zlib.deflate`, monta os chunks
 * IHDR/IDAT/IEND com CRC). Assim o teste de integração REAL do tesseract gera a
 * imagem EM RUNTIME — sem fixture binária versionada no repo (ADR-002).
 *
 * A escala default (16) produz letras grandes e nítidas que o tesseract 5.x lê
 * de forma estável (`por+eng`, psm 3). Só cobre os glifos usados nos testes.
 */

import { deflateSync } from 'node:zlib';

/** Assinatura PNG (magic bytes) — casa com a detecção do dispatcher. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Largura/altura de cada glifo na fonte bitmap. */
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

/** Fonte bitmap 5x7 (linhas de topo→base, `1` = pixel aceso). Só glifos usados. */
const FONT: Readonly<Record<string, readonly string[]>> = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
};

/** Opções de {@link makeTextPng}. */
export interface MakeTextPngOptions {
  /** Fator de ampliação de cada pixel do glifo (default 16). */
  readonly scale?: number;
  /** Margem branca ao redor do texto, em pixels-fonte antes da escala (default 3). */
  readonly marginCells?: number;
  /** Espaço entre glifos, em pixels-fonte (default 2). */
  readonly gapCells?: number;
}

/** Tabela CRC-32 (polinômio PNG) pré-computada. */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Calcula o CRC-32 (variante PNG) de um buffer.
 *
 * @param buffer - Bytes a somar.
 * @returns O CRC-32 como inteiro sem sinal de 32 bits.
 */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Monta um chunk PNG (`length` + `type` + `data` + `crc`).
 *
 * @param type - Tipo do chunk de 4 letras (ex.: `IHDR`).
 * @param data - Payload do chunk.
 * @returns O chunk completo pronto para concatenação.
 */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/**
 * Renderiza uma palavra num PNG grayscale 8-bit com texto preto sobre branco.
 *
 * @param word - Palavra a desenhar; cada letra precisa existir na {@link FONT}.
 * @param options - Escala/margens — ver {@link MakeTextPngOptions}.
 * @returns Um `Buffer` com os bytes do PNG (inicia pela assinatura PNG).
 * @throws {Error} Se `word` contiver um caractere sem glifo na fonte.
 * @example
 * const png = makeTextPng('HELLO');
 * await writeFile('/tmp/hello.png', png);
 */
export function makeTextPng(word: string, options: MakeTextPngOptions = {}): Buffer {
  const scale = options.scale ?? 16;
  const gap = options.gapCells ?? 2;
  const margin = (options.marginCells ?? 3) * scale;

  const columns = word.length * (GLYPH_WIDTH + gap) - gap;
  const width = columns * scale + margin * 2;
  const height = GLYPH_HEIGHT * scale + margin * 2;

  // Fundo branco (0xff); os glifos pintam blocos pretos (0x00).
  const pixels = Buffer.alloc(width * height, 0xff);
  const paintCell = (cellX: number, cellY: number): void => {
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        const x = margin + cellX * scale + dx;
        const y = margin + cellY * scale + dy;
        pixels[y * width + x] = 0x00;
      }
    }
  };

  let cursor = 0;
  for (const char of word) {
    const glyph = FONT[char];
    if (glyph === undefined) {
      throw new Error(`makeTextPng: sem glifo para o caractere "${char}"`);
    }
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      for (let col = 0; col < GLYPH_WIDTH; col += 1) {
        if (glyph[row]![col] === '1') {
          paintCell(cursor + col, row);
        }
      }
    }
    cursor += GLYPH_WIDTH + gap;
  }

  // Scanlines com byte de filtro 0 no início de cada linha.
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width, y * width + width);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type 0 = grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
