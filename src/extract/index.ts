export const MODULE_NAME = 'extract' as const;

export {
  downloadAttachment,
  isSkipped,
  safeExtension,
  type DownloadAttachmentOptions,
  type DownloadResult,
  type SkippedDownload,
} from './download.js';
