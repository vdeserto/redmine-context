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
  defaultConcurrency,
  runQueue,
  type JobContext,
  type QueueEvent,
  type QueueJob,
  type QueueJobStatus,
  type RunQueueOptions,
} from './queue.js';

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

export {
  runWithWatchdog,
  sanitizedEnv,
  SubprocessTimeoutError,
  type ExecFileLike,
  type SanitizedEnvOptions,
  type WatchdogChild,
  type WatchdogDeps,
  type WatchdogInvocation,
} from './subprocess.js';

export {
  detectFfmpegVersion,
  findFfmpeg,
  findFfprobe,
  type FfmpegLocation,
  type FfprobeLocation,
} from './ffmpeg.js';

export {
  audioTempDir,
  convertAudioToWav,
  type ConvertAudioToWavOptions,
  type FfmpegInvocation,
  type FfmpegRunner,
  type WavConversionFailure,
  type WavConversionResult,
  type WavConversionSuccess,
} from './audio.js';

export { findWhisper, whisperModelDir, type WhisperLocation } from './whisper.js';

export {
  createWhisperExtractor,
  parseWhisperOutput,
  WhisperExtractor,
  WHISPER_MIMES,
  type CreateWhisperExtractorOptions,
  type WhisperExtractorOptions,
  type WhisperInvocation,
  type WhisperRunner,
} from './whisper-extract.js';

export {
  AudioExtractor,
  AUDIO_MIMES,
  createAudioExtractor,
  type AudioExtractorOptions,
} from './audio-extractor.js';

export {
  createVideoExtractor,
  VideoExtractor,
  type VideoExtractorOptions,
  type VideoPipelineOverrides,
} from './video-extractor.js';

export { createOoxmlExtractor, OoxmlExtractor, OOXML_MIMES } from './ooxml.js';

export { parseZip, type ZipArchive, type ZipEntry } from './zip.js';

export {
  convertVideoToWav,
  extractVideoKeyframe,
  extractVideoTranscript,
  parseFfprobeDuration,
  probeVideoDuration,
  VIDEO_MIMES,
  type DurationProbeOk,
  type DurationProbeResult,
  type DurationProbeUnavailable,
  type ExtractKeyframeOptions,
  type ExtractVideoTranscriptOptions,
  type FfprobeInvocation,
  type FfprobeRunner,
  type KeyframeFailure,
  type KeyframeResult,
  type KeyframeSuccess,
  type ProbeVideoDurationOptions,
} from './video.js';

export {
  downloadGgufModel,
  defaultGgufDeps,
  GgufDownloadError,
  GGUF_MODEL_NAME,
  GGUF_MODEL_URL,
  GGUF_MODEL_SHA256,
  type DownloadGgufOptions,
  type GgufDeps,
  type GgufFetchInit,
  type GgufDownloadFailure,
} from './gguf.js';
