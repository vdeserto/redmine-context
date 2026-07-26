/**
 * Orquestração core da extração de anexos de uma issue (M3-10, ADR-002/ADR-005).
 *
 * É a AMARRAÇÃO do M3: liga download → dispatcher → extrator → cache → bundle.
 * Para cada anexo de IMAGEM da issue, resolve o extrator no registry, calcula a
 * chave attachment-level ({@link buildAttachmentKey}) e, sob {@link getOrCompute}
 * (cache de 2 camadas), baixa o binário (respeitando limite/skip do ADR-002) e o
 * roteia para o extrator via {@link dispatchExtraction} (magic byte vence). O
 * resultado é um `Map<attachmentId, ExtractionResult>` consumido pelos bundles.
 *
 * DEGRADAÇÃO GRACIOSA (ADR-002), toda exercitada por testes:
 * - tesseract AUSENTE não impede o bundle: o extrator devolve `failed` com motivo
 *   de instalação; o anexo apenas carrega esse status.
 * - a falha de UM anexo (rede, IO) NÃO derruba os demais: cada anexo roda numa
 *   Promise com `catch` individual que a converte em `failed`.
 * - cache-hit não re-extrai: `getOrCompute` serve do store sem baixar nem rodar o
 *   extrator caro de novo.
 *
 * Só anexos cujo MIME provável (extensão/`content_type`) tem extrator registrado
 * são processados — os demais nem entram no mapa (não há trabalho a fazer). A
 * ROTEAMENTO real dentro do `compute` ainda é decidido por magic bytes.
 */

import {
  buildAttachmentKey,
  defaultCacheDir,
  getOrCompute,
  type CacheStore,
  type ExtractorConfig,
} from './cache/index.js';
import { RedmineAuthError } from './client/index.js';
import type { HttpClient, Logger } from './client/index.js';
import type { Attachment, ExtractionResult, Issue } from './contract.js';
import {
  dispatchExtraction,
  downloadAttachment,
  isSkipped,
  mimeForExtension,
  type Extractor,
  type ExtractorRegistry,
} from './extract/index.js';

/** Opções de {@link extractIssueAttachments}. */
export interface ExtractIssueAttachmentsOptions {
  /** URL base da instância Redmine — vira o `instance_hash` da chave e do path. */
  instanceUrl: string;
  /** Registry consultado para achar o extrator do MIME real de cada anexo. */
  registry: ExtractorRegistry;
  /** Store de cache attachment-level (memória ou disco) — ver {@link CacheStore}. */
  store: CacheStore<ExtractionResult>;
  /** Raiz do cache em disco p/ os downloads. Default: {@link defaultCacheDir}. */
  cacheDir?: string;
  /** Limite (bytes) por anexo; acima disso o download é pulado. Default do downloader. */
  maxBytes?: number;
  /** Logger para avisos (falha de anexo, mismatch); default no-op. Nunca `console.*`. */
  logger?: Logger;
}

/**
 * MIME provável de um anexo, para PRÉ-FILTRO e seleção do extrator da chave de
 * cache: a extensão declarada e, em falta, o `content_type`. NÃO é a fonte de
 * verdade do roteamento (isso é magic byte, dentro do `compute`).
 *
 * @param attachment - Anexo do contrato.
 * @returns MIME provável, ou `undefined` se indeterminável.
 */
export function probableMime(attachment: Attachment): string | undefined {
  return mimeForExtension(attachment.filename) ?? attachment.content_type;
}

/**
 * Deriva a {@link ExtractorConfig} da chave de cache a partir de um extrator,
 * usando defaults estáveis quando `model`/`params` não são declarados.
 *
 * @param extractor - Extrator resolvido pelo registry.
 * @returns Config `(version, model, params)` para {@link buildAttachmentKey}.
 */
export function toExtractorConfig(extractor: Extractor): ExtractorConfig {
  return {
    version: extractor.version,
    model: extractor.model ?? extractor.id,
    params: extractor.params ?? {},
  };
}

/** Monta um `ExtractionResult` `failed` a partir de um erro do pipeline. */
function failedFromError(error: unknown): ExtractionResult {
  return {
    status: 'failed',
    metadata: {
      reason: 'erro-pipeline',
      error: error instanceof Error ? error.message : String(error),
    },
  };
}

/** Parâmetros internos resolvidos de {@link extractOne}. */
interface ExtractOneContext {
  http: HttpClient;
  attachment: Attachment;
  extractor: Extractor;
  instanceUrl: string;
  cacheDir: string;
  store: CacheStore<ExtractionResult>;
  registry: ExtractorRegistry;
  maxBytes: number | undefined;
  logger: Logger | undefined;
}

/**
 * Extrai UM anexo sob cache: `getOrCompute(store, key, () => baixa + roteia)`.
 * A chave attachment-level é imutável por conteúdo+extrator, então um cache-hit
 * dispensa baixar e re-extrair.
 *
 * @param ctx - Contexto resolvido — ver {@link ExtractOneContext}.
 * @returns O {@link ExtractionResult} (cacheado ou recém-computado).
 */
function extractOne(ctx: ExtractOneContext): Promise<ExtractionResult> {
  const { http, attachment, extractor, instanceUrl, cacheDir, store, registry, maxBytes, logger } = ctx;
  const key = buildAttachmentKey({ instanceUrl, attachment, extractor: toExtractorConfig(extractor) });

  return getOrCompute(store, key, async () => {
    const download = await downloadAttachment(http, attachment, {
      cacheDir,
      instanceUrl,
      ...(maxBytes !== undefined ? { maxBytes } : {}),
    });
    if (isSkipped(download)) {
      return { status: 'skipped', metadata: { reason: download.reason } };
    }
    return dispatchExtraction(download, {
      registry,
      filename: attachment.filename,
      ...(logger !== undefined ? { logger } : {}),
    });
  });
}

/**
 * Extrai o texto de TODOS os anexos de imagem de uma issue, em paralelo e com
 * degradação graciosa por anexo (ADR-002).
 *
 * @param http - Client HTTP autenticado da instância — ver {@link HttpClient}.
 * @param issue - Issue normalizada cujos anexos serão processados.
 * @param options - Ver {@link ExtractIssueAttachmentsOptions}.
 * @returns `Map<attachmentId, ExtractionResult>` — só com anexos de imagem
 *   (extrator registrado). Um anexo que falhe entra como `failed`, nunca ausente.
 * @example
 * const registry = await createDefaultRegistry();
 * const store = new DiskCacheStore<ExtractionResult>({ cacheDir });
 * const map = await extractIssueAttachments(http, issue, {
 *   instanceUrl: 'https://redmine.example', cacheDir, store, registry,
 * });
 */
export async function extractIssueAttachments(
  http: HttpClient,
  issue: Issue,
  options: ExtractIssueAttachmentsOptions,
): Promise<Map<number, ExtractionResult>> {
  const { instanceUrl, registry, store, maxBytes, logger } = options;
  const cacheDir = options.cacheDir ?? defaultCacheDir();

  // Pré-filtro: só anexos cujo MIME provável tem extrator registrado. Os demais
  // (PDFs, textos, tipos sem extrator) não geram trabalho nem entram no mapa.
  const targets: { attachment: Attachment; extractor: Extractor }[] = [];
  for (const attachment of issue.attachments) {
    const mime = probableMime(attachment);
    const extractor = mime !== undefined ? registry.find(mime) : undefined;
    if (extractor !== undefined) {
      targets.push({ attachment, extractor });
    }
  }

  const entries = await Promise.all(
    targets.map(async ({ attachment, extractor }): Promise<readonly [number, ExtractionResult]> => {
      try {
        const result = await extractOne({
          http,
          attachment,
          extractor,
          instanceUrl,
          cacheDir,
          store,
          registry,
          maxBytes,
          logger,
        });
        return [attachment.id, result] as const;
      } catch (error) {
        // Erro de AUTENTICAÇÃO não é falha de UM anexo: a credencial do
        // processo expirou e nenhum download vai funcionar — propaga para o
        // chamador acionar o re-login (review #141). O resto (rede/IO/
        // subprocesso) degrada por anexo, como manda o ADR-002.
        if (error instanceof RedmineAuthError) {
          throw error;
        }
        logger?.warn(
          `extract: falha ao processar o anexo #${attachment.id} (${attachment.filename}); ` +
            `seguindo sem ele: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [attachment.id, failedFromError(error)] as const;
      }
    }),
  );

  return new Map(entries);
}
