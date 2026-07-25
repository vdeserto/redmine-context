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

export {
  findExecutable,
  isExecutable,
  type ConventionalDirs,
  type ExecutableLocation,
  type FindExecutableDeps,
} from './which.js';

export { detectFfmpegVersion, findFfmpeg, type FfmpegLocation } from './ffmpeg.js';

export { findWhisper, whisperModelDir, type WhisperLocation } from './whisper.js';

export {
  downloadGgufModel,
  defaultGgufDeps,
  GgufDownloadError,
  GGUF_MODEL_NAME,
  GGUF_MODEL_URL,
  GGUF_MODEL_SHA256,
  type DownloadGgufOptions,
  type GgufDeps,
  type GgufDownloadFailure,
} from './gguf.js';