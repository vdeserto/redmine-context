/**
 * Testes do mapeamento local de status de extração de anexo (#32).
 *
 * `src/contract.ts` ainda não expõe um `ExtractionResult['status']` (M3/M4
 * trarão a extração real do core) — este módulo documenta e testa o
 * mapeamento provisório usado pela TUI no M2: deriva o status a partir de
 * `Attachment.content_type` (heurística puramente de apresentação, sem
 * nenhuma extração de fato) e mapeia status → cor do tema / rótulo textual.
 * Escrito ANTES da implementação (TDD).
 */
import { describe, expect, it } from 'vitest';

import {
  attachmentStatusColor,
  attachmentStatusLabel,
  deriveAttachmentExtractionStatus,
} from '../../../src/surfaces/tui/attachment-status.js';
import { DEFAULT_THEME } from '../../../src/surfaces/tui/theme.js';

describe('TUI: deriveAttachmentExtractionStatus', () => {
  it('content_type text/* → "text" (referenciado, texto-only)', () => {
    expect(deriveAttachmentExtractionStatus({ content_type: 'text/plain' })).toBe('text');
    expect(deriveAttachmentExtractionStatus({ content_type: 'text/markdown' })).toBe('text');
  });

  it('content_type ausente → "pending" (aguardando análise/extração futura)', () => {
    expect(deriveAttachmentExtractionStatus({ content_type: undefined })).toBe('pending');
  });

  it('tipos EXTRAÍVEIS (imagem/pdf/áudio/vídeo/OOXML/zip/octet-stream) → "pending" (#190)', () => {
    // Há extrator para todos: imagem (tesseract), pdf (pdftotext), áudio/vídeo
    // (whisper+ffmpeg), OOXML (docx/xlsx/pptx). O texto sai com `--extract`.
    for (const contentType of [
      'image/png',
      'image/jpeg',
      'application/pdf',
      'audio/mpeg',
      'video/mp4',
      'application/zip', // docx/xlsx/pptx são zip; o magic decide
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream', // genérico do Redmine → o magic decide
    ]) {
      expect(deriveAttachmentExtractionStatus({ content_type: contentType }), contentType).toBe(
        'pending',
      );
    }
  });

  it('tipos SEM extrator → "unsupported" (Office binário antigo, executáveis)', () => {
    expect(deriveAttachmentExtractionStatus({ content_type: 'application/msword' })).toBe(
      'unsupported',
    );
    expect(deriveAttachmentExtractionStatus({ content_type: 'application/x-msdownload' })).toBe(
      'unsupported',
    );
  });
});

describe('TUI: attachmentStatusLabel', () => {
  it('rotula os estados possíveis no M2', () => {
    expect(attachmentStatusLabel('text')).toBe('texto');
    expect(attachmentStatusLabel('pending')).toBe('pendente');
    expect(attachmentStatusLabel('unsupported')).toBe('não suportado');
  });

  it('rotula também os estados reservados para M3/M4 (layout já pronto)', () => {
    expect(attachmentStatusLabel('processing')).toBe('processando');
    expect(attachmentStatusLabel('done')).toBe('concluído');
    expect(attachmentStatusLabel('failed')).toBe('falhou');
  });

  it('rotula o estado "cancelled" (cancelamento via AbortSignal, #69)', () => {
    expect(attachmentStatusLabel('cancelled')).toBe('cancelado');
  });
});

describe('TUI: attachmentStatusColor', () => {
  it('mapeia cada estado a um token do tema (nunca cor literal)', () => {
    expect(attachmentStatusColor(DEFAULT_THEME, 'pending')).toBe(DEFAULT_THEME.muted);
    expect(attachmentStatusColor(DEFAULT_THEME, 'text')).toBe(DEFAULT_THEME.primary);
    expect(attachmentStatusColor(DEFAULT_THEME, 'unsupported')).toBe(DEFAULT_THEME.warning);
  });

  it('reserva success/danger para done/failed (M3/M4) e muted para processing', () => {
    expect(attachmentStatusColor(DEFAULT_THEME, 'done')).toBe(DEFAULT_THEME.success);
    expect(attachmentStatusColor(DEFAULT_THEME, 'failed')).toBe(DEFAULT_THEME.danger);
    expect(attachmentStatusColor(DEFAULT_THEME, 'processing')).toBe(DEFAULT_THEME.muted);
  });

  it('mapeia "cancelled" para muted (terminal neutro, #69)', () => {
    expect(attachmentStatusColor(DEFAULT_THEME, 'cancelled')).toBe(DEFAULT_THEME.muted);
  });
});
