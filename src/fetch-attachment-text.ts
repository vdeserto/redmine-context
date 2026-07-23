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

import { DiskCacheStore } from './cache/index.js';
import { createHttpClient, getIssue } from './client/index.js';
import type { ExtractionResult, Issue } from './contract.js';
import { extractIssueAttachments } from './extract-issue-attachments.js';
import { createDefaultRegistry } from './extract/index.js';
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
