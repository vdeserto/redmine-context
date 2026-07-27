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
 * ROBUSTEZ CONTRA INPUT ADVERSARIAL (anexos são input não confiável de qualquer
 * usuário do Redmine):
 *  - a extração de texto é um SCANNER DE UM PASSO (O(n) linear, sem backtracking) —
 *    NÃO usa `regex.matchAll` sobre o documento inteiro, que degeneraria para O(n²)
 *    com tags de texto abertas e nunca fechadas (DoS de CPU trivial);
 *  - orçamento AGREGADO de descompressão no pptx (não só por-entrada) + teto de
 *    slides, contra zip-bombs de muitas entradas;
 *  - `unescapeXml` valida o range Unicode antes de `fromCodePoint` (entidade
 *    numérica fora de range é mantida literal, nunca lança).
 *
 * O texto extraído é marcado como não-confiável no bundle pelo mesmo mecanismo do
 * tesseract/pdf (`<untrusted-content>`), então aqui só devolvemos `{ status:'done', text }`.
 */

import { readFile, stat } from 'node:fs/promises';

import type { ExtractorParams } from '../cache/contract.js';
import type { ExtractorConfig } from '../cache/keys.js';
import type { ExtractionResult } from '../contract.js';
import type { Logger } from '../client/index.js';

import { type ExtractOptions, type Extractor } from './dispatcher.js';
import { parseZip, type ZipArchive } from './zip.js';

/** Identificador estável do extrator (entra em metadados/cache-key). */
const EXTRACTOR_ID = 'ooxml';
/** Modelo lógico para a chave de cache (ADR-004). */
const EXTRACTOR_MODEL = 'ooxml';
/** Versão da integração (participa da chave de cache; bump ao mudar a extração). */
const EXTRACTOR_VERSION = 'ooxml-1';

/** Teto do arquivo (verificado por `stat` ANTES do `readFile`; download já limita). */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Teto AGREGADO de texto descomprimido lido numa única extração de pptx (soma de
 * todos os slides). Complementa o teto por-entrada de {@link parseZip}: impede que
 * um `.pptx` pequeno com muitas entradas altamente compressíveis exploda em RAM/CPU.
 */
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

/** Teto de slides processados num pptx (defesa contra "milhares de slides vazios"). */
const MAX_SLIDES = 5000;

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

/** Maior code point Unicode válido (limite de `String.fromCodePoint`). */
const MAX_CODE_POINT = 0x10ffff;

/**
 * Desescapa entidades XML (nomeadas + numéricas decimais/hex). Sequências
 * desconhecidas OU com code point fora do range Unicode são mantidas LITERAIS —
 * `String.fromCodePoint` nunca é chamado com valor inválido (não lança).
 *
 * @param s - Texto com entidades XML.
 * @returns Texto com as entidades resolvidas.
 * @internal Exportado para teste unitário (range de entidade numérica).
 */
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.startsWith('#')) {
      const hex = code.startsWith('#x') || code.startsWith('#X');
      const cp = Number.parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10);
      return Number.isInteger(cp) && cp >= 0 && cp <= MAX_CODE_POINT
        ? String.fromCodePoint(cp)
        : match;
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

/** Componentes classificados de uma tag XML (nome, se é fechamento, se é self-close). */
interface ParsedTag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClose: boolean;
}

/** Nome + tipo de uma tag a partir do seu interior (entre `<` e `>`). Bounded/linear. */
const TAG_RE = /^\s*(\/?)\s*([^\s/>]+)/;
function parseTag(inner: string): ParsedTag {
  const selfClose = inner.endsWith('/');
  const m = TAG_RE.exec(inner);
  return { name: m?.[2] ?? '', closing: m?.[1] === '/', selfClose };
}

/** Dialeto de um formato: tag de texto + tags que viram quebra de linha/tabulação. */
interface Dialect {
  /** Nome da tag de run de texto (ex.: `w:t`, `a:t`, `t`). */
  readonly textTag: string;
  /** Tags de FECHAMENTO que marcam fim de parágrafo/registro → `\n` (ex.: `w:p`, `si`). */
  readonly newlineClose: ReadonlySet<string>;
  /** Tags de ABERTURA (geralmente self-close) que viram `\n` (ex.: `w:br`, `w:cr`). */
  readonly newlineOpen: ReadonlySet<string>;
  /** Tags de ABERTURA que viram tabulação (ex.: `w:tab`). */
  readonly tabOpen: ReadonlySet<string>;
}

/** @internal Exportado para teste unitário (guarda de regressão de ReDoS). */
export const DOCX_DIALECT: Dialect = {
  textTag: 'w:t',
  newlineClose: new Set(['w:p']),
  newlineOpen: new Set(['w:br', 'w:cr']),
  tabOpen: new Set(['w:tab']),
};

const PPTX_DIALECT: Dialect = {
  textTag: 'a:t',
  newlineClose: new Set(['a:p']),
  newlineOpen: new Set(['a:br']),
  tabOpen: new Set(),
};

const XLSX_DIALECT: Dialect = {
  textTag: 't',
  newlineClose: new Set(['si']),
  newlineOpen: new Set(),
  tabOpen: new Set(),
};

/**
 * Extrai texto de um XML OOXML com um SCANNER DE UM PASSO (O(n), sem backtracking).
 * Percorre o buffer uma vez: em cada tag de TEXTO de run do dialeto captura o
 * conteúdo até o próximo `<` (runs OOXML não têm filhos), e converte as tags
 * estruturais (parágrafo/break → `\n`, tab → `\t`). Todo o resto — inclusive o
 * espaço em branco insignificante entre elementos — é ignorado.
 *
 * @param xml - Conteúdo XML da parte.
 * @param d - Dialeto do formato.
 * @returns Texto concatenado com quebras/tabs nos limites estruturais.
 */
export function extractTextFromXml(xml: string, d: Dialect): string {
  let out = '';
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) break; // tag não terminada (cauda malformada) — para com segurança
    const tag = parseTag(xml.slice(lt + 1, gt));
    i = gt + 1;

    if (!tag.closing && !tag.selfClose && tag.name === d.textTag) {
      // Conteúdo do run: do fim desta tag até o próximo `<` (o `</w:t>`). `<` só
      // aparece escapado como `&lt;` dentro do texto, então isto é seguro.
      const nextLt = xml.indexOf('<', i);
      const end = nextLt < 0 ? n : nextLt;
      out += unescapeXml(xml.slice(i, end));
      i = end;
    } else if (tag.closing && d.newlineClose.has(tag.name)) {
      out += '\n';
    } else if (!tag.closing && d.newlineOpen.has(tag.name)) {
      out += '\n';
    } else if (!tag.closing && d.tabOpen.has(tag.name)) {
      out += '\t';
    }
  }
  return out;
}

/** Normaliza o texto extraído: tira espaço antes de `\n` e colapsa 3+ quebras. */
function normalize(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

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

    // Checa o tamanho ANTES de carregar o arquivo na memória (defesa real caso o
    // cap de download upstream falhe/seja contornado).
    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch (error) {
      return this.failed(options.mime, 'erro-leitura', { error: message(error) });
    }
    if (size > MAX_FILE_BYTES) {
      return this.failed(options.mime, 'arquivo-muito-grande', { bytes: size });
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch (error) {
      return this.failed(options.mime, 'erro-leitura', { error: message(error) });
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
        text = this.extractPptx(zip, options.logger);
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

  /**
   * Concatena o texto de todos os slides do pptx, na ORDEM numérica dos slides,
   * com orçamento AGREGADO de bytes descomprimidos e teto de nº de slides.
   *
   * @param zip - Arquivo OOXML aberto.
   * @param logger - Logger opcional para avisos (ex.: teto de slides atingido).
   * @returns Texto concatenado dos slides.
   * @throws {Error} Se o total descomprimido exceder {@link MAX_TOTAL_BYTES}.
   */
  private extractPptx(zip: ZipArchive, logger?: Logger): string {
    const slides = zip
      .names()
      .map((name) => {
        const m = SLIDE_RE.exec(name);
        return m ? { name, n: Number.parseInt(m[1] as string, 10) } : undefined;
      })
      .filter((x): x is { name: string; n: number } => x !== undefined)
      .sort((a, b) => a.n - b.n);

    if (slides.length > MAX_SLIDES) {
      logger?.warn(
        `ooxml: pptx com ${slides.length} slides; processando apenas os primeiros ${MAX_SLIDES}`,
      );
    }
    const capped = slides.slice(0, MAX_SLIDES);

    let total = 0;
    let out = '';
    for (const slide of capped) {
      const xml = readText(zip, slide.name);
      total += Buffer.byteLength(xml, 'utf8');
      if (total > MAX_TOTAL_BYTES) {
        throw new Error(`orçamento de descompressão do pptx excedido (${MAX_TOTAL_BYTES} bytes)`);
      }
      out += extractTextFromXml(xml, PPTX_DIALECT);
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
