/**
 * Localização de executáveis no PATH + locais convencionais por SO (M4-01, #57,
 * ADR-002).
 *
 * Generaliza o padrão de {@link findTesseract} (busca `tesseract` no PATH e em
 * `/opt/homebrew/bin` etc.) para os demais binários de mídia da milestone M4
 * (`ffmpeg`, `whisper.cpp`), que aceitam MÚLTIPLOS nomes de binário — o
 * whisper.cpp mudou de `main` (legado) para `whisper-cli` (atual) e o brew
 * empacota como `whisper-cpp`. Decisões (exercitadas por testes):
 *
 * - PURO E INJETÁVEL: `platform`, `PATH` e o predicado de executabilidade são
 *   injetáveis — os três SOs e os estados presente/ausente são testáveis num
 *   único host, sem tocar filesystem/binário reais.
 * - PRIORIDADE POR NOME: os nomes candidatos são tentados NA ORDEM dada (o loop
 *   externo é o nome), e dentro de cada nome o `PATH` vem antes dos locais
 *   convencionais — assim `whisper-cli` é preferido a `main` mesmo que ambos
 *   existam, e reportamos QUAL foi encontrado ({@link ExecutableLocation.binaryName}).
 * - SUFIXO `.exe` NO WINDOWS: aplicado a todos os candidatos automaticamente.
 */

import { accessSync, constants } from 'node:fs';
import { posix, win32 } from 'node:path';

/** Diretórios convencionais de um binário, separados por família de SO. */
export interface ConventionalDirs {
  /** Locais convencionais em UNIX (darwin/linux), consultados após o `PATH`. */
  readonly unix: readonly string[];
  /** Locais convencionais no Windows, consultados após o `PATH`. */
  readonly windows: readonly string[];
}

/** Resultado de {@link findExecutable}: caminho absoluto + qual nome casou. */
export interface ExecutableLocation {
  /** Caminho absoluto do executável encontrado. */
  readonly path: string;
  /** Nome base do binário que casou (ex.: `whisper-cli`), sem sufixo `.exe`. */
  readonly binaryName: string;
}

/** Dependências injetáveis de {@link findExecutable} — defaults de produção. */
export interface FindExecutableDeps {
  /** SO alvo; default `process.platform`. Decide `.exe` e os locais convencionais. */
  readonly platform?: NodeJS.Platform;
  /** Valor do `PATH`; default `process.env.PATH`. */
  readonly pathValue?: string | undefined;
  /** Predicado de executabilidade; default {@link isExecutable}. */
  readonly isExecutable?: (candidate: string) => boolean;
}

/**
 * Verifica se um caminho aponta para um arquivo executável (bit X), sem lançar.
 *
 * @param candidate - Caminho absoluto candidato ao binário.
 * @returns `true` se o arquivo existe e é executável pelo processo atual.
 */
export function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Localiza o PRIMEIRO executável de {@link baseNames} no `PATH` e nos locais
 * convencionais do SO. Função pura e reutilizável pelo `doctor` (#57); não
 * executa o binário. A ordem de {@link baseNames} é a prioridade (nome externo,
 * PATH antes dos convencionais dentro de cada nome).
 *
 * @param baseNames - Nomes candidatos, em ordem de preferência (sem `.exe`).
 * @param conventional - Locais convencionais por família de SO.
 * @param deps - Deps injetáveis (plataforma, PATH, executabilidade).
 * @returns A localização encontrada (path + nome que casou), ou `undefined`.
 * @example
 * findExecutable(['whisper-cli', 'main'], { unix: ['/opt/homebrew/bin'], windows: [] });
 */
export function findExecutable(
  baseNames: readonly string[],
  conventional: ConventionalDirs,
  deps: FindExecutableDeps = {},
): ExecutableLocation | undefined {
  const platform = deps.platform ?? process.platform;
  const isWindows = platform === 'win32';
  const executable = deps.isExecutable ?? isExecutable;
  const pathValue = deps.pathValue ?? process.env.PATH ?? '';

  // Reason: `platform` é injetável (testar os 3 SOs num host só) — o join/split do
  // PATH DEVE seguir o SO alvo, não o host, senão os separadores divergem.
  const path = isWindows ? win32 : posix;
  const pathDirs = pathValue.split(path.delimiter).filter((dir) => dir.length > 0);
  const dirs = [...pathDirs, ...(isWindows ? conventional.windows : conventional.unix)];
  const suffix = isWindows ? '.exe' : '';

  // Reason: prioridade por NOME (loop externo) — um `whisper-cli` no PATH ganha
  // de um `main` convencional, e é o nome reportado ao usuário.
  for (const name of baseNames) {
    for (const dir of dirs) {
      const candidate = path.join(dir, `${name}${suffix}`);
      if (executable(candidate)) {
        return { path: candidate, binaryName: name };
      }
    }
  }
  return undefined;
}
