/**
 * Orquestração get → normalize → bundle de uma issue (M1-11).
 *
 * Função fina do core que as superfícies (CLI #17, MCP #18) reutilizam: recebe
 * as credenciais já resolvidas + o formato desejado e devolve uma
 * `AsyncIterable<CoreEvent<IssueBundleResult>>` — emitindo progresso incremental
 * e finalizando com um único {@link Result} contendo o bundle serializado.
 *
 * Mantém a fronteira do ADR-005: encapsula os módulos internos (`client`,
 * `normalize`, `bundle`) para que a superfície permaneça fina e desacoplada.
 */

import { buildJsonBundle } from './bundle/index.js';
import { buildMarkdownBundle } from './bundle/index.js';
import { DiskCacheStore } from './cache/index.js';
import { createHttpClient, getIssue } from './client/index.js';
import type { CoreEvent, ExtractionResult, ProgressEvent, Result } from './contract.js';
import { extractIssueAttachments } from './extract-issue-attachments.js';
import { createDefaultRegistry } from './extract/index.js';
import { normalizeIssue } from './normalize/index.js';

/** Formato de saída do bundle: Markdown (default) ou JSON canônico. */
export type BundleFormat = 'md' | 'json';

/** Opções de {@link fetchIssueBundle}: credenciais já resolvidas + formato. */
export interface FetchIssueBundleOptions {
  /** URL base da instância Redmine (ex.: `https://redmine.example`). */
  baseUrl: string;
  /** api_key já resolvida pela cascata da superfície. */
  apiKey: string;
  /** Identificador da issue a empacotar. */
  issueId: number;
  /** Formato de saída. Default (na superfície): `md`. */
  format: BundleFormat;
  /** Versão da ferramenta gravada no bundle. */
  toolVersion: string;
  /** Permite `http://` (sem TLS) com aviso ruidoso. Default: `false`. */
  insecure?: boolean;
  /**
   * Extrai o texto dos anexos de imagem e o embute no bundle (M3-10). Default:
   * `false` no M3 — as superfícies (CLI/MCP) ligam a flag na #55. Requer o
   * binário `tesseract`; ausente, o anexo apenas registra `failed` com a dica de
   * instalação (o bundle sai mesmo assim — degradação graciosa, ADR-002).
   */
  extractAttachments?: boolean;
  /**
   * Raiz do cache em disco para downloads/extrações (M3-10). Default do
   * {@link DiskCacheStore}. Só usado quando `extractAttachments` é `true`.
   */
  cacheDir?: string;
}

/** Resultado final: conteúdo serializado pronto para stdout/arquivo. */
export interface IssueBundleResult {
  /** Id da issue empacotada (compõe o nome do arquivo em `--out`). */
  issueId: number;
  /** Formato efetivo do conteúdo. */
  format: BundleFormat;
  /** Bundle serializado (Markdown ou JSON canônico). */
  content: string;
}

/** Helper: constrói um evento de progresso tipado. */
function progress(stage: string, message: string): ProgressEvent {
  return { kind: 'progress', stage, message };
}

/**
 * Busca, normaliza e empacota uma issue, emitindo progresso incremental.
 *
 * @param options - Ver {@link FetchIssueBundleOptions}.
 * @returns Sequência de {@link ProgressEvent} terminada por um {@link Result}
 *   com o {@link IssueBundleResult}.
 * @throws {RedmineAuthError} Em 401 (propagado do client).
 * @throws {RedmineNotFoundError} Em 404 — issue inexistente.
 * @throws {RedmineHttpError} Em outros status ≥ 400.
 * @throws {Error} Em falha de rede/TLS/JSON inválido.
 * @example
 * for await (const event of fetchIssueBundle(opts)) {
 *   if (event.kind === 'result') process.stdout.write(event.value.content);
 * }
 */
export async function* fetchIssueBundle(
  options: FetchIssueBundleOptions,
): AsyncIterable<CoreEvent<IssueBundleResult>> {
  const { baseUrl, apiKey, issueId, format, toolVersion, insecure = false, extractAttachments = false } = options;

  yield progress('connect', `Conectando a ${baseUrl}`);
  const http = createHttpClient({ baseUrl, apiKey, insecure });

  yield progress('fetch', `Buscando issue #${issueId}`);
  const payload = await getIssue(http, issueId);

  yield progress('normalize', 'Normalizando issue');
  const issue = normalizeIssue(payload);

  let extractions: Map<number, ExtractionResult> | undefined;
  if (extractAttachments) {
    yield progress('extract', 'Extraindo texto dos anexos');
    const registry = await createDefaultRegistry();
    const store = new DiskCacheStore<ExtractionResult>(
      options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {},
    );
    extractions = await extractIssueAttachments(http, issue, {
      instanceUrl: baseUrl,
      registry,
      store,
      ...(options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {}),
    });
  }

  yield progress('bundle', `Empacotando bundle (${format})`);
  const meta = { baseUrl, toolVersion, ...(extractions !== undefined ? { extractions } : {}) };
  const content =
    format === 'json' ? buildJsonBundle(issue, meta).canonical : buildMarkdownBundle(issue, meta);

  const result: Result<IssueBundleResult> = {
    kind: 'result',
    value: { issueId, format, content },
  };
  yield result;
}
