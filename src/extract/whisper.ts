/**
 * Localização do binário whisper.cpp e diretório canônico do modelo GGUF
 * (M4-01, #57, ADR-002).
 *
 * A milestone M4 transcreve áudio localmente com whisper.cpp (ADR-002). O binário
 * teve VÁRIOS nomes ao longo do tempo — hoje é `whisper-cli`; o brew empacota como
 * `whisper-cpp`; o legado era simplesmente `main`. O `doctor` (#57) detecta
 * QUALQUER um e reporta o caminho encontrado (que revela qual binário é).
 *
 * DECISÕES (exercitadas por testes):
 * - SEM FLAG DE VERSÃO ESTÁVEL: diferente de ffmpeg/tesseract, o whisper.cpp não
 *   tem um `--version` estável entre releases — o PATH resolvido é a evidência de
 *   presença; o `doctor` não reporta versão para ele (documentado no diagnóstico).
 * - MODELO SEPARADO DO BINÁRIO: o binário e o modelo `.gguf` são artefatos
 *   independentes; {@link whisperModelDir} define AGORA o path canônico do cache
 *   de modelos (`env-paths` cache + `/models`) que a #58 (download do modelo)
 *   consumirá — um único ponto de verdade para ambas as issues.
 */

import { join } from 'node:path';

import envPaths from 'env-paths';

import { findExecutable, type ConventionalDirs } from './which.js';

/** Nome da aplicação para `env-paths` — em sincronia com o cache de anexos (ADR-004). */
const APP_NAME = 'redmine-context';

/** Subdiretório do cache que guarda os modelos GGUF do whisper.cpp. */
const MODELS_SUBDIR = 'models';

/**
 * Nomes candidatos do binário whisper.cpp, EM ORDEM DE PREFERÊNCIA: o atual
 * (`whisper-cli`), o empacotado pelo brew (`whisper-cpp`) e o legado (`main`).
 *
 * `main` é um nome genérico e é o ÚLTIMO da lista de propósito — só casa um
 * executável exatamente chamado `main` no PATH/locais convencionais, e apenas
 * quando nenhum nome mais específico existe (ADR-002; caveat de supply chain).
 */
const WHISPER_BINARIES = ['whisper-cli', 'whisper-cpp', 'main'] as const;

/** Locais convencionais do whisper.cpp por família de SO, após o `PATH`. */
const CONVENTIONAL: ConventionalDirs = {
  unix: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'],
  windows: ['C:\\whisper\\bin', 'C:\\Program Files\\whisper\\bin'],
};

/** Resultado de {@link findWhisper}: caminho + qual binário casou. */
export interface WhisperLocation {
  /** Caminho absoluto do executável encontrado. */
  readonly path: string;
  /** Nome do binário que casou (`whisper-cli` | `whisper-cpp` | `main`). */
  readonly binaryName: string;
}

/**
 * Localiza o binário do whisper.cpp no `PATH` e em locais convencionais,
 * preferindo `whisper-cli` a `whisper-cpp` a `main`. Puro e reutilizável pelo
 * `doctor` (#57). Não executa o binário.
 *
 * @param deps - Deps injetáveis (plataforma/PATH/executabilidade) — ver
 *   {@link findExecutable}. Default: ambiente real.
 * @returns A localização encontrada (path + nome), ou `undefined` se ausente.
 * @example
 * const found = findWhisper();
 * if (found !== undefined) logger.info(`whisper.cpp: ${found.binaryName}`);
 */
export function findWhisper(deps?: Parameters<typeof findExecutable>[2]): WhisperLocation | undefined {
  return findExecutable(WHISPER_BINARIES, CONVENTIONAL, deps);
}

/**
 * Diretório canônico do cache de modelos GGUF do whisper.cpp — `env-paths` cache
 * do usuário (por SO) + `/models`. PONTO ÚNICO DE VERDADE compartilhado entre o
 * `doctor` (#57, status do modelo) e o download do modelo (#58).
 *
 * @returns Caminho absoluto do diretório de modelos (ex.:
 *   `~/Library/Caches/redmine-context/models` no macOS).
 * @example
 * const dir = whisperModelDir();
 */
export function whisperModelDir(): string {
  return join(envPaths(APP_NAME).cache, MODELS_SUBDIR);
}
