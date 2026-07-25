/**
 * Localização e versão do binário `ffmpeg` (M4-01, #57, ADR-002).
 *
 * O `doctor` (#57) usa estas funções para reportar a presença do ffmpeg — que a
 * milestone M4 usará para extrair a faixa de áudio + 1 keyframe de vídeos (ADR-002)
 * — sem reimplementar a detecção em cada superfície. Segue o padrão de
 * {@link findTesseract}: PATH + locais convencionais (incl. `/opt/homebrew/bin`),
 * puro e injetável, degradando graciosamente quando ausente.
 */

import { execFile } from 'node:child_process';

import { findExecutable, type ConventionalDirs } from './which.js';

/** Nome base do binário do ffmpeg. */
const FFMPEG_BINARY = 'ffmpeg';

/**
 * Locais convencionais do `ffmpeg` por família de SO, consultados após o `PATH`.
 * No Windows não há caminho canônico (builds estáticos BtbN são descompactados
 * em qualquer lugar) — cobrimos os destinos mais comuns como best-effort.
 */
const CONVENTIONAL: ConventionalDirs = {
  unix: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'],
  windows: ['C:\\ffmpeg\\bin', 'C:\\Program Files\\ffmpeg\\bin'],
};

/** Graça de timeout ao ler a versão do ffmpeg (ms) — a chamada é instantânea. */
const VERSION_TIMEOUT_MS = 2_000;

/** Resultado de {@link findFfmpeg}: caminho absoluto do binário localizado. */
export interface FfmpegLocation {
  /** Caminho absoluto do executável `ffmpeg` encontrado. */
  readonly path: string;
}

/**
 * Localiza o binário `ffmpeg` no `PATH` e em locais convencionais por plataforma.
 * Função pura e reutilizável pelo `doctor` (#57). Não executa o binário.
 *
 * @param deps - Deps injetáveis (plataforma/PATH/executabilidade) — ver
 *   {@link findExecutable}. Default: ambiente real.
 * @returns A localização encontrada, ou `undefined` se não instalado.
 * @example
 * const found = findFfmpeg();
 * if (found === undefined) logger.warn('ffmpeg não instalado');
 */
export function findFfmpeg(deps?: Parameters<typeof findExecutable>[2]): FfmpegLocation | undefined {
  const located = findExecutable([FFMPEG_BINARY], CONVENTIONAL, deps);
  return located !== undefined ? { path: located.path } : undefined;
}

/**
 * Monta o env MÍNIMO do subprocesso: só `PATH`. Nenhum segredo do pai (ex.:
 * `REDMINE_API_KEY`) vaza para o ffmpeg (ADR-002).
 *
 * @returns Env sanitizado para o subprocesso.
 */
function sanitizedEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin' };
}

/**
 * Lê a versão do binário via `ffmpeg -version` (primeira linha:
 * `ffmpeg version X.Y.Z ...` — em builds distro pode vir `n6.1.1` ou hash git;
 * capturamos o primeiro token após `version`). Não lança: retorna `undefined`
 * se o binário falhar ou a saída for inesperada.
 *
 * @param bin - Caminho absoluto do binário.
 * @returns A versão detectada (ex.: `6.1.1`), ou `undefined`.
 */
export function detectFfmpegVersion(bin: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    execFile(
      bin,
      ['-version'],
      { env: sanitizedEnv(), encoding: 'utf8', windowsHide: true, timeout: VERSION_TIMEOUT_MS },
      (error, stdout) => {
        if (error !== null) {
          resolve(undefined);
          return;
        }
        // Reason: 1ª linha "ffmpeg version <token> ..."; o token pode ser semver
        // puro, prefixado (`n6.1`) ou um hash — reportamos o token cru como veio.
        const match = /ffmpeg version (\S+)/i.exec(stdout);
        resolve(match?.[1]);
      },
    );
  });
}
