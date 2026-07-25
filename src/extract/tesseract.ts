/**
 * Extrator OCR via tesseract (M3-09, ADR-002).
 *
 * Roda o binário `tesseract` sobre uma imagem já baixada no cache e devolve o
 * texto reconhecido num {@link ExtractionResult}. Decisões de segurança/robustez
 * (ADR-002), todas exercitadas por testes:
 *
 * - INVOCAÇÃO SEM SHELL: usa `execFile` (nunca `exec`/shell) com uma lista de
 *   argumentos explícita — o `filePath` NUNCA é interpolado numa string de shell,
 *   eliminando injeção por nome de arquivo malicioso.
 * - ENV SANITIZADO: o subprocesso recebe um env MÍNIMO e EXPLÍCITO (só `PATH` e,
 *   se presente, `TESSDATA_PREFIX`) — segredos do processo pai (ex.:
 *   `REDMINE_API_KEY`) NUNCA vazam para o tesseract.
 * - TIMEOUT + KILL: um watchdog envia `SIGTERM` no timeout e, após um período de
 *   graça, `SIGKILL` — um tesseract travado não pendura a fila de jobs.
 * - DEGRADAÇÃO GRACIOSA: binário ausente do PATH/locais convencionais NÃO lança;
 *   devolve `{ status: 'failed', metadata.reason }` com dica de instalação (o
 *   `doctor` da #53 orienta o usuário).
 *
 * A chave de cache do anexo (ADR-004) depende de `version` + `model` + `params`
 * ({@link buildAttachmentKey}); por isso o extrator expõe {@link TesseractExtractor.version}
 * (derivada do binário quando detectável, senão a versão da integração) e
 * {@link TesseractExtractor.params} (inclui `lang`, que participa da identidade).
 */

import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

import type { ExtractorParams } from '../cache/contract.js';
import type { ExtractorConfig } from '../cache/keys.js';
import type { ExtractionResult } from '../contract.js';

import { ExtractorRegistry, type ExtractOptions, type Extractor } from './dispatcher.js';
import { createPdfExtractor } from './pdf.js';
import { createWhisperExtractor } from './whisper-extract.js';

/** Identificador estável do extrator (entra em metadados). */
const EXTRACTOR_ID = 'tesseract-ocr';

/** Modelo lógico para a chave de cache (ADR-004). OCR não versiona "modelo". */
const EXTRACTOR_MODEL = 'tesseract';

/**
 * Versão de FALLBACK da integração, usada quando o binário não é detectável (não
 * instalado) e portanto sua versão não pode ser lida. Mantém `version` estável e
 * não-vazia para {@link buildAttachmentKey}.
 */
const INTEGRATION_VERSION = 'tesseract-integration-1';

/** Idiomas default do OCR — português + inglês (ADR-002). Configurável. */
const DEFAULT_LANG = 'por+eng';

/** Page Segmentation Mode default (3 = automático, sem OSD) — o mais genérico. */
const DEFAULT_PSM = 3;

/** Timeout default de uma extração antes do `SIGTERM` (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Graça entre `SIGTERM` e `SIGKILL` (ms) — dá ao tesseract chance de sair limpo. */
const DEFAULT_KILL_GRACE_MS = 2_000;

/** Teto do stdout capturado (16 MiB) — OCR de páginas densas cabe com folga. */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/** MIMEs REAIS (magic bytes) que o tesseract aceita via leptonica. */
export const TESSERACT_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Locais convencionais do binário `tesseract`, por plataforma — consultados após
 * o `PATH`. Reutilizados pelo `doctor` (#53) via {@link findTesseract}.
 */
const CONVENTIONAL_UNIX = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'] as const;
const CONVENTIONAL_WINDOWS = ['C:\\Program Files\\Tesseract-OCR', 'C:\\Program Files (x86)\\Tesseract-OCR'] as const;

/** Resultado de {@link findTesseract}: caminho absoluto do binário localizado. */
export interface TesseractLocation {
  /** Caminho absoluto do executável `tesseract` encontrado. */
  readonly path: string;
}

/**
 * Verifica se um caminho aponta para um arquivo executável (bit X), sem lançar.
 *
 * @param candidate - Caminho absoluto candidato ao binário.
 * @returns `true` se o arquivo existe e é executável pelo processo atual.
 */
function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Localiza o binário `tesseract` no `PATH` e em locais convencionais por
 * plataforma (`/opt/homebrew/bin`, `/usr/local/bin`, `C:\\Program Files\\Tesseract-OCR`).
 * Função pura e reutilizável pelo `doctor` (#53). Não executa o binário.
 *
 * @returns A localização encontrada, ou `undefined` se não instalado.
 * @example
 * const found = findTesseract();
 * if (found === undefined) logger.warn('tesseract não instalado');
 */
export function findTesseract(): TesseractLocation | undefined {
  const isWindows = process.platform === 'win32';
  const exe = isWindows ? 'tesseract.exe' : 'tesseract';
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter((dir) => dir.length > 0);
  const conventional = isWindows ? CONVENTIONAL_WINDOWS : CONVENTIONAL_UNIX;

  for (const dir of [...pathDirs, ...conventional]) {
    const candidate = join(dir, exe);
    if (isExecutable(candidate)) {
      return { path: candidate };
    }
  }
  return undefined;
}

/**
 * Monta o env MÍNIMO e EXPLÍCITO do subprocesso (ADR-002). Só repassa `PATH` (o
 * tesseract pode invocar sub-ferramentas) e `TESSDATA_PREFIX` quando definido
 * (localização dos `traineddata`). NENHUM outro segredo do pai é herdado.
 *
 * @returns Env sanitizado para o subprocesso tesseract.
 */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
  if (process.env.TESSDATA_PREFIX !== undefined) {
    env.TESSDATA_PREFIX = process.env.TESSDATA_PREFIX;
  }
  return env;
}

/** Erro interno: o watchdog matou o tesseract por estourar o timeout. */
class TesseractTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`tesseract excedeu o timeout de ${timeoutMs}ms e foi encerrado`);
    this.name = 'TesseractTimeoutError';
  }
}

/** Parâmetros de uma execução isolada do binário. */
interface RunOptions {
  readonly bin: string;
  readonly filePath: string;
  readonly lang: string;
  readonly psm: number;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
}

/**
 * Executa `tesseract <file> stdout -l <lang> --psm <psm>` SEM shell, com env
 * sanitizado e watchdog de timeout (`SIGTERM` → graça → `SIGKILL`).
 *
 * @param options - Ver {@link RunOptions}.
 * @returns O stdout (texto OCR) do tesseract.
 * @throws {TesseractTimeoutError} Se estourar o timeout.
 * @throws {Error} Se o binário falhar (exit != 0, não encontrado em runtime, etc.).
 */
function runTesseract(options: RunOptions): Promise<string> {
  const { bin, filePath, lang, psm, timeoutMs, killGraceMs } = options;
  const args = [filePath, 'stdout', '-l', lang, '--psm', String(psm)];

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const timers: NodeJS.Timeout[] = [];

    const cleanup = (): void => {
      for (const timer of timers) clearTimeout(timer);
    };
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const child = execFile(
      bin,
      args,
      { env: sanitizedEnv(), encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES, windowsHide: true },
      (error, stdout) => {
        if (timedOut) {
          settle(() => reject(new TesseractTimeoutError(timeoutMs)));
          return;
        }
        if (error !== null) {
          settle(() => reject(error));
          return;
        }
        settle(() => resolve(stdout));
      },
    );

    timers.push(
      setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Reason: após a graça, força SIGKILL e desiste — um processo que ignora
        // SIGTERM não pode segurar a fila de jobs indefinidamente (ADR-002).
        timers.push(
          setTimeout(() => {
            child.kill('SIGKILL');
            settle(() => reject(new TesseractTimeoutError(timeoutMs)));
          }, killGraceMs),
        );
      }, timeoutMs),
    );
  });
}

/** Opções de construção do {@link TesseractExtractor}. */
export interface TesseractExtractorOptions {
  /**
   * Caminho absoluto do binário já resolvido. `undefined` = não instalado; nesse
   * caso {@link TesseractExtractor.extract} degrada para `failed` (não lança).
   */
  readonly binaryPath?: string | undefined;
  /** Versão exposta na chave de cache (ver {@link INTEGRATION_VERSION} como fallback). */
  readonly version: string;
  /** Idiomas do OCR; default {@link DEFAULT_LANG} (`por+eng`). */
  readonly lang?: string;
  /** Page Segmentation Mode; default {@link DEFAULT_PSM}. */
  readonly psm?: number;
  /** Timeout antes do `SIGTERM` (ms); default {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Graça `SIGTERM`→`SIGKILL` (ms); default {@link DEFAULT_KILL_GRACE_MS}. */
  readonly killGraceMs?: number;
}

/**
 * Extrator OCR baseado no binário `tesseract` (ADR-002). Implementa
 * {@link Extractor} e, além do contrato, expõe {@link params} e {@link extractorConfig}
 * estáveis para {@link buildAttachmentKey}.
 */
export class TesseractExtractor implements Extractor {
  readonly id = EXTRACTOR_ID;
  readonly version: string;
  readonly supportedMimes = TESSERACT_MIMES;
  /** Modelo lógico para a chave de cache (ADR-004). */
  readonly model = EXTRACTOR_MODEL;
  /** Parâmetros escalares estáveis (`lang`, `psm`) — participam da chave de cache. */
  readonly params: ExtractorParams;

  private readonly binaryPath: string | undefined;
  private readonly lang: string;
  private readonly psm: number;
  private readonly timeoutMs: number;
  private readonly killGraceMs: number;

  /**
   * @param options - Ver {@link TesseractExtractorOptions}.
   */
  constructor(options: TesseractExtractorOptions) {
    this.version = options.version;
    this.binaryPath = options.binaryPath;
    this.lang = options.lang ?? DEFAULT_LANG;
    this.psm = options.psm ?? DEFAULT_PSM;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.params = { lang: this.lang, psm: this.psm };
  }

  /**
   * Configuração do extrator pronta para {@link buildAttachmentKey} (ADR-004).
   * @returns `{ version, model, params }` estáveis desta instância.
   */
  get extractorConfig(): ExtractorConfig {
    return { version: this.version, model: this.model, params: this.params };
  }

  /**
   * Roda o OCR sobre `filePath`. Nunca lança: falhas (binário ausente, timeout,
   * erro de execução) viram `{ status: 'failed', metadata.reason }` — degradação
   * graciosa (ADR-002).
   *
   * @param filePath - Caminho absoluto da imagem baixada.
   * @param options - MIME real + logger — ver {@link ExtractOptions}.
   * @returns `done` com `text` no sucesso; `failed` com motivo claro na falha.
   */
  async extract(filePath: string, options: ExtractOptions): Promise<ExtractionResult> {
    const bin = this.binaryPath;
    if (bin === undefined) {
      options.logger?.warn(
        'tesseract: binário não encontrado no PATH nem em locais convencionais; ' +
          'instale o tesseract (ex.: `brew install tesseract`) — veja o doctor',
      );
      return this.failed(options.mime, 'tesseract-nao-instalado', {
        hint: 'instale o tesseract e os traineddata por+eng; o doctor (#53) valida a instalação',
      });
    }

    try {
      const stdout = await runTesseract({
        bin,
        filePath,
        lang: this.lang,
        psm: this.psm,
        timeoutMs: this.timeoutMs,
        killGraceMs: this.killGraceMs,
      });
      return {
        status: 'done',
        text: stdout.trim(),
        mime: options.mime,
        metadata: { extractorId: this.id, version: this.version, lang: this.lang, psm: this.psm },
      };
    } catch (error) {
      const isTimeout = error instanceof TesseractTimeoutError;
      return this.failed(options.mime, isTimeout ? 'timeout' : 'erro-execucao', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Monta um `ExtractionResult` `failed` com metadados de diagnóstico, sem
   * injetar chaves `undefined` (respeita `exactOptionalPropertyTypes`).
   *
   * @param mime - MIME real detectado (do dispatcher).
   * @param reason - Motivo canônico da falha.
   * @param extra - Metadados adicionais (hint/erro).
   * @returns Resultado `failed` tipado.
   */
  private failed(mime: string, reason: string, extra: Record<string, unknown>): ExtractionResult {
    return {
      status: 'failed',
      mime,
      metadata: { extractorId: this.id, version: this.version, reason, ...extra },
    };
  }
}

/**
 * Lê a versão do binário via `tesseract --version` (primeira linha:
 * `tesseract X.Y.Z`). Não lança: retorna `undefined` se o binário falhar ou a
 * saída for inesperada.
 *
 * @param bin - Caminho absoluto do binário.
 * @returns A versão semântica detectada (ex.: `5.5.2`), ou `undefined`.
 */
export function detectTesseractVersion(bin: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    execFile(
      bin,
      ['--version'],
      { env: sanitizedEnv(), encoding: 'utf8', windowsHide: true, timeout: DEFAULT_KILL_GRACE_MS },
      (error, stdout) => {
        if (error !== null) {
          resolve(undefined);
          return;
        }
        const match = /tesseract\s+(\d+\.\d+\.\d+)/i.exec(stdout);
        resolve(match?.[1]);
      },
    );
  });
}

/**
 * Cria um {@link TesseractExtractor} resolvendo binário e versão. Localiza o
 * tesseract ({@link findTesseract}); se presente, lê a versão real do binário e
 * expõe `version = tesseract-<X.Y.Z>`; se ausente (não instalado) ou versão
 * ilegível, usa {@link INTEGRATION_VERSION} e o extrator degrada em `extract`.
 *
 * @param config - Sobrescreve `lang`/`psm`/timeouts — ver {@link TesseractExtractorOptions}.
 * @returns O extrator pronto para registro no {@link ExtractorRegistry}.
 * @example
 * const extractor = await createTesseractExtractor({ lang: 'eng' });
 */
export async function createTesseractExtractor(
  config: Omit<TesseractExtractorOptions, 'version' | 'binaryPath'> = {},
): Promise<TesseractExtractor> {
  const found = findTesseract();
  let version = INTEGRATION_VERSION;
  if (found !== undefined) {
    const detected = await detectTesseractVersion(found.path);
    version = detected !== undefined ? `tesseract-${detected}` : INTEGRATION_VERSION;
  }
  return new TesseractExtractor({ ...config, binaryPath: found?.path, version });
}

/**
 * Cria o registry DEFAULT do pipeline de extração com os extratores de produção
 * registrados: {@link TesseractExtractor} para imagens (OCR) e {@link PdfExtractor}
 * para PDF (poppler/pdftotext). Ponto único de composição consumido pela fila de
 * jobs.
 *
 * @param config - Config repassada ao {@link createTesseractExtractor} (OCR).
 * @returns Um {@link ExtractorRegistry} com os extratores default registrados.
 * @example
 * const registry = await createDefaultRegistry();
 * const result = await dispatchExtraction(filePath, { registry });
 */
export async function createDefaultRegistry(
  config: Omit<TesseractExtractorOptions, 'version' | 'binaryPath'> = {},
): Promise<ExtractorRegistry> {
  const registry = new ExtractorRegistry();
  const [tesseract, pdf, whisper] = await Promise.all([
    createTesseractExtractor(config),
    createPdfExtractor(),
    createWhisperExtractor(),
  ]);
  registry.register(tesseract);
  registry.register(pdf);
  registry.register(whisper);
  return registry;
}
