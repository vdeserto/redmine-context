/**
 * Extrator de texto de documentos OOXML — docx/pptx/xlsx (#184, ADR-002/ADR-005).
 *
 * 100% LOCAL e SEM BINÁRIO externo (não entra no `doctor`; funciona nos 3 SOs sem
 * instalar nada): um arquivo Office moderno é um contêiner ZIP com o conteúdo em
 * XML. Este extrator abre o zip ({@link parseZip}, zero-dep), DESAMBIGUA o formato
 * pelo conteúdo (não pela extensão nem pelo Content-Type) e puxa o texto das tags
 * de run de cada dialeto:
 *
 *   docx → `word/document.xml`            tags `<w:t>` (parágrafo `</w:p>`, tab `<w:tab/>`)
 *   pptx → `ppt/slides/slide<N>.xml`      tags `<a:t>` (parágrafo `</a:p>`), na ordem dos slides
 *   xlsx → `xl/sharedStrings.xml`         tags `<t>`   (uma string por `</si>`)
 *
 * É registrado para o MIME `application/zip` (o `magic.ts` reporta OOXML como zip;
 * a "diferenciação fina" fica aqui, como o próprio `magic.ts` documenta). Um zip
 * que NÃO é OOXML devolve `unsupported`; zip corrompido/entrada ausente/vazio
 * devolve `failed` — degradação graciosa, NUNCA crash (ADR-002).
 *
 * O texto extraído é marcado como não-confiável no bundle pelo mesmo mecanismo do
 * tesseract/pdf (`<untrusted-content>`), então aqui só devolvemos `{ status:'done', text }`.
 */

import { readFile } from 'node:fs/promises';

import type { ExtractorParams } from '../cache/contract.js';
import type { ExtractorConfig } from '../cache/keys.js';
import type { ExtractionResult } from '../contract.js';

import { type ExtractOptions, type Extractor } from './dispatcher.js';
import { parseZip, type ZipArchive } from './zip.js';

/** Identificador estável do extrator (entra em metadados/cache-key). */
const EXTRACTOR_ID = 'ooxml';
/** Modelo lógico para a chave de cache (ADR-004). */
const EXTRACTOR_MODEL = 'ooxml';
/** Versão da integração (participa da chave de cache; bump ao mudar a extração). */
const EXTRACTOR_VERSION = 'ooxml-1';

/** Teto do arquivo lido para a memória (defensivo; o download já limita a 100 MB). */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** MIME REAL (magic bytes `PK\x03\x04`) que roteia este extrator. */
export const OOXML_MIMES: readonly string[] = ['application/zip'];

/** Entradas-âncora que identificam cada formato OOXML dentro do zip. */
const DOCX_MAIN = 'word/document.xml';
const PPTX_MAIN = 'ppt/presentation.xml';
const XLSX_MAIN = 'xl/workbook.xml';
const XLSX_STRINGS = 'xl/sharedStrings.xml';

/** Regex de um nome de slide do pptx, capturando o número para ordenação. */
const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** Entidades XML nomeadas suportadas no desescape. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Desescapa entidades XML (nomeadas + numéricas decimais/hex). Sequências
 * desconhecidas são mantidas literais.
 *
 * @param s - Texto com entidades XML.
 * @returns Texto com as entidades resolvidas.
 */
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const cp = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
    }
    if (code.startsWith('#')) {
      const cp = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

/** Escapa metacaracteres de regex de um literal (nome de tag). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Dialeto de um formato: tag de texto + tags que viram quebra de linha/tabulação. */
interface Dialect {
  /** Nome da tag de run de texto (ex.: `w:t`, `a:t`, `t`). */
  readonly textTag: string;
  /** Fragmentos de regex (já regex-safe) que representam quebra de parágrafo/linha. */
  readonly newlineTags: readonly string[];
  /** Fragmentos de regex (já regex-safe) que viram tabulação. */
  readonly tabTags?: readonly string[];
}

/**
 * Extrai texto de um XML OOXML percorrendo, EM ORDEM, apenas: o conteúdo das tags
 * de texto do dialeto, as tags de quebra (→ `\n`) e as de tab (→ `\t`). Ignora
 * TODO o resto (inclusive o espaço em branco insignificante entre elementos, que
 * uma remoção ingênua de tags capturaria por engano).
 *
 * @param xml - Conteúdo XML da parte.
 * @param dialect - Dialeto do formato (tags de texto/quebra/tab).
 * @returns Texto concatenado com quebras/tabs nos limites estruturais.
 */
function extractTextFromXml(xml: string, dialect: Dialect): string {
  const tag = escapeRe(dialect.textTag);
  const branches = [`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`];
  if (dialect.newlineTags.length > 0) {
    branches.push(`(?<nl>${dialect.newlineTags.join('|')})`);
  }
  if (dialect.tabTags && dialect.tabTags.length > 0) {
    branches.push(`(?<tb>${dialect.tabTags.join('|')})`);
  }
  const re = new RegExp(branches.join('|'), 'g');

  let out = '';
  for (const m of xml.matchAll(re)) {
    if (m[1] !== undefined) {
      out += unescapeXml(m[1]);
    } else if (m.groups?.nl !== undefined) {
      out += '\n';
    } else if (m.groups?.tb !== undefined) {
      out += '\t';
    }
  }
  return out;
}

/** Normaliza o texto extraído: tira espaço antes de `\n` e colapsa 3+ quebras. */
function normalize(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const DOCX_DIALECT: Dialect = {
  textTag: 'w:t',
  newlineTags: ['<\\/w:p>', '<w:br\\s*\\/?>', '<w:cr\\s*\\/?>'],
  tabTags: ['<w:tab\\s*\\/?>'],
};

const PPTX_DIALECT: Dialect = {
  textTag: 'a:t',
  newlineTags: ['<\\/a:p>', '<a:br\\s*\\/?>'],
};

const XLSX_DIALECT: Dialect = {
  textTag: 't',
  newlineTags: ['<\\/si>'],
};

/**
 * Extrator OOXML (docx/pptx/xlsx). Implementa {@link Extractor} e expõe
 * {@link params}/{@link extractorConfig} estáveis para a chave de cache (ADR-004).
 */
export class OoxmlExtractor implements Extractor {
  readonly id = EXTRACTOR_ID;
  readonly version = EXTRACTOR_VERSION;
  readonly supportedMimes = OOXML_MIMES;
  readonly model = EXTRACTOR_MODEL;
  /** Sem parâmetros escalares que alterem a saída (extração determinística). */
  readonly params: ExtractorParams = {};

  /**
   * Configuração pronta para {@link buildAttachmentKey} (ADR-004).
   * @returns `{ version, model, params }` estáveis desta instância.
   */
  get extractorConfig(): ExtractorConfig {
    return { version: this.version, model: this.model, params: this.params };
  }

  /**
   * Extrai o texto de um arquivo OOXML. Nunca lança: zip inválido/entrada
   * ausente/vazio → `failed`; zip que não é OOXML → `unsupported`; signal já
   * abortado → `cancelled`.
   *
   * @param filePath - Caminho absoluto do arquivo baixado.
   * @param options - MIME real + logger + signal — ver {@link ExtractOptions}.
   * @returns `done` com `text` no sucesso; `unsupported`/`failed`/`cancelled` caso contrário.
   */
  async extract(filePath: string, options: ExtractOptions): Promise<ExtractionResult> {
    if (options.signal?.aborted) {
      return this.terminal('cancelled', options.mime, { reason: 'cancelado' });
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch (error) {
      return this.failed(options.mime, 'erro-leitura', { error: message(error) });
    }
    if (buffer.length > MAX_FILE_BYTES) {
      return this.failed(options.mime, 'arquivo-muito-grande', { bytes: buffer.length });
    }

    let zip: ZipArchive;
    try {
      zip = parseZip(buffer);
    } catch (error) {
      return this.failed(options.mime, 'zip-invalido', { error: message(error) });
    }

    let format: string;
    let text: string;
    try {
      if (zip.has(DOCX_MAIN)) {
        format = 'docx';
        text = extractTextFromXml(readText(zip, DOCX_MAIN), DOCX_DIALECT);
      } else if (zip.has(PPTX_MAIN)) {
        format = 'pptx';
        text = this.extractPptx(zip);
      } else if (zip.has(XLSX_MAIN)) {
        format = 'xlsx';
        text = zip.has(XLSX_STRINGS)
          ? extractTextFromXml(readText(zip, XLSX_STRINGS), XLSX_DIALECT)
          : '';
      } else {
        return this.terminal('unsupported', options.mime, { reason: 'zip-nao-ooxml' });
      }
    } catch (error) {
      return this.failed(options.mime, 'erro-extracao', { error: message(error) });
    }

    const normalized = normalize(text);
    if (normalized.length === 0) {
      return this.failed(options.mime, 'ooxml-sem-texto', {
        format,
        hint: 'documento OOXML sem texto extraível (ex.: planilha só com números ou slides só com imagens)',
      });
    }

    return {
      status: 'done',
      text: normalized,
      mime: options.mime,
      metadata: { extractorId: this.id, version: this.version, format },
    };
  }

  /** Concatena o texto de todos os slides do pptx, na ORDEM numérica dos slides. */
  private extractPptx(zip: ZipArchive): string {
    const slides = zip
      .names()
      .map((name) => {
        const m = SLIDE_RE.exec(name);
        return m ? { name, n: Number.parseInt(m[1] as string, 10) } : undefined;
      })
      .filter((x): x is { name: string; n: number } => x !== undefined)
      .sort((a, b) => a.n - b.n);

    let out = '';
    for (const slide of slides) {
      out += extractTextFromXml(readText(zip, slide.name), PPTX_DIALECT);
    }
    return out;
  }

  /**
   * Monta um resultado terminal simples (`unsupported`/`cancelled`) com metadados.
   * @param status - Status terminal.
   * @param mime - MIME real detectado.
   * @param extra - Metadados adicionais.
   */
  private terminal(
    status: 'unsupported' | 'cancelled',
    mime: string,
    extra: Record<string, unknown>,
  ): ExtractionResult {
    return { status, mime, metadata: { extractorId: this.id, ...extra } };
  }

  /**
   * Monta um `ExtractionResult` `failed` com diagnóstico (sem chaves `undefined`).
   * @param mime - MIME real detectado.
   * @param reason - Motivo canônico da falha.
   * @param extra - Metadados adicionais (erro/hint/format).
   */
  private failed(mime: string, reason: string, extra: Record<string, unknown>): ExtractionResult {
    return {
      status: 'failed',
      mime,
      metadata: { extractorId: this.id, version: this.version, reason, ...extra },
    };
  }
}

/** Lê uma entrada de texto (UTF-8) do zip; lança se ausente (entrada esperada). */
function readText(zip: ZipArchive, name: string): string {
  const buf = zip.read(name);
  if (buf === undefined) {
    throw new Error(`entrada esperada ausente no OOXML: "${name}"`);
  }
  return buf.toString('utf8');
}

/** Extrai a mensagem de um erro desconhecido. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Cria um {@link OoxmlExtractor} pronto para registro. Sem trabalho assíncrono
 * (não há binário a localizar) — a fábrica existe por simetria com os demais.
 *
 * @returns Uma instância do extrator OOXML.
 */
export function createOoxmlExtractor(): OoxmlExtractor {
  return new OoxmlExtractor();
}
