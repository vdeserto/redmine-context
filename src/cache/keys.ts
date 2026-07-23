/**
 * Builder de alto nível da chave attachment-level (M3-03, ADR-004).
 *
 * Monta a {@link AttachmentCacheKey} correta a partir do modelo `Attachment` do
 * contrato ({@link Attachment}) mais a configuração do extrator
 * ({@link ExtractorConfig}), escondendo das camadas superiores dois detalhes:
 *
 * 1. o cálculo do `instance_hash` a partir da URL da instância
 *    ({@link instanceHash}); e
 * 2. a origem do `digest` — usa `attachment.digest` quando presente e, como
 *    FALLBACK para Redmine < 4.x (que não expõe `digest`), deriva um digest
 *    DETERMINÍSTICO de `(id, filesize, created_on)`.
 *
 * A chave attachment-level NÃO depende de `updated_on` da issue: o builder sequer
 * o recebe. Assim, editar a issue (novo `updated_on`, comentários) invalida só a
 * camada de issue e reaproveita 100% das extrações caras dos anexos imutáveis.
 *
 * Sanitização hex "por construção": o digest de fallback é o SHA-256 hex do
 * material derivado — 64 chars `[0-9a-f]`. Ele satisfaz o padrão hex que o
 * {@link DiskCacheStore} usa ao montar `<id>-<digest8>/`, atravessando o caminho
 * hex direto (sem o re-hash de escape reservado a valores não-hex/maliciosos).
 */

import { createHash } from 'node:crypto';

import type { Attachment } from '../contract.js';

import { instanceHash, type AttachmentCacheKey, type ExtractorParams } from './contract.js';

/**
 * Separador NUL entre os campos do material de derivação do digest de fallback.
 * ` ` (NUL) nunca ocorre em inteiros nem em timestamps ISO, evitando que a
 * concatenação de campos vizinhos colida (ex.: `(1, 23)` vs `(12, 3)`).
 */
const FALLBACK_FIELD_SEPARATOR = '\0';

/**
 * Configuração do extrator que participa da identidade da extração (ADR-004).
 * Trocar qualquer campo invalida corretamente a entrada de cache do anexo.
 */
export interface ExtractorConfig {
  /** Versão do extrator (mapeada para `extractorVersion` na chave). */
  version: string;
  /** Modelo usado (ex.: `whisper-large-v3`). */
  model: string;
  /** Parâmetros escalares do extrator — ver {@link ExtractorParams}. */
  params: ExtractorParams;
}

/** Entrada de {@link buildAttachmentKey}. */
export interface BuildAttachmentKeyInput {
  /** URL base da instância Redmine — vira `instanceHash` na chave. */
  instanceUrl: string;
  /** Anexo do contrato; `digest` pode faltar em Redmine < 4.x. */
  attachment: Attachment;
  /** Configuração do extrator — ver {@link ExtractorConfig}. */
  extractor: ExtractorConfig;
}

/**
 * Deriva um digest DETERMINÍSTICO de um anexo sem `digest` (fallback Redmine
 * < 4.x): SHA-256 hex de `(id, filesize, created_on)` separados por NUL.
 *
 * O resultado é hex puro (64 chars), estável entre execuções e distinto sempre
 * que qualquer um dos três campos muda — servindo como identidade de conteúdo
 * "boa o suficiente" quando o hash real do anexo não está disponível.
 *
 * @param attachment - Anexo do contrato.
 * @returns Digest hex (SHA-256, 64 chars).
 * @example
 * deriveAttachmentDigest({ id: 7, filesize: 12345, created_on: '2026-07-20T00:00:00Z', ... });
 */
export function deriveAttachmentDigest(attachment: Attachment): string {
  const material = [attachment.id, attachment.filesize, attachment.created_on].join(
    FALLBACK_FIELD_SEPARATOR,
  );
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Monta a {@link AttachmentCacheKey} de um anexo para uma configuração de
 * extrator (ADR-004). Usa `attachment.digest` quando presente; caso ausente
 * (`undefined` ou `""`, típico de Redmine < 4.x), cai no fallback determinístico
 * de {@link deriveAttachmentDigest}.
 *
 * @param input - Ver {@link BuildAttachmentKeyInput}.
 * @returns Chave attachment-level pronta para o {@link CacheStore}.
 * @throws {TypeError} Se `instanceUrl` não for uma URL válida (via {@link instanceHash}).
 * @example
 * const key = buildAttachmentKey({
 *   instanceUrl: 'https://redmine.example',
 *   attachment,
 *   extractor: { version: '1.0.0', model: 'whisper-large-v3', params: { language: 'pt' } },
 * });
 */
export function buildAttachmentKey({
  instanceUrl,
  attachment,
  extractor,
}: BuildAttachmentKeyInput): AttachmentCacheKey {
  // Presente = definido e não-vazio; qualquer outra forma cai no fallback.
  const digest =
    attachment.digest !== undefined && attachment.digest !== ''
      ? attachment.digest
      : deriveAttachmentDigest(attachment);

  return {
    kind: 'attachment',
    instanceHash: instanceHash(instanceUrl),
    attachmentId: attachment.id,
    digest,
    extractorVersion: extractor.version,
    model: extractor.model,
    params: extractor.params,
  };
}
