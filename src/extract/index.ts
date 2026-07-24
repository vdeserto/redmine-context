export const MODULE_NAME = 'extract' as const;

export {
  downloadAttachment,
  isSkipped,
  safeExtension,
  type DownloadAttachmentOptions,
  type DownloadResult,
  type SkippedDownload,
} from './download.js';

export {
  detectMime,
  detectMimeFromFile,
  mimeForExtension,
  MAGIC_SAMPLE_SIZE,
} from './magic.js';

export {
  dispatchExtraction,
  ExtractorRegistry,
  type DispatchOptions,
  type ExtractOptions,
  type Extractor,
} from './dispatcher.js';

export {
  createDefaultRegistry,
  createTesseractExtractor,
  detectTesseractVersion,
  findTesseract,
  TesseractExtractor,
  TESSERACT_MIMES,
  type TesseractExtractorOptions,
  type TesseractLocation,
} from './tesseract.js';

export {
  createPdfExtractor,
  detectPdftotextVersion,
  findPdftotext,
  PdfExtractor,
  PDF_MIMES,
  type PdfExtractorOptions,
  type PdftotextLocation,
} from './pdf.js';
