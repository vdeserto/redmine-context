/**
 * Diagnóstico dos binários de mídia (M3-11, #53, ADR-002).
 *
 * O núcleo do comando `doctor`: detecta a presença dos binários externos que a
 * extração local de mídia precisa (hoje o `tesseract` do OCR; ffmpeg/whisper.cpp
 * entram nas próximas milestones) e, quando ausentes, devolve uma instrução de
 * instalação ADEQUADA AO SO — `brew` (darwin), `apt`/`dnf` (linux) e
 * `winget install UB-Mannheim.TesseractOCR` (win32).
 *
 * DECISÕES (todas exercitadas por testes):
 * - PLATAFORMA INJETÁVEL: o hint depende de `platform`, injetável para testar os
 *   três SOs num único host — o default é `process.platform`.
 * - REUSO DA DETECÇÃO DO EXTRATOR: a localização (`findTesseract`) e a leitura de
 *   versão (`detectTesseractVersion`) do extrator (ADR-002) são reutilizadas, não
 *   reimplementadas — também injetáveis para manter os testes hermeticamente
 *   isolados do filesystem/binário reais.
 * - DEGRADAÇÃO GRACIOSA: nunca lança; um binário ausente é um estado NORMAL
 *   (`found: false`) reportado com a dica — o `doctor` é justamente o que orienta
 *   o usuário a instalar (ADR-002).
 */

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

/** Diagnóstico de um binário externo consultado pelo `doctor`. */
export interface BinaryDiagnosis {
  /** Nome do binário (ex.: `tesseract`). */
  readonly name: string;
  /** `true` se localizado no PATH ou em local convencional do SO. */
  readonly found: boolean;
  /** Caminho absoluto do executável, quando encontrado. */
  readonly path?: string;
  /** Versão detectada (ex.: `5.5.0`), quando encontrada e legível. */
  readonly version?: string;
  /** Instrução de instalação adequada ao SO — sempre presente. */
  readonly installHint: string;
}

/** Dependências injetáveis de {@link diagnoseBinaries} — todas com defaults de produção. */
export interface DiagnoseBinariesOptions {
  /** SO usado para escolher o hint de instalação; default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Localiza o binário `tesseract`; default {@link defaultFindTesseract}. */
  readonly findTesseract?: () => TesseractLocation | undefined;
  /** Lê a versão do `tesseract`; default {@link defaultDetectTesseractVersion}. */
  readonly detectTesseractVersion?: (bin: string) => Promise<string | undefined>;
  /** Localiza o binário `pdftotext`; default {@link defaultFindPdftotext}. */
  readonly findPdftotext?: () => PdftotextLocation | undefined;
  /** Lê a versão do `pdftotext`; default {@link defaultDetectPdftotextVersion}. */
  readonly detectPdftotextVersion?: (bin: string) => Promise<string | undefined>;
}

/** Path convencional do tesseract no Windows citado no hint (ADR-002). */
const WINDOWS_CONVENTIONAL_PATH = 'C:\\Program Files\\Tesseract-OCR';

/**
 * Instrução de instalação do `tesseract` para um SO. Pura e injetável — cada
 * plataforma gera uma dica testável isoladamente (ADR-002).
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
}
