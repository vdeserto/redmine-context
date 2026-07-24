/**
 * Diagnóstico dos binários de mídia (M3-11 #53, M4-01 #57, ADR-002).
 *
 * O núcleo do comando `doctor`: detecta a presença dos binários externos que a
 * extração local de mídia precisa (`tesseract` do OCR, `ffmpeg` do vídeo,
 * `whisper.cpp` da transcrição) e, quando ausentes, devolve uma instrução de
 * instalação ADEQUADA AO SO. Também reporta o status do modelo GGUF do
 * whisper.cpp no cache esperado.
 *
 * DECISÕES (todas exercitadas por testes):
 * - PLATAFORMA INJETÁVEL: cada hint depende de `platform`, injetável para testar
 *   os três SOs num único host — o default é `process.platform`.
 * - REUSO DA DETECÇÃO DOS EXTRATORES: localização e leitura de versão
 *   (`findTesseract`/`findFfmpeg`/`findWhisper` + `detect*Version`) vêm dos
 *   módulos de extração (ADR-002) — não reimplementadas, e injetáveis para manter
 *   os testes isolados do filesystem/binário reais.
 * - DEGRADAÇÃO GRACIOSA: nunca lança; um binário ou modelo ausente é um estado
 *   NORMAL (`found: false`) reportado com a dica — o `doctor` é justamente o que
 *   orienta o usuário a instalar (ADR-002).
 * - OPT-IN `--download-binaries` SÓ ONDE HÁ ARTEFATO OFICIAL: ffmpeg (BtbN) e
 *   whisper.cpp (releases) mencionam o download automático futuro; tesseract
 *   (sem artefato estático) só instrui a instalação por SO (ADR-002).
 * - MODELO É UMA ENTRADA DO DIAGNÓSTICO: o status do GGUF entra na MESMA lista
 *   de {@link BinaryDiagnosis} que as superfícies (CLI/TUI) já iteram — nova
 *   entrada exibida SEM mudança de código nelas.
 */

import { readdirSync } from 'node:fs';

import {
  detectFfmpegVersion as defaultDetectFfmpegVersion,
  findFfmpeg as defaultFindFfmpeg,
  type FfmpegLocation,
} from '../extract/ffmpeg.js';
import {
  detectPdftotextVersion as defaultDetectPdftotextVersion,
  findPdftotext as defaultFindPdftotext,
  type PdftotextLocation,
} from '../extract/pdf.js';
import {
  detectTesseractVersion as defaultDetectTesseractVersion,
  findTesseract as defaultFindTesseract,
  type TesseractLocation,
} from '../extract/tesseract.js';
import {
  findWhisper as defaultFindWhisper,
  whisperModelDir as defaultWhisperModelDir,
  type WhisperLocation,
} from '../extract/whisper.js';

/** Diagnóstico de um item externo (binário ou modelo) consultado pelo `doctor`. */
export interface BinaryDiagnosis {
  /** Nome do item diagnosticado (ex.: `tesseract`, `ffmpeg`, `modelo whisper (GGUF)`). */
  readonly name: string;
  /** `true` se localizado (binário no PATH/local convencional, ou modelo no cache). */
  readonly found: boolean;
  /** Caminho absoluto do executável ou do artefato, quando encontrado. */
  readonly path?: string;
  /** Versão detectada (ex.: `5.5.0`), quando encontrada e legível. */
  readonly version?: string;
  /** Instrução de instalação/obtenção adequada ao SO — sempre presente. */
  readonly installHint: string;
}

/** Dependências injetáveis de {@link diagnoseBinaries} — todas com defaults de produção. */
export interface DiagnoseBinariesOptions {
  /** SO usado para escolher os hints de instalação; default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Localiza o binário `tesseract`; default {@link defaultFindTesseract}. */
  readonly findTesseract?: () => TesseractLocation | undefined;
  /** Lê a versão do `tesseract`; default {@link defaultDetectTesseractVersion}. */
  readonly detectTesseractVersion?: (bin: string) => Promise<string | undefined>;
  /** Localiza o binário `pdftotext`; default {@link defaultFindPdftotext}. */
  readonly findPdftotext?: () => PdftotextLocation | undefined;
  /** Lê a versão do `pdftotext`; default {@link defaultDetectPdftotextVersion}. */
  readonly detectPdftotextVersion?: (bin: string) => Promise<string | undefined>;
  /** Localiza o binário `ffmpeg`; default {@link defaultFindFfmpeg}. */
  readonly findFfmpeg?: () => FfmpegLocation | undefined;
  /** Lê a versão do `ffmpeg`; default {@link defaultDetectFfmpegVersion}. */
  readonly detectFfmpegVersion?: (bin: string) => Promise<string | undefined>;
  /** Localiza o binário do whisper.cpp; default {@link defaultFindWhisper}. */
  readonly findWhisper?: () => WhisperLocation | undefined;
  /** Diretório canônico dos modelos GGUF; default {@link defaultWhisperModelDir}. */
  readonly whisperModelDir?: () => string;
  /** Lista os arquivos de um diretório (para achar o `.gguf`); default `readdirSync`. */
  readonly listDir?: (dir: string) => readonly string[];}

/** Path convencional do tesseract no Windows citado no hint (ADR-002). */
const WINDOWS_CONVENTIONAL_PATH = 'C:\\Program Files\\Tesseract-OCR';

/** Menção padronizada ao opt-in de download automático (ADR-002; o download é a #58+). */
const DOWNLOAD_OPT_IN = 'ou, no futuro, o opt-in `--download-binaries`';

/**
 * Instrução de instalação do `tesseract` para um SO. Pura e injetável — cada
 * plataforma gera uma dica testável isoladamente (ADR-002). SEM menção a
 * `--download-binaries`: o tesseract não tem artefato estático oficial.
 *
 * @param platform - Plataforma alvo (`process.platform`).
 * @returns Comando/instrução de instalação adequado ao SO.
 * @example
 * tesseractInstallHint('darwin'); // 'brew install tesseract tesseract-lang'
 */
export function tesseractInstallHint(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      // tesseract-lang traz o traineddata de 'por' (o default do projeto é por+eng).
      return 'brew install tesseract tesseract-lang';
    case 'win32':
      return `winget install UB-Mannheim.TesseractOCR (ou instale em ${WINDOWS_CONVENTIONAL_PATH})`;
    default:
      // Reason: Linux e demais UNIX — as duas famílias de gerenciador mais comuns.
      return 'sudo apt install tesseract-ocr  (ou: sudo dnf install tesseract)';
  }
}

/**
 * Instrução de instalação do `pdftotext` (poppler) para um SO. Pura e injetável —
 * cada plataforma gera uma dica testável isoladamente (ADR-002).
 *
 * @param platform - Plataforma alvo (`process.platform`).
 * @returns Comando/instrução de instalação adequado ao SO.
 * @example
 * pdftotextInstallHint('darwin'); // 'brew install poppler'
 */
export function pdftotextInstallHint(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return 'brew install poppler';
    case 'win32':
      // Reason: os builds Windows do poppler vêm do repackage oschwartz10612 —
      // disponível tanto no winget quanto no chocolatey.
      return 'winget install oschwartz10612.Poppler (ou: choco install poppler)';
    default:
      // Reason: Linux e demais UNIX — as duas famílias de gerenciador mais comuns.
      return 'sudo apt install poppler-utils  (ou: sudo dnf install poppler-utils)';
  }
}

/**
 * Diagnostica UM binário externo: localiza-o (PATH + locais convencionais), lê a
 * versão quando presente e sempre anexa a instrução de instalação do SO. Sem
 * injetar `version: undefined` (respeita `exactOptionalPropertyTypes`).
 *
 * @param spec - Nome, localizador, leitor de versão e hint do binário.
 * @returns O {@link BinaryDiagnosis} correspondente.
 */
async function diagnoseOne(spec: {
  readonly name: string;
  readonly locate: () => { path: string } | undefined;
  readonly detectVersion: (bin: string) => Promise<string | undefined>;
  readonly installHint: string;
}): Promise<BinaryDiagnosis> {
  const located = spec.locate();
  if (located === undefined) {
    return { name: spec.name, found: false, installHint: spec.installHint };
  }
  const version = await spec.detectVersion(located.path);
  const base: BinaryDiagnosis = {
    name: spec.name,
    found: true,
    path: located.path,
    installHint: spec.installHint,
  };
  return version !== undefined ? { ...base, version } : base;
}

/**
 * Diagnostica os binários de mídia que a extração local precisa: `tesseract`
 * (OCR) e `pdftotext` (poppler, PDF→texto). Localiza cada um (PATH + locais
 * convencionais), lê a versão quando presente e sempre anexa a instrução de
 * instalação do SO.
 *
 * @param options - Deps injetáveis (plataforma, localização, versão). Ver
 *   {@link DiagnoseBinariesOptions}.
 * @returns Uma lista de {@link BinaryDiagnosis} (tesseract, pdftotext).
 * @example
 * const [tesseract, pdftotext] = await diagnoseBinaries();
 * if (!pdftotext.found) logger.warn(pdftotext.installHint);
 */
export async function diagnoseBinaries(options: DiagnoseBinariesOptions = {}): Promise<BinaryDiagnosis[]> {
  const platform = options.platform ?? process.platform;

  return Promise.all([
    diagnoseOne({
      name: 'tesseract',
      locate: options.findTesseract ?? defaultFindTesseract,
      detectVersion: options.detectTesseractVersion ?? defaultDetectTesseractVersion,
      installHint: tesseractInstallHint(platform),
    }),
    diagnoseOne({
      name: 'pdftotext',
      locate: options.findPdftotext ?? defaultFindPdftotext,
      detectVersion: options.detectPdftotextVersion ?? defaultDetectPdftotextVersion,
      installHint: pdftotextInstallHint(platform),
    }),
  ]);
 * Instrução de instalação do `ffmpeg` por SO, COM menção ao opt-in
 * `--download-binaries` e às builds estáticas BtbN (artefato oficial; ADR-002).
 *
 * @param platform - Plataforma alvo (`process.platform`).
 * @returns Instrução de instalação/obtenção adequada ao SO.
 * @example
 * ffmpegInstallHint('darwin'); // 'brew install ffmpeg ...'
 */
export function ffmpegInstallHint(platform: NodeJS.Platform): string {
  const btbn = 'builds estáticos BtbN (github.com/BtbN/FFmpeg-Builds)';
  switch (platform) {
    case 'darwin':
      return `brew install ffmpeg (${DOWNLOAD_OPT_IN}; ${btbn})`;
    case 'win32':
      return `winget install Gyan.FFmpeg (${DOWNLOAD_OPT_IN}; ${btbn})`;
    default:
      return `sudo apt install ffmpeg  (ou: sudo dnf install ffmpeg; ${DOWNLOAD_OPT_IN}; ${btbn})`;
  }
}

/**
 * Instrução de instalação do whisper.cpp por SO, COM menção ao opt-in
 * `--download-binaries` e às releases do GitHub (artefato oficial; ADR-002).
 *
 * @param platform - Plataforma alvo (`process.platform`).
 * @returns Instrução de instalação/obtenção adequada ao SO.
 * @example
 * whisperInstallHint('darwin'); // 'brew install whisper-cpp ...'
 */
export function whisperInstallHint(platform: NodeJS.Platform): string {
  const releases = 'releases em github.com/ggml-org/whisper.cpp/releases';
  switch (platform) {
    case 'darwin':
      return `brew install whisper-cpp (${DOWNLOAD_OPT_IN}; ${releases})`;
    case 'win32':
      return `baixe as ${releases} (${DOWNLOAD_OPT_IN})`;
    default:
      return `brew install whisper-cpp ou compile o whisper.cpp (${DOWNLOAD_OPT_IN}; ${releases})`;
  }
}

/** Extensão dos modelos do whisper.cpp no cache. */
const GGUF_EXTENSION = '.gguf';

/**
 * Monta um {@link BinaryDiagnosis} sem injetar chaves `undefined` (respeita
 * `exactOptionalPropertyTypes`): `path`/`version` só entram quando presentes.
 *
 * @param name - Nome do item diagnosticado.
 * @param installHint - Instrução de instalação/obtenção.
 * @param found - Caminho/versão quando encontrado; `undefined` = ausente.
 * @returns O diagnóstico tipado.
 */
function makeDiagnosis(
  name: string,
  installHint: string,
  found: { path: string; version?: string | undefined } | undefined,
): BinaryDiagnosis {
  if (found === undefined) {
    return { name, found: false, installHint };
  }
  const base: BinaryDiagnosis = { name, found: true, path: found.path, installHint };
  return found.version !== undefined ? { ...base, version: found.version } : base;
}

/**
 * Diagnostica o `tesseract`: localiza-o, lê a versão quando presente e anexa a
 * instrução de instalação do SO.
 *
 * @param platform - SO para o hint.
 * @param find - Localizador do binário.
 * @param detectVersion - Leitor de versão.
 * @returns O diagnóstico do tesseract.
 */
async function diagnoseTesseract(
  platform: NodeJS.Platform,
  find: () => TesseractLocation | undefined,
  detectVersion: (bin: string) => Promise<string | undefined>,
): Promise<BinaryDiagnosis> {
  const installHint = tesseractInstallHint(platform);
  const located = find();
  if (located === undefined) {
    return makeDiagnosis('tesseract', installHint, undefined);
  }
  const version = await detectVersion(located.path);
  return makeDiagnosis('tesseract', installHint, { path: located.path, version });
}

/**
 * Diagnostica o `ffmpeg`: localiza-o, lê a versão (1ª linha de `ffmpeg -version`)
 * quando presente e anexa a instrução por SO (com opt-in/BtbN).
 *
 * @param platform - SO para o hint.
 * @param find - Localizador do binário.
 * @param detectVersion - Leitor de versão.
 * @returns O diagnóstico do ffmpeg.
 */
async function diagnoseFfmpeg(
  platform: NodeJS.Platform,
  find: () => FfmpegLocation | undefined,
  detectVersion: (bin: string) => Promise<string | undefined>,
): Promise<BinaryDiagnosis> {
  const installHint = ffmpegInstallHint(platform);
  const located = find();
  if (located === undefined) {
    return makeDiagnosis('ffmpeg', installHint, undefined);
  }
  const version = await detectVersion(located.path);
  return makeDiagnosis('ffmpeg', installHint, { path: located.path, version });
}

/**
 * Diagnostica o `whisper.cpp`: localiza QUALQUER binário conhecido (`whisper-cli`
 * / `whisper-cpp` / `main`) e reporta o caminho encontrado (que revela qual).
 * Sem versão: o whisper.cpp não tem `--version` estável — o path é a evidência.
 *
 * @param platform - SO para o hint.
 * @param find - Localizador do binário.
 * @returns O diagnóstico do whisper.cpp (sempre sem `version`).
 */
function diagnoseWhisper(
  platform: NodeJS.Platform,
  find: () => WhisperLocation | undefined,
): BinaryDiagnosis {
  const installHint = whisperInstallHint(platform);
  const located = find();
  if (located === undefined) {
    return makeDiagnosis('whisper.cpp', installHint, undefined);
  }
  // Reason: sem versão legível — o path (que inclui `whisper-cli`/`main`) é a
  // evidência da presença e de QUAL binário está instalado (ADR-002).
  return makeDiagnosis('whisper.cpp', installHint, { path: located.path });
}

/**
 * Diagnostica o modelo GGUF do whisper.cpp: verifica se há ao menos um `.gguf`
 * no diretório de cache canônico ({@link defaultWhisperModelDir}). Nunca lança:
 * diretório inexistente/ilegível conta como ausente (degradação graciosa).
 *
 * @param modelDir - Diretório canônico dos modelos.
 * @param listDir - Lista os arquivos do diretório.
 * @returns O diagnóstico do modelo (path = arquivo GGUF quando presente).
 */
function diagnoseWhisperModel(
  modelDir: string,
  listDir: (dir: string) => readonly string[],
): BinaryDiagnosis {
  const hint = `baixe um modelo GGUF (ex.: ggml-base) para ${modelDir} (${DOWNLOAD_OPT_IN}, via #58)`;
  let gguf: string | undefined;
  try {
    gguf = listDir(modelDir).find((file) => file.toLowerCase().endsWith(GGUF_EXTENSION));
  } catch {
    // Reason: diretório ainda não criado (setup fresco) ou ilegível — ausente.
    gguf = undefined;
  }
  if (gguf === undefined) {
    return makeDiagnosis('modelo whisper (GGUF)', hint, undefined);
  }
  return makeDiagnosis('modelo whisper (GGUF)', hint, { path: `${modelDir}/${gguf}` });
}

/**
 * Diagnostica os binários e o modelo de mídia: `tesseract`, `ffmpeg`,
 * `whisper.cpp` e o modelo GGUF. Cada um localizado (PATH + locais convencionais
 * / cache), com versão quando legível, sempre com a instrução de instalação do
 * SO. A ordem é estável (a mesma exibida por CLI/TUI).
 *
 * @param options - Deps injetáveis (plataforma, localizadores, versões, modelo).
 *   Ver {@link DiagnoseBinariesOptions}.
 * @returns A lista de {@link BinaryDiagnosis} na ordem
 *   `[tesseract, ffmpeg, whisper.cpp, modelo]`.
 * @example
 * for (const item of await diagnoseBinaries()) {
 *   if (!item.found) logger.warn(item.installHint);
 * }
 */
export async function diagnoseBinaries(options: DiagnoseBinariesOptions = {}): Promise<BinaryDiagnosis[]> {
  const platform = options.platform ?? process.platform;
  const findTesseract = options.findTesseract ?? defaultFindTesseract;
  const detectTesseractVersion = options.detectTesseractVersion ?? defaultDetectTesseractVersion;
  const findFfmpeg = options.findFfmpeg ?? defaultFindFfmpeg;
  const detectFfmpegVersion = options.detectFfmpegVersion ?? defaultDetectFfmpegVersion;
  const findWhisper = options.findWhisper ?? defaultFindWhisper;
  const modelDir = (options.whisperModelDir ?? defaultWhisperModelDir)();
  const listDir = options.listDir ?? ((dir: string): readonly string[] => readdirSync(dir));

  return [
    await diagnoseTesseract(platform, findTesseract, detectTesseractVersion),
    await diagnoseFfmpeg(platform, findFfmpeg, detectFfmpegVersion),
    diagnoseWhisper(platform, findWhisper),
    diagnoseWhisperModel(modelDir, listDir),
  ];}
