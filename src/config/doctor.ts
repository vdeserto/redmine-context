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
 * Diagnostica o binário `tesseract`: localiza-o (PATH + locais convencionais),
 * lê a versão quando presente e sempre anexa a instrução de instalação do SO.
 *
 * @param options - Deps injetáveis (plataforma, localização, versão). Ver
 *   {@link DiagnoseBinariesOptions}.
 * @returns Uma lista de {@link BinaryDiagnosis} (hoje só o tesseract).
 * @example
 * const [tesseract] = await diagnoseBinaries();
 * if (!tesseract.found) logger.warn(tesseract.installHint);
 */
export async function diagnoseBinaries(options: DiagnoseBinariesOptions = {}): Promise<BinaryDiagnosis[]> {
  const platform = options.platform ?? process.platform;
  const find = options.findTesseract ?? defaultFindTesseract;
  const detectVersion = options.detectTesseractVersion ?? defaultDetectTesseractVersion;

  const installHint = tesseractInstallHint(platform);
  const located = find();
  if (located === undefined) {
    return [{ name: 'tesseract', found: false, installHint }];
  }

  const version = await detectVersion(located.path);
  // Reason: `exactOptionalPropertyTypes` proíbe injetar `version: undefined` —
  // a chave só entra quando a versão foi de fato lida.
  const base: BinaryDiagnosis = { name: 'tesseract', found: true, path: located.path, installHint };
  return [version !== undefined ? { ...base, version } : base];
}
