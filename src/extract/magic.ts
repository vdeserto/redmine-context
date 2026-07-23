/**
 * Detecção de MIME REAL por magic bytes (M3-08, ADR-005).
 *
 * SEGURANÇA: o tipo do anexo é decidido SEMPRE pelos primeiros bytes do arquivo
 * baixado — NUNCA pela extensão do filename nem pelo `Content-Type` reportado
 * pelo Redmine (ambos são atacáveis/mentíveis). Um `.png` que na verdade é um
 * executável, ou um `Content-Type: image/png` sobre um zip, são detectados pelo
 * conteúdo. Sem dependência nova: assinaturas mínimas próprias, tabeladas abaixo.
 *
 * Tabela de assinaturas (offset em bytes → sequência hex):
 *
 *   MIME                | offset | bytes (hex)                    | origem
 *   --------------------|--------|--------------------------------|------------------
 *   image/png           | 0      | 89 50 4E 47 0D 0A 1A 0A         | PNG signature
 *   image/jpeg          | 0      | FF D8 FF                        | JFIF/EXIF SOI
 *   image/gif           | 0      | 47 49 46 38 (GIF8)              | GIF87a/GIF89a
 *   image/webp          | 0 + 8  | 52 49 46 46 (RIFF) + 57 45 42 50| RIFF container
 *   application/pdf     | 0      | 25 50 44 46 (%PDF)              | PDF header
 *   application/zip     | 0      | 50 4B 03 04 (PK\x03\x04)        | ZIP local header (docx/xlsx/pptx)
 *
 * Fallback: se nenhuma assinatura casar e a amostra for "texto plausível"
 * (sem byte NUL e maioria de bytes imprimíveis), classifica como `text/plain`.
 * Caso contrário, retorna `undefined` (desconhecido/binário sem extrator).
 *
 * DOCX/XLSX/PPTX são contêineres ZIP: a detecção por magic bytes os reporta como
 * `application/zip` — a diferenciação fina (inspecionar `[Content_Types].xml`)
 * fica para o extrator específico, fora do escopo do dispatcher.
 */

import { open } from 'node:fs/promises';

/**
 * Tamanho da amostra lida do início do arquivo. Cobre a maior assinatura
 * (webp precisa de 12 bytes) com folga e dá base estatística ao teste de texto.
 */
export const MAGIC_SAMPLE_SIZE = 512;

/** Razão mínima de bytes imprimíveis para classificar a amostra como texto. */
const TEXT_PRINTABLE_RATIO = 0.95;

/** Byte NUL — sua presença descarta imediatamente a hipótese de texto. */
const NUL_BYTE = 0x00;

/** Um segmento de assinatura: sequência exata de bytes a partir de um offset. */
interface MagicSegment {
  readonly offset: number;
  readonly bytes: readonly number[];
}

/** Uma assinatura de magic bytes: todos os segmentos devem casar. */
interface MagicSignature {
  readonly mime: string;
  readonly segments: readonly MagicSegment[];
}

/**
 * Tabela de assinaturas, avaliada em ordem. A primeira que casar vence — as
 * assinaturas são disjuntas (prefixos distintos), então a ordem não é ambígua.
 */
const SIGNATURES: readonly MagicSignature[] = [
  { mime: 'image/png', segments: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  { mime: 'image/jpeg', segments: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { mime: 'image/gif', segments: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
  {
    mime: 'image/webp',
    segments: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
  { mime: 'application/pdf', segments: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] },
  { mime: 'application/zip', segments: [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }] },
];

/**
 * Mapa extensão → MIME esperado. USADO APENAS para detectar mismatch entre a
 * extensão declarada e o magic byte real (o magic byte sempre vence, ver
 * dispatcher). NUNCA é fonte de verdade para roteamento.
 */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/zip',
  xlsx: 'application/zip',
  pptx: 'application/zip',
  txt: 'text/plain',
  md: 'text/plain',
  log: 'text/plain',
  csv: 'text/plain',
};

/**
 * Verifica se um único segmento de assinatura casa com a amostra.
 *
 * @param bytes - Amostra lida do início do arquivo.
 * @param segment - Segmento (offset + bytes esperados).
 * @returns `true` se todos os bytes do segmento casam na amostra.
 */
function matchesSegment(bytes: Uint8Array, segment: MagicSegment): boolean {
  if (segment.offset + segment.bytes.length > bytes.length) {
    return false;
  }
  for (let i = 0; i < segment.bytes.length; i += 1) {
    if (bytes[segment.offset + i] !== segment.bytes[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Heurística de "texto plausível": sem byte NUL e com ao menos
 * {@link TEXT_PRINTABLE_RATIO} de bytes imprimíveis (ASCII visível, espaços em
 * branco comuns ou bytes ≥ 0x80, que cobrem sequências UTF-8). Uma amostra
 * vazia NÃO é texto (retorna `false`).
 *
 * @param bytes - Amostra lida do início do arquivo.
 * @returns `true` se a amostra parece texto legível.
 */
function isPlausibleText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }
  let printable = 0;
  for (const byte of bytes) {
    if (byte === NUL_BYTE) {
      return false;
    }
    // Reason: tab/LF/CR + ASCII visível (0x20–0x7E) + alto (≥0x80 UTF-8) contam
    // como imprimíveis; demais bytes de controle derrubam a razão.
    const isWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    const isVisibleAscii = byte >= 0x20 && byte <= 0x7e;
    const isHighByte = byte >= 0x80;
    if (isWhitespace || isVisibleAscii || isHighByte) {
      printable += 1;
    }
  }
  return printable / bytes.length >= TEXT_PRINTABLE_RATIO;
}

/**
 * Detecta o MIME REAL de uma amostra de bytes via a tabela de assinaturas, com
 * fallback para `text/plain` quando a amostra é texto plausível.
 *
 * @param bytes - Amostra do início do arquivo (idealmente {@link MAGIC_SAMPLE_SIZE}).
 * @returns O MIME detectado, ou `undefined` se desconhecido/binário sem assinatura.
 * @example
 * detectMime(new Uint8Array([0x25, 0x50, 0x44, 0x46])); // 'application/pdf'
 * detectMime(new Uint8Array([])); // undefined
 */
export function detectMime(bytes: Uint8Array): string | undefined {
  for (const signature of SIGNATURES) {
    if (signature.segments.every((segment) => matchesSegment(bytes, segment))) {
      return signature.mime;
    }
  }
  return isPlausibleText(bytes) ? 'text/plain' : undefined;
}

/**
 * Lê o prefixo de um arquivo e detecta seu MIME REAL por magic bytes.
 *
 * Lê no máximo {@link MAGIC_SAMPLE_SIZE} bytes (não carrega o arquivo inteiro),
 * então fecha o descritor. Arquivos vazios ou muito curtos resultam em
 * `undefined` — o dispatcher os trata como `unsupported`, sem erro fatal.
 *
 * @param filePath - Caminho absoluto do arquivo baixado.
 * @returns O MIME detectado, ou `undefined` se desconhecido.
 * @throws {Error} Se o arquivo não puder ser aberto/lido (ex.: não existe).
 */
export async function detectMimeFromFile(filePath: string): Promise<string | undefined> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAGIC_SAMPLE_SIZE);
    const { bytesRead } = await handle.read(buffer, 0, MAGIC_SAMPLE_SIZE, 0);
    return detectMime(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * Deriva o MIME que a EXTENSÃO de um filename declara — usado somente para o
 * aviso de mismatch (o magic byte é a fonte de verdade). Retorna `undefined`
 * para extensões ausentes ou não mapeadas (nesse caso não há mismatch a avisar).
 *
 * @param filename - Nome de arquivo reportado pelo Redmine (não confiável).
 * @returns O MIME declarado pela extensão, ou `undefined`.
 * @example
 * mimeForExtension('photo.PNG'); // 'image/png'
 * mimeForExtension('report.pdf'); // 'application/pdf'
 * mimeForExtension('noext'); // undefined
 */
export function mimeForExtension(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) {
    return undefined;
  }
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXTENSION_MIME[ext];
}
