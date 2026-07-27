/**
 * Leitor de ZIP MÍNIMO e ZERO-DEPENDÊNCIA (#184) — só o necessário para ler
 * entradas de contêineres OOXML (docx/pptx/xlsx). Fiel ao estilo do projeto
 * ("sem dependência nova", como o `magic.ts`): usa apenas `node:zlib`.
 *
 * Lê o End Of Central Directory (EOCD) do fim do buffer, percorre o Central
 * Directory (a fonte AUTORITATIVA dos tamanhos/offsets — funciona mesmo com data
 * descriptors) e extrai cada entrada sob demanda: método STORED (0) devolve os
 * bytes crus; DEFLATE (8) infla via `inflateRawSync`. Entradas de diretório
 * (nome terminando em `/`) são ignoradas.
 *
 * SEGURANÇA (anti-zip-bomb): a inflação é limitada por `maxOutputLength`
 * ({@link MAX_ENTRY_BYTES}); uma entrada que estoure o teto lança em vez de
 * alocar memória sem limite. Não suporta ZIP64 (contêineres Office reais cabem
 * folgadamente abaixo dos limites de 32 bits) — arquivos ZIP64 lançam, e o
 * chamador degrada graciosamente.
 */

import { inflateRawSync } from 'node:zlib';

/** Assinatura do End Of Central Directory record (`PK\x05\x06`). */
const EOCD_SIG = 0x06054b50;
/** Assinatura de um Central Directory file header (`PK\x01\x02`). */
const CDH_SIG = 0x02014b50;
/** Assinatura de um Local file header (`PK\x03\x04`). */
const LFH_SIG = 0x04034b50;

/** Método de compressão: armazenado sem compressão. */
const METHOD_STORED = 0;
/** Método de compressão: DEFLATE. */
const METHOD_DEFLATE = 8;

/** Teto de bytes descomprimidos por entrada (anti-zip-bomb): 64 MiB. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/** Tamanho fixo do EOCD record (sem comentário). */
const EOCD_MIN = 22;
/** Tamanho fixo do Central Directory file header (sem nome/extra/comentário). */
const CDH_FIXED = 46;
/** Tamanho fixo do Local file header (sem nome/extra). */
const LFH_FIXED = 30;
/** Comprimento máximo do comentário do EOCD (campo uint16). */
const MAX_COMMENT = 0xffff;

/** Metadados de uma entrada do ZIP, lidos do Central Directory. */
export interface ZipEntry {
  /** Nome (caminho) da entrada dentro do zip. */
  readonly name: string;
  /** Método de compressão (0 = stored, 8 = deflate). */
  readonly method: number;
  /** Tamanho comprimido em bytes. */
  readonly compressedSize: number;
  /** Tamanho descomprimido em bytes. */
  readonly uncompressedSize: number;
  /** Offset do Local file header desta entrada no buffer. */
  readonly localHeaderOffset: number;
}

/** Arquivo ZIP parseado: consulta e leitura de entradas por nome. */
export interface ZipArchive {
  /** Nomes de todas as entradas de arquivo (exclui diretórios). */
  names(): string[];
  /** `true` se existe uma entrada de arquivo com esse nome exato. */
  has(name: string): boolean;
  /** Lê e descomprime uma entrada; `undefined` se não existir. */
  read(name: string): Buffer | undefined;
}

/**
 * Localiza o offset do EOCD varrendo do fim do buffer para trás (o comentário
 * final tem até 64 KiB). Retorna o offset do PRIMEIRO EOCD encontrado a partir do
 * fim.
 *
 * @param buf - Buffer do arquivo zip inteiro.
 * @returns Offset do EOCD.
 * @throws {Error} Se o buffer for menor que o EOCD mínimo ou não tiver a assinatura.
 */
function findEocd(buf: Buffer): number {
  if (buf.length < EOCD_MIN) {
    throw new Error('zip inválido: buffer menor que o EOCD mínimo');
  }
  const floor = Math.max(0, buf.length - EOCD_MIN - MAX_COMMENT);
  for (let i = buf.length - EOCD_MIN; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      // Anti-spoofing (dados anexados após o zip): um EOCD REAL termina EXATAMENTE
      // no fim do arquivo (offset + 22 + tamanho-do-comentário === buf.length). Sem
      // essa checagem, uma segunda assinatura `PK\x05\x06` forjada e anexada ao fim
      // seria aceita, permitindo apontar o central directory para conteúdo diferente
      // do que o Word abriria. Um Office real tem comentário vazio e EOCD no EOF.
      const commentLen = buf.readUInt16LE(i + 20);
      if (i + EOCD_MIN + commentLen === buf.length) {
        return i;
      }
    }
  }
  throw new Error('zip inválido: EOCD ausente ou inconsistente (dados anexados?)');
}

/** Implementação de {@link ZipArchive} sobre um buffer + índice de entradas. */
class BufferZipArchive implements ZipArchive {
  constructor(
    private readonly buf: Buffer,
    private readonly entries: ReadonlyMap<string, ZipEntry>,
  ) {}

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  read(name: string): Buffer | undefined {
    const entry = this.entries.get(name);
    if (entry === undefined) {
      return undefined;
    }
    return this.readEntry(entry);
  }

  /**
   * Lê e descomprime uma entrada usando o Local file header (para o offset dos
   * dados) e o `compressedSize` do Central Directory (autoritativo).
   *
   * @param entry - Entrada a ler.
   * @returns Bytes descomprimidos.
   * @throws {Error} Se o header local for inválido, os dados truncados, o método
   *   não suportado, ou a inflação estourar {@link MAX_ENTRY_BYTES}.
   */
  private readEntry(entry: ZipEntry): Buffer {
    const buf = this.buf;
    const off = entry.localHeaderOffset;
    if (off + LFH_FIXED > buf.length || buf.readUInt32LE(off) !== LFH_SIG) {
      throw new Error(`zip inválido: local header ausente para "${entry.name}"`);
    }
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const dataStart = off + LFH_FIXED + nameLen + extraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buf.length) {
      throw new Error(`zip inválido: dados truncados para "${entry.name}"`);
    }
    const raw = buf.subarray(dataStart, dataEnd);

    if (entry.method === METHOD_STORED) {
      if (raw.length > MAX_ENTRY_BYTES) {
        throw new Error(`entrada "${entry.name}" excede o teto de ${MAX_ENTRY_BYTES} bytes`);
      }
      return Buffer.from(raw);
    }
    if (entry.method === METHOD_DEFLATE) {
      return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    }
    throw new Error(`método de compressão não suportado (${entry.method}) em "${entry.name}"`);
  }
}

/**
 * Parseia um buffer ZIP e devolve um {@link ZipArchive} para leitura sob demanda.
 *
 * @param buffer - Conteúdo completo do arquivo zip.
 * @returns O arquivo parseado (índice de entradas + leitura preguiçosa).
 * @throws {Error} Se o buffer não for um zip válido ou for ZIP64 (não suportado).
 * @example
 * const zip = parseZip(await readFile('a.docx'));
 * const xml = zip.read('word/document.xml')?.toString('utf8');
 */
export function parseZip(buffer: Buffer): ZipArchive {
  const eocd = findEocd(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('zip64 não suportado');
  }

  const entries = new Map<string, ZipEntry>();
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (p + CDH_FIXED > buffer.length || buffer.readUInt32LE(p) !== CDH_SIG) {
      throw new Error('zip inválido: central directory corrompido');
    }
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const uncompressedSize = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localHeaderOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + CDH_FIXED, p + CDH_FIXED + nameLen);
    // Entradas de diretório (nome terminando em `/`) não têm conteúdo útil.
    // Nomes DUPLICADOS: last-write-wins (o `Map` sobrescreve). Decisão consciente —
    // não há escrita em disco (sem path traversal), apenas round-trip de texto; a
    // última entrada com aquele nome é a lida, como na maioria dos leitores de zip.
    if (!name.endsWith('/')) {
      entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });
    }
    p += CDH_FIXED + nameLen + extraLen + commentLen;
  }

  return new BufferZipArchive(buffer, entries);
}
