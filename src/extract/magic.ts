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
 *   audio/wav           | 0 + 8  | 52 49 46 46 (RIFF) + 57 41 56 45| RIFF/WAVE container
 *   video/x-msvideo     | 0 + 8  | 52 49 46 46 (RIFF) + 41 56 49 20| RIFF/AVI container
 *   audio/ogg           | 0      | 4F 67 67 53 (OggS)              | Ogg container
 *   video/webm          | 0      | 1A 45 DF A3 (EBML)             | Matroska/WebM (EBML)
 *   audio/mpeg          | 0      | 49 44 33 (ID3) ou FF Ex sync    | MP3 (tag ID3 ou frame sync)
 *
 * CONTÊINERES ISO-BMFF (MP4/MOV/M4A, M4-14/#73): a box `ftyp` fica no offset 4
 * (bytes 4-8 == 'ftyp'); a MARCA (brand, bytes 8-12) decide áudio vs vídeo. Brands
 * de áudio (`M4A `, `M4B `) → `audio/mp4`; qualquer outra (`isom`, `mp42`, `qt  `,
 * `avc1`, …) → `video/mp4`. Isso roteia o mesmo container para o extrator certo
 * (whisper direto para áudio; pipeline de vídeo → áudio → whisper para vídeo).
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
  // RIFF/WAVE (áudio) e RIFF/AVI (vídeo): mesmo prefixo RIFF do webp, distinguidos
  // pelo subtipo no offset 8 (segmento dupla-checado, como o webp).
  {
    mime: 'audio/wav',
    segments: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x41, 0x56, 0x45] },
    ],
  },
  {
    mime: 'video/x-msvideo',
    segments: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x41, 0x56, 0x49, 0x20] },
    ],
  },
  // Ogg (áudio) — o whisper transcreve a faixa; classificamos como áudio (ADR-005).
  { mime: 'audio/ogg', segments: [{ offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] }] },
  // EBML (Matroska/WebM): compartilham a assinatura; roteamos ao pipeline de vídeo,
  // que extrai a faixa de áudio (webm/mkv só-áudio ainda transcreve; keyframe degrada).
  { mime: 'video/webm', segments: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }] },
  // MP3 com tag ID3v2 no início (o frame sync puro é tratado à parte, ver detectMime).
  { mime: 'audio/mpeg', segments: [{ offset: 0, bytes: [0x49, 0x44, 0x33] }] },
];

/** Segmento da box `ftyp` de um contêiner ISO-BMFF (MP4/MOV/M4A): offset 4. */
const FTYP_SEGMENT: MagicSegment = { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] };

/**
 * Brands (marca no offset 8-12) de ISO-BMFF que classificam o container como
 * ÁUDIO: `M4A ` e `M4B `. Qualquer outra brand é tratada como vídeo (`video/mp4`).
 */
const AUDIO_FTYP_BRANDS: readonly (readonly number[])[] = [
  [0x4d, 0x34, 0x41, 0x20], // 'M4A '
  [0x4d, 0x34, 0x42, 0x20], // 'M4B '
];

/**
 * Detecta o MIME de um contêiner ISO-BMFF (MP4/MOV/M4A) pela box `ftyp` (offset 4)
 * e sua brand (offset 8). Brands de áudio → `audio/mp4`; demais → `video/mp4`.
 *
 * @param bytes - Amostra do início do arquivo.
 * @returns `audio/mp4` | `video/mp4` se for ISO-BMFF; `undefined` caso contrário.
 */
function detectFtypMime(bytes: Uint8Array): string | undefined {
  if (!matchesSegment(bytes, FTYP_SEGMENT)) {
    return undefined;
  }
  const isAudio = AUDIO_FTYP_BRANDS.some((brand) => matchesSegment(bytes, { offset: 8, bytes: brand }));
  return isAudio ? 'audio/mp4' : 'video/mp4';
}

/**
 * `true` se a amostra começa com um MPEG audio frame sync (MP3 sem tag ID3): o
 * primeiro byte é `0xFF` e os 3 bits mais altos do segundo byte são `1` (máscara
 * `0xE0`). Distingue-se do JPEG (`FF D8`), cujo `0xD8 & 0xE0 = 0xC0`, e do ftyp.
 *
 * @param bytes - Amostra do início do arquivo.
 * @returns `true` se casar o frame sync de MP3.
 */
function isMp3FrameSync(bytes: Uint8Array): boolean {
  const b0 = bytes[0];
  const b1 = bytes[1];
  if (b0 === undefined || b1 === undefined) {
    return false;
  }
  return b0 === 0xff && (b1 & 0xe0) === 0xe0;
}

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
  // Contêineres de áudio/vídeo (M4-14/#73): mapeados para o MIME que o `detectMime`
  // produz para o mesmo conteúdo, minimizando avisos de mismatch espúrios. O `mov`
  // é declarado como `video/mp4` porque a brand `qt  ` é classificada como vídeo.
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/webm',
  avi: 'video/x-msvideo',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
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
  // Contêineres que exigem lógica além de casar bytes fixos: ISO-BMFF (a brand
  // decide áudio vs vídeo) e MP3 sem tag ID3 (frame sync com máscara de bits).
  const ftyp = detectFtypMime(bytes);
  if (ftyp !== undefined) {
    return ftyp;
  }
  if (isMp3FrameSync(bytes)) {
    return 'audio/mpeg';
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
