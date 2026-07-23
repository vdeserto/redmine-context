/**
 * Mapeamento de status de extração de anexo para a apresentação na TUI (#32).
 *
 * MIGRAÇÃO (M3-08): desde a #50, `src/contract.ts` — a fronteira única que as
 * superfícies consomem do core (ADR-005) — PASSA a exportar o vocabulário
 * canônico {@link ExtractionStatus} do pipeline de extração real. Este módulo
 * foi então REALINHADO: {@link AttachmentExtractionStatus} agora é um ALIAS do
 * tipo do contrato (não mais uma união local paralela), de modo que a TUI e o
 * core compartilham exatamente os mesmos estados — incluindo o novo `skipped`
 * (anexo pulado por exceder o limite de tamanho, ADR-002).
 *
 * O que AINDA é TUI-only e provisório é apenas a HEURÍSTICA
 * {@link deriveAttachmentExtractionStatus}: enquanto a fila de jobs de extração
 * não roda ligada à TUI, o status exibido é derivado só de
 * `Attachment.content_type` (apresentação, sem extração de fato). Quando o core
 * passar a entregar o `ExtractionResult` pronto por anexo (M3/M4), esta derivação
 * deixa de existir e o status vem direto do `ExtractionResult['status']`;
 * `attachmentStatusColor`/`attachmentStatusLabel` já operam sobre o tipo do
 * contrato e permanecem.
 *
 * Valores que {@link deriveAttachmentExtractionStatus} produz HOJE:
 * - `text` — anexo textual (content_type `text/*`), referenciado como texto-only.
 * - `pending` — ainda não é possível classificar (ex.: `content_type` ausente
 *   no payload do Redmine) — aguarda uma análise futura, não é erro.
 * - `unsupported` — anexo binário conhecido (imagem/PDF/áudio/vídeo) para o
 *   qual não há extrator disponível na TUI ainda.
 *
 * Valores restantes do vocabulário (produzidos pelo core real em M3/M4; o
 * layout de badge já os suporta): `processing` (extração em andamento), `done`
 * (texto extraído com sucesso), `failed` (extração falhou) e `skipped` (pulado
 * deliberadamente, ex.: limite de tamanho).
 */
import type { Attachment, ExtractionStatus } from '../../index.js';
import type { Theme } from './theme.js';

/**
 * Vocabulário de status de extração consumido pela TUI — ALIAS de
 * {@link ExtractionStatus} do contrato (ADR-005), garantindo alinhamento total
 * entre a apresentação e o core. Ver o JSDoc do módulo para a migração.
 */
export type AttachmentExtractionStatus = ExtractionStatus;

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
    case 'skipped':
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
    case 'skipped':
      return 'pulado';
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
}
