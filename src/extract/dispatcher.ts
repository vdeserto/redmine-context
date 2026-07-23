/**
 * Dispatcher de extratores por magic bytes (M3-08, ADR-005).
 *
 * Roteia um arquivo de anexo já baixado para o extrator certo com base no MIME
 * REAL (detectado por magic bytes, ver `./magic.ts`) — NUNCA pela extensão nem
 * pelo `Content-Type` do Redmine. Se a extensão declarada contradiz o magic
 * byte, emite um `logger.warn` (nunca `console.*`) e o MAGIC BYTE VENCE. Tipos
 * sem extrator registrado devolvem `ExtractionResult { status: 'unsupported' }`
 * com metadados — degradação graciosa, sem erro fatal.
 *
 * Este módulo NÃO contém nenhum extrator real (tesseract/OCR é a #51): apenas a
 * interface {@link Extractor}, o {@link ExtractorRegistry} e o roteamento. Um
 * extrator fake nos testes prova o roteamento fim-a-fim.
 */

import type { ExtractorParams } from '../cache/contract.js';
import type { Logger } from '../client/index.js';
import type { ExtractionResult } from '../contract.js';

import { detectMimeFromFile, mimeForExtension } from './magic.js';

/**
 * Opções passadas ao extrator em {@link Extractor.extract}. Propositalmente
 * enxuta hoje (só o MIME real e um logger opcional); campos como timeout/signal
 * de cancelamento entram com a fila de jobs (issues seguintes do M3).
 */
export interface ExtractOptions {
  /** MIME REAL do arquivo (detectado por magic bytes) que roteou este extrator. */
  readonly mime: string;
  /** Logger para avisos do extrator; sem default de lib de logging (ADR-003). */
  readonly logger?: Logger;
}

/**
 * Contrato de um extrator plugável (ADR-005). Cada extrator declara os MIMEs que
 * suporta e implementa {@link extract} sobre um arquivo já baixado no cache.
 */
export interface Extractor {
  /** Identificador estável do extrator (ex.: `tesseract-ocr`). */
  readonly id: string;
  /** Versão do extrator (semântica própria; entra em metadados/cache-key). */
  readonly version: string;
  /** MIMEs REAIS que este extrator aceita (ex.: `['image/png', 'image/jpeg']`). */
  readonly supportedMimes: readonly string[];
  /**
   * Modelo lógico do extrator (ADR-004). Participa da chave attachment-level; se
   * omitido, o pipeline usa {@link id} como fallback estável.
   */
  readonly model?: string;
  /**
   * Parâmetros escalares estáveis do extrator (ADR-004). Participam da chave
   * attachment-level; se omitidos, o pipeline usa `{}`.
   */
  readonly params?: ExtractorParams;
  /**
   * Extrai conteúdo do arquivo.
   *
   * @param filePath - Caminho absoluto do arquivo baixado.
   * @param options - MIME real detectado + logger — ver {@link ExtractOptions}.
   * @returns O {@link ExtractionResult} da extração.
   */
  extract(filePath: string, options: ExtractOptions): Promise<ExtractionResult>;
}

/**
 * Registro de extratores indexado por MIME. Mantém a associação MIME → extrator
 * e resolve o roteamento em O(1). Um mesmo extrator pode cobrir vários MIMEs.
 */
export class ExtractorRegistry {
  /** Índice MIME → extrator. O último registrado para um MIME prevalece. */
  private readonly byMime = new Map<string, Extractor>();

  /**
   * Registra um extrator para todos os seus {@link Extractor.supportedMimes}.
   * Registrar de novo o mesmo MIME sobrescreve o extrator anterior.
   *
   * @param extractor - Extrator a registrar.
   * @returns O próprio registry (encadeável).
   */
  register(extractor: Extractor): this {
    for (const mime of extractor.supportedMimes) {
      this.byMime.set(mime, extractor);
    }
    return this;
  }

  /**
   * Encontra o extrator registrado para um MIME.
   *
   * @param mime - MIME REAL detectado por magic bytes.
   * @returns O extrator, ou `undefined` se nenhum cobre esse MIME.
   */
  find(mime: string): Extractor | undefined {
    return this.byMime.get(mime);
  }
}

/** Opções de {@link dispatchExtraction}. */
export interface DispatchOptions {
  /** Registry consultado para achar o extrator do MIME real. */
  readonly registry: ExtractorRegistry;
  /**
   * Filename declarado pelo Redmine (não confiável) — usado APENAS para detectar
   * e avisar mismatch de extensão vs magic byte. Opcional.
   */
  readonly filename?: string;
  /** Logger para o aviso de mismatch; sem default de lib de logging (ADR-003). */
  readonly logger?: Logger;
}

/**
 * Monta um {@link ExtractionResult} `unsupported` com metadados de diagnóstico,
 * respeitando `exactOptionalPropertyTypes` (não injeta chaves `undefined`).
 *
 * @param mime - MIME real detectado (ou `undefined` se indetectável).
 * @param filename - Filename declarado, se houver.
 * @returns Resultado `unsupported` com `mime`/`metadata` preenchidos quando disponíveis.
 */
function unsupported(mime: string | undefined, filename: string | undefined): ExtractionResult {
  const metadata: Record<string, unknown> = {
    reason: mime === undefined ? 'mime-indetectavel' : 'sem-extrator-registrado',
  };
  if (filename !== undefined) {
    metadata.filename = filename;
  }
  return {
    status: 'unsupported',
    ...(mime !== undefined ? { mime } : {}),
    metadata,
  };
}

/**
 * Roteia um arquivo de anexo baixado para o extrator apropriado, decidindo o
 * tipo SEMPRE pelo MIME REAL (magic bytes).
 *
 * Fluxo:
 * 1. Detecta o MIME real do arquivo (magic bytes). Indetectável (vazio/curto/
 *    binário desconhecido) → `unsupported` com `reason: 'mime-indetectavel'`.
 * 2. Se `filename` foi dado e sua extensão declara um MIME que CONTRADIZ o real,
 *    emite `logger.warn` — e segue com o MIME real (o magic byte VENCE).
 * 3. Busca o extrator no registry. Ausente → `unsupported` com
 *    `reason: 'sem-extrator-registrado'` (sem erro fatal).
 * 4. Presente → delega para `extractor.extract(filePath, { mime, logger })`.
 *
 * @param filePath - Caminho absoluto do arquivo baixado.
 * @param options - Registry, filename (opcional) e logger — ver {@link DispatchOptions}.
 * @returns O {@link ExtractionResult} do extrator, ou um `unsupported` gracioso.
 * @throws {Error} Se `filePath` não puder ser lido (propagado de {@link detectMimeFromFile}).
 * @example
 * const result = await dispatchExtraction('/cache/…/original.png', {
 *   registry,
 *   filename: 'photo.png',
 *   logger,
 * });
 * if (result.status === 'unsupported') logger.warn('sem extrator');
 */
export async function dispatchExtraction(
  filePath: string,
  options: DispatchOptions,
): Promise<ExtractionResult> {
  const { registry, filename, logger } = options;

  const mime = await detectMimeFromFile(filePath);
  if (mime === undefined) {
    return unsupported(undefined, filename);
  }

  // Mismatch extensão vs magic byte: avisa, mas o magic byte é a fonte de verdade.
  if (filename !== undefined) {
    const declaredMime = mimeForExtension(filename);
    if (declaredMime !== undefined && declaredMime !== mime) {
      logger?.warn(
        `extract: mismatch de tipo em "${filename}" — extensão sugere ${declaredMime}, ` +
          `mas os magic bytes indicam ${mime}; usando ${mime} (magic byte vence)`,
      );
    }
  }

  const extractor = registry.find(mime);
  if (extractor === undefined) {
    return unsupported(mime, filename);
  }

  return extractor.extract(filePath, {
    mime,
    ...(logger !== undefined ? { logger } : {}),
  });
}
