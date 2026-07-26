/**
 * Leitura CACHE-FIRST não-bloqueante das extrações de anexos (M4-11, ADR-004).
 *
 * O núcleo do modo cache-first do MCP (#70): dado uma issue JÁ normalizada, para
 * cada anexo com extrator registrado LÊ o cache attachment-level e devolve
 * IMEDIATAMENTE o que já está pronto (`done`/`text`). Quando a extração de um
 * anexo pesado (vídeo/áudio) ainda NÃO está no cache, NÃO espera a extração
 * terminar: marca o anexo como {@link ExtractionStatus} `processing` com
 * metadados e, opcionalmente, dispara o job de extração em SEGUNDO PLANO via a
 * fila (`runQueue`, #67) — fire-and-forget. Assim nenhuma chamada MCP bloqueia
 * aguardando mídia (resposta imediata; a continuação que completa na 2ª chamada
 * é a #71).
 *
 * A leitura de cache (índice/`extraction.json`) é barata (ms); só a COMPUTAÇÃO da
 * extração é cara — e é justamente ela que este módulo evita no caminho síncrono.
 * A chave attachment-level é montada EXATAMENTE como no caminho bloqueante
 * ({@link extractIssueAttachments}) — mesmos `probableMime`/`toExtractorConfig` —
 * garantindo cache-hit coerente com o que o job de background grava.
 *
 * Fronteira ADR-005: módulo de core (pipeline de extração). Não importa de
 * `src/surfaces/**` e nunca usa `console.*` — avisos vão pelo {@link Logger}.
 */

import { buildAttachmentKey, type AttachmentCacheKey, type CacheStore } from './cache/index.js';
import type { Logger } from './client/index.js';
import type { Attachment, ExtractionResult, Issue } from './contract.js';
import { probableMime, toExtractorConfig } from './extract-issue-attachments.js';
import { runQueue, type Extractor, type ExtractorRegistry, type QueueEvent, type QueueJob } from './extract/index.js';

/** Extrai uma mensagem legível de um erro desconhecido. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Constrói um {@link ExtractionResult} `processing` — o anexo existe e TEM
 * extrator, mas a extração (cara) ainda não está no cache. Sinaliza à superfície
 * que o texto virá em uma consulta futura (#71), sem bloquear a atual.
 *
 * @returns Resultado `processing` com motivo/dica legíveis (sem texto).
 */
export function processingResult(): ExtractionResult {
  return {
    status: 'processing',
    metadata: {
      reason: 'extracao-em-andamento',
      hint: 'anexo ainda nao processado; a extracao roda em segundo plano — consulte novamente em instantes',
    },
  };
}

/** Alvo de uma extração pendente descoberta no caminho cache-first (cache-miss). */
export interface BackgroundExtractionTarget {
  /** Anexo cujo texto ainda não está no cache. */
  readonly attachment: Attachment;
  /** Extrator resolvido pelo MIME provável do anexo. */
  readonly extractor: Extractor;
  /** Chave attachment-level já montada (idêntica à do caminho bloqueante). */
  readonly key: AttachmentCacheKey;
}

/**
 * Dispatcher de extração em SEGUNDO PLANO (#70/#71). Recebe um anexo com
 * cache-miss e DEVE retornar imediatamente (fire-and-forget): jamais aguarda a
 * extração. Injetável para testes (um fake determinístico que não espera de fato).
 */
export type BackgroundExtractor = (target: BackgroundExtractionTarget) => void;

/** Opções de {@link extractIssueAttachmentsCacheFirst}. */
export interface CacheFirstExtractionOptions {
  /** URL base da instância — compõe o `instance_hash` da chave (ADR-004). */
  instanceUrl: string;
  /** Registry consultado para achar o extrator do MIME provável de cada anexo. */
  registry: ExtractorRegistry;
  /** Store de cache attachment-level (memória ou disco) — apenas LIDO aqui. */
  store: CacheStore<ExtractionResult>;
  /**
   * Dispatcher opcional do job em background (#71). Chamado UMA vez por anexo com
   * cache-miss. Ausente = apenas sinaliza `processing` (o #70 não exige disparar).
   */
  background?: BackgroundExtractor;
  /** Logger para avisos (ex.: falha ao ler o cache); default no-op. Nunca `console.*`. */
  logger?: Logger;
}

/**
 * Lê o cache das extrações de TODOS os anexos com extrator registrado de uma
 * issue, SEM computar nenhuma extração (não-bloqueante).
 *
 * Para cada anexo:
 * - sem extrator para o MIME provável → nem entra no mapa (igual ao bloqueante);
 * - cache-hit → o {@link ExtractionResult} pronto (texto imediato);
 * - cache-miss → `processing` + (opcional) dispara o job de background.
 *
 * @param issue - Issue normalizada cujos anexos serão consultados no cache.
 * @param options - Ver {@link CacheFirstExtractionOptions}.
 * @returns `Map<attachmentId, ExtractionResult>` só com anexos que têm extrator.
 * @example
 * const map = await extractIssueAttachmentsCacheFirst(issue, {
 *   instanceUrl, registry, store, background,
 * });
 */
export async function extractIssueAttachmentsCacheFirst(
  issue: Issue,
  options: CacheFirstExtractionOptions,
): Promise<Map<number, ExtractionResult>> {
  const { instanceUrl, registry, store, background, logger } = options;
  const result = new Map<number, ExtractionResult>();

  for (const attachment of issue.attachments) {
    const mime = probableMime(attachment);
    const extractor = mime !== undefined ? registry.find(mime) : undefined;
    if (extractor === undefined) {
      // Sem extrator: não há trabalho a fazer — não entra no mapa (paridade com
      // o caminho bloqueante `extractIssueAttachments`).
      continue;
    }

    const key = buildAttachmentKey({ instanceUrl, attachment, extractor: toExtractorConfig(extractor) });

    let cached: ExtractionResult | undefined;
    try {
      cached = await store.get(key);
    } catch (error) {
      // Falha de leitura de cache não bloqueia nem derruba: trata como miss.
      logger?.warn(`cache-first: falha ao ler o cache do anexo #${attachment.id}: ${messageOf(error)}`);
      cached = undefined;
    }

    if (cached !== undefined) {
      result.set(attachment.id, cached);
      continue;
    }

    // Cache-miss: NÃO espera a extração cara — sinaliza `processing` na hora e,
    // se um dispatcher foi injetado, enfileira o job em background (fire-and-forget).
    result.set(attachment.id, processingResult());
    background?.({ attachment, extractor, key });
  }

  return result;
}

/**
 * Computa a extração de UM anexo em background. Recebe o alvo do cache-miss e o
 * `AbortSignal` da fila (#69); deve resolver com o {@link ExtractionResult}
 * gravado no cache (ou reportar falha por rejeição, isolada pela fila).
 */
export type BackgroundCompute = (
  target: BackgroundExtractionTarget,
  signal: AbortSignal | undefined,
) => Promise<ExtractionResult>;

/** Opções de {@link makeQueueBackgroundExtractor}. */
export interface QueueBackgroundOptions {
  /** Logger para avisos de jobs que falharam/abortaram (ADR-005; sem `console.*`). */
  logger?: Logger;
  /** Sinal de cancelamento propagado à fila e aos jobs (#69). */
  signal?: AbortSignal;
}

/**
 * Consome, em segundo plano, as transições de uma fila de background — sem
 * bloquear o chamador. Falhas/cancelamentos viram avisos; nada é relançado.
 *
 * @param events - Sequência de transições de {@link runQueue}.
 * @param attachmentId - Id do anexo (para compor a mensagem de log).
 * @param logger - Sink de avisos; ausente = silencioso.
 */
async function drainDetached(
  events: AsyncIterable<QueueEvent<ExtractionResult>>,
  attachmentId: number,
  logger: Logger | undefined,
): Promise<void> {
  try {
    for await (const event of events) {
      if (event.status === 'failed') {
        logger?.warn(
          `cache-first: extracao em background do anexo #${attachmentId} falhou: ${event.reason ?? 'motivo desconhecido'}`,
        );
      }
    }
  } catch (error) {
    logger?.warn(`cache-first: fila de background do anexo #${attachmentId} abortou: ${messageOf(error)}`);
  }
}

/**
 * Cria um {@link BackgroundExtractor} respaldado pela fila de jobs (#67): cada
 * anexo com cache-miss vira UM {@link QueueJob} rodado por `runQueue`, cujas
 * transições são consumidas de forma DESACOPLADA (fire-and-forget). O dispatcher
 * retorna imediatamente — o trabalho caro acontece na fila, fora do caminho da
 * resposta MCP. O `AbortSignal` da fila é propagado ao `compute` via
 * {@link JobContext.signal} (#69), pronto para o kill de subprocesso do #68.
 *
 * @param compute - Executa a extração real do anexo — ver {@link BackgroundCompute}.
 * @param options - Logger e signal opcionais — ver {@link QueueBackgroundOptions}.
 * @returns Um dispatcher fire-and-forget para injetar em {@link CacheFirstExtractionOptions.background}.
 * @example
 * const background = makeQueueBackgroundExtractor(async (target) => {
 *   const map = await extractIssueAttachments(http, single, { store, registry, instanceUrl });
 *   return map.get(target.attachment.id) ?? processingResult();
 * });
 */
export function makeQueueBackgroundExtractor(
  compute: BackgroundCompute,
  options: QueueBackgroundOptions = {},
): BackgroundExtractor {
  const { logger, signal } = options;
  return (target: BackgroundExtractionTarget): void => {
    const job: QueueJob<ExtractionResult> = {
      id: `attachment:${target.attachment.id}`,
      run: (context) => compute(target, context.signal),
    };
    const queueOptions = {
      ...(logger !== undefined ? { logger } : {}),
      ...(signal !== undefined ? { signal } : {}),
    };
    // Fire-and-forget: consome as transições em segundo plano; NUNCA bloqueia
    // nem relança (a resposta MCP já voltou com `processing`).
    void drainDetached(runQueue([job], queueOptions), target.attachment.id, logger);
  };
}
