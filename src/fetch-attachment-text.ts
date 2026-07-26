/**
 * Orquestração get → normalize → extração de UM anexo (M3-13, ADR-002/ADR-005).
 *
 * Função fina do core que a superfície MCP (#55) reutiliza pela tool read-only
 * `get_attachment_text`: recebe credenciais já resolvidas + `issueId`/`attachmentId`
 * e devolve o {@link ExtractionResult} do anexo pedido, passando pelo MESMO
 * pipeline com cache de {@link extractIssueAttachments} (`getOrCompute` garante o
 * cache-hit quando o texto já foi extraído — a #55 não re-baixa nem re-roda o OCR).
 *
 * Só o anexo pedido entra no pipeline (a issue é filtrada a um único anexo), então
 * o download/extração caro roda no máximo uma vez por chamada. Mantém a fronteira
 * do ADR-005: encapsula `client`, `normalize`, `extract` e `cache`.
 */

import {
  extractIssueAttachmentsCacheFirst,
  makeQueueBackgroundExtractor,
  processingResult,
  type BackgroundExtractor,
} from './cache-first.js';
import { DiskCacheStore, type CacheStore } from './cache/index.js';
import { createHttpClient, getIssue, type Logger } from './client/index.js';
import type { ExtractionResult, Issue } from './contract.js';
import { extractIssueAttachments } from './extract-issue-attachments.js';
import { createDefaultRegistry, type ExtractorRegistry } from './extract/index.js';
import { normalizeIssue } from './normalize/index.js';

/**
 * Erro tipado: o anexo pedido não existe na issue (após o fetch bem-sucedido da
 * issue). Distinto de um 404 do Redmine (que é a issue inexistente) — as
 * superfícies o mapeiam para uma mensagem clara, sem cache indevido.
 */
export class AttachmentNotFoundError extends Error {
  /** Id da issue consultada. */
  readonly issueId: number;
  /** Id do anexo ausente. */
  readonly attachmentId: number;

  /**
   * @param issueId - Id da issue consultada.
   * @param attachmentId - Id do anexo que não foi encontrado.
   */
  constructor(issueId: number, attachmentId: number) {
    super(`Anexo #${attachmentId} não encontrado na issue #${issueId}.`);
    this.name = 'AttachmentNotFoundError';
    this.issueId = issueId;
    this.attachmentId = attachmentId;
  }
}

/** Opções de {@link fetchAttachmentText}: credenciais resolvidas + alvos. */
export interface FetchAttachmentTextOptions {
  /** URL base da instância Redmine (ex.: `https://redmine.example`). */
  baseUrl: string;
  /** api_key já resolvida pela cascata da superfície. */
  apiKey: string;
  /** Identificador da issue que contém o anexo. */
  issueId: number;
  /** Identificador do anexo cujo texto será extraído. */
  attachmentId: number;
  /** Permite `http://` (sem TLS) com aviso ruidoso. Default: `false`. */
  insecure?: boolean;
  /** Raiz do cache em disco para downloads/extrações. Default do {@link DiskCacheStore}. */
  cacheDir?: string;
}

/** Resultado de {@link fetchAttachmentText}: o anexo + sua extração. */
export interface AttachmentTextResult {
  /** Id do anexo processado. */
  attachmentId: number;
  /** Resultado da extração (status + texto/metadata) — ver {@link ExtractionResult}. */
  extraction: ExtractionResult;
}

/** Extração `unsupported` para anexo cujo MIME não tem extrator local registrado. */
function unsupportedResult(): ExtractionResult {
  return {
    status: 'unsupported',
    metadata: {
      reason: 'sem-extrator-registrado',
      hint: 'nenhum extrator local suporta o tipo deste anexo (o OCR cobre apenas imagens)',
    },
  };
}

/**
 * Busca a issue, isola o anexo pedido e extrai seu texto pelo pipeline com cache.
 *
 * @param options - Ver {@link FetchAttachmentTextOptions}.
 * @returns O {@link AttachmentTextResult} do anexo (texto quando `done`/`text`;
 *   caso contrário `skipped`/`unsupported`/`failed` com motivo/dica).
 * @throws {RedmineAuthError} Em 401 (propagado do client).
 * @throws {RedmineForbiddenError} Em 403 — sem permissão para a issue.
 * @throws {RedmineNotFoundError} Em 404 — issue inexistente.
 * @throws {AttachmentNotFoundError} Quando o anexo não existe na issue.
 * @example
 * const { extraction } = await fetchAttachmentText({
 *   baseUrl, apiKey, issueId: 42, attachmentId: 77,
 * });
 */
export async function fetchAttachmentText(
  options: FetchAttachmentTextOptions,
): Promise<AttachmentTextResult> {
  const { baseUrl, apiKey, issueId, attachmentId, insecure = false, cacheDir } = options;

  const http = createHttpClient({ baseUrl, apiKey, insecure });
  const payload = await getIssue(http, issueId);
  const issue = normalizeIssue(payload);

  const attachment = issue.attachments.find((a) => a.id === attachmentId);
  if (attachment === undefined) {
    throw new AttachmentNotFoundError(issueId, attachmentId);
  }

  const registry = await createDefaultRegistry();
  const store = new DiskCacheStore<ExtractionResult>(cacheDir !== undefined ? { cacheDir } : {});

  // Filtra a issue a UM anexo: o pipeline pré-filtra por extrator e só baixa/roda
  // o extrator caro do anexo pedido. `getOrCompute` serve do cache num re-hit.
  const single: Issue = { ...issue, attachments: [attachment] };
  const map = await extractIssueAttachments(http, single, {
    instanceUrl: baseUrl,
    registry,
    store,
    ...(cacheDir !== undefined ? { cacheDir } : {}),
  });

  // Ausente no mapa = nenhum extrator para o MIME provável → unsupported legível.
  const extraction = map.get(attachmentId) ?? unsupportedResult();
  return { attachmentId, extraction };
}

/**
 * Opções de {@link fetchAttachmentTextCacheFirst}: as de {@link fetchAttachmentText}
 * mais seams INJETÁVEIS (registry/store/background/logger) com defaults reais —
 * usados pelos testes para simular a extração lenta de forma determinística, sem
 * tocar a rede/disco/subprocesso reais.
 */
export interface FetchAttachmentTextCacheFirstOptions extends FetchAttachmentTextOptions {
  /** Registry de extratores; default: {@link createDefaultRegistry}. */
  registry?: ExtractorRegistry;
  /** Store attachment-level; default: {@link DiskCacheStore} sobre `cacheDir`. */
  store?: CacheStore<ExtractionResult>;
  /**
   * Dispatcher do job em background (#71); default: fila (`runQueue`) que roda a
   * extração real detached. Injetável para provar o não-bloqueio (< 5s) sem esperar.
   */
  background?: BackgroundExtractor;
  /** Logger para avisos; default no-op. Nunca `console.*`. */
  logger?: Logger;
}

/**
 * Variante CACHE-FIRST e NÃO-BLOQUEANTE de {@link fetchAttachmentText} (M4-11, #70).
 *
 * Busca a issue (rápido), isola o anexo pedido e LÊ o cache: se a extração já está
 * pronta, devolve o texto IMEDIATAMENTE; se ainda não (anexo pesado), devolve
 * `processing` na hora — SEM aguardar a extração — e dispara o job em segundo
 * plano pela fila (fire-and-forget, forward-compatible com a continuação #71).
 * Nenhuma chamada bloqueia aguardando mídia.
 *
 * @param options - Ver {@link FetchAttachmentTextCacheFirstOptions}.
 * @returns O {@link AttachmentTextResult} do anexo (texto pronto, `processing` ou
 *   `unsupported`), sempre sem bloquear na extração cara.
 * @throws {RedmineAuthError} Em 401 (propagado do client).
 * @throws {RedmineForbiddenError} Em 403 — sem permissão para a issue.
 * @throws {RedmineNotFoundError} Em 404 — issue inexistente.
 * @throws {AttachmentNotFoundError} Quando o anexo não existe na issue.
 * @example
 * const { extraction } = await fetchAttachmentTextCacheFirst({
 *   baseUrl, apiKey, issueId: 42, attachmentId: 77,
 * });
 */
export async function fetchAttachmentTextCacheFirst(
  options: FetchAttachmentTextCacheFirstOptions,
): Promise<AttachmentTextResult> {
  const { baseUrl, apiKey, issueId, attachmentId, insecure = false, cacheDir, logger } = options;

  const http = createHttpClient({ baseUrl, apiKey, insecure });
  const payload = await getIssue(http, issueId);
  const issue = normalizeIssue(payload);

  const attachment = issue.attachments.find((a) => a.id === attachmentId);
  if (attachment === undefined) {
    throw new AttachmentNotFoundError(issueId, attachmentId);
  }

  const registry = options.registry ?? (await createDefaultRegistry());
  const store =
    options.store ?? new DiskCacheStore<ExtractionResult>(cacheDir !== undefined ? { cacheDir } : {});
  const single: Issue = { ...issue, attachments: [attachment] };

  // Default: a extração cara roda em background pela fila; o compute reusa o
  // pipeline testado `extractIssueAttachments` (mesma chave/store → o resultado
  // fica pronto para a 2ª chamada, #71). Injetável nos testes por determinismo.
  const background =
    options.background ??
    makeQueueBackgroundExtractor(
      async (): Promise<ExtractionResult> => {
        const computed = await extractIssueAttachments(http, single, {
          instanceUrl: baseUrl,
          registry,
          store,
          ...(cacheDir !== undefined ? { cacheDir } : {}),
          ...(logger !== undefined ? { logger } : {}),
        });
        return computed.get(attachmentId) ?? processingResult();
      },
      // Passa o `store` para o dispatcher PERSISTIR o resultado de fechamento
      // (done/failed) sob a mesma chave lida no cache-first (#71): a 2ª chamada
      // acerta o cache e uma falha vira `failed` — nunca `processing` eterno.
      { store, ...(logger !== undefined ? { logger } : {}) },
    );

  const map = await extractIssueAttachmentsCacheFirst(single, {
    instanceUrl: baseUrl,
    registry,
    store,
    background,
    ...(logger !== undefined ? { logger } : {}),
  });

  // Ausente no mapa = nenhum extrator para o MIME provável → unsupported legível.
  const extraction = map.get(attachmentId) ?? unsupportedResult();
  return { attachmentId, extraction };
}
