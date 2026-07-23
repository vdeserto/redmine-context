/**
 * Mapeamento local (TUI-only) de status de extração de anexo (#32).
 *
 * FRONTEIRA/BOUNDARY: `src/contract.ts` (o único módulo que as superfícies
 * consomem do core, ADR-005) ainda NÃO exporta um tipo `ExtractionResult`
 * nem `ExtractionResult['status']` — o pipeline de extração real só chega em
 * M3 (OCR/texto de imagem e PDF) e M4 (áudio/vídeo). Este arquivo existe
 * exatamente para não bloquear o M2 nisso: define o vocabulário provisório
 * que a TUI usa HOJE, derivado apenas de `Attachment.content_type` (heurística
 * de apresentação, sem nenhuma extração de fato acontecendo) e documenta a
 * migração esperada:
 *
 * Quando `src/contract.ts` passar a exportar `ExtractionResult['status']`
 * (M3/M4), este módulo deve ser substituído/realinhado para consumir o tipo
 * do contrato em vez desta união local — `deriveAttachmentExtractionStatus`
 * deixa de existir (o status passa a vir pronto do core) e
 * `attachmentStatusColor`/`attachmentStatusLabel` passam a receber o tipo
 * importado de `../../contract.js`.
 *
 * Vocabulário do M2 (únicos valores que {@link deriveAttachmentExtractionStatus}
 * produz hoje):
 * - `text` — anexo textual (content_type `text/*`), referenciado como texto-only.
 * - `pending` — ainda não é possível classificar (ex.: `content_type` ausente
 *   no payload do Redmine) — aguarda uma análise futura, não é erro.
 * - `unsupported` — anexo binário conhecido (imagem/PDF/áudio/vídeo) para o
 *   qual o M2 não tem NENHUM extrator — M3 endereça imagem/PDF (OCR), M4
 *   endereça áudio/vídeo.
 *
 * Reservados (o layout de badge já suporta, mas nada no M2 produz esses
 * valores — chegarão do core real em M3/M4):
 * - `processing` — extração em andamento (jobs assíncronos, M3/M4).
 * - `done` — texto extraído com sucesso e disponível.
 * - `failed` — extração tentada e falhou.
 */
import type { Attachment } from '../../index.js';
import type { Theme } from './theme.js';

/**
 * União do vocabulário de status de extração consumido pela TUI.
 * Ver o JSDoc do módulo para o que cada valor significa e a fronteira com o
 * core (M3/M4).
 */
export type AttachmentExtractionStatus =
  | 'text'
  | 'pending'
  | 'unsupported'
  | 'processing'
  | 'done'
  | 'failed';

/** Prefixo de `content_type` considerado texto puro (extraível sem OCR/ASR). */
const TEXT_CONTENT_TYPE_PREFIX = 'text/';

/**
 * Deriva o {@link AttachmentExtractionStatus} de um anexo no M2 — heurística
 * de apresentação baseada SOMENTE em `content_type`, sem nenhuma extração real
 * (ver o JSDoc do módulo). Só produz `text`/`pending`/`unsupported`; os demais
 * valores da união são reservados para quando o core (M3/M4) passar a
 * fornecer o status de verdade.
 *
 * @param attachment - Recorte do anexo com o único campo relevante aqui.
 * @returns O status derivado.
 * @example
 * deriveAttachmentExtractionStatus({ content_type: 'text/plain' }) // 'text'
 * deriveAttachmentExtractionStatus({ content_type: undefined })    // 'pending'
 * deriveAttachmentExtractionStatus({ content_type: 'image/png' })  // 'unsupported'
 */
export function deriveAttachmentExtractionStatus(
  attachment: Pick<Attachment, 'content_type'>,
): AttachmentExtractionStatus {
  const { content_type: contentType } = attachment;
  if (contentType === undefined) return 'pending';
  if (contentType.startsWith(TEXT_CONTENT_TYPE_PREFIX)) return 'text';
  return 'unsupported';
}

/**
 * Cor (token do tema) do badge de status — nunca uma cor literal (varredura
 * anti-hardcode, `tests/surfaces/tui/no-hardcoded-colors.test.ts`).
 *
 * Guideline fixado nesta issue: `muted` = pending/processing (neutro, nada
 * acionável ainda), `primary` = text (já disponível, identidade), `warning` =
 * unsupported (limitação atual, não é erro do usuário), `success`/`danger` =
 * reservados para done/failed (M3/M4) — nunca usados por
 * {@link deriveAttachmentExtractionStatus} hoje.
 *
 * @param theme - Tema ativo (via `useTheme()` no chamador).
 * @param status - Status de extração do anexo.
 * @returns O token de cor do tema.
 */
export function attachmentStatusColor(theme: Theme, status: AttachmentExtractionStatus): string {
  switch (status) {
    case 'text':
      return theme.primary;
    case 'unsupported':
      return theme.warning;
    case 'done':
      return theme.success;
    case 'failed':
      return theme.danger;
    case 'pending':
    case 'processing':
      return theme.muted;
    default: {
      // Exaustividade: se a união ganhar um novo membro sem atualizar este
      // switch, o typecheck falha aqui (nunca em runtime).
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
}

/**
 * Rótulo textual (pt-BR) do badge de status, exibido ao lado do nome/tamanho
 * do anexo.
 *
 * @param status - Status de extração do anexo.
 * @returns O rótulo a exibir dentro do badge (ex.: `[texto]`).
 */
export function attachmentStatusLabel(status: AttachmentExtractionStatus): string {
  switch (status) {
    case 'text':
      return 'texto';
    case 'pending':
      return 'pendente';
    case 'unsupported':
      return 'não suportado';
    case 'processing':
      return 'processando';
    case 'done':
      return 'concluído';
    case 'failed':
      return 'falhou';
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
}
