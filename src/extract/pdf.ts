/**
 * Extrator de texto de PDF via `pdftotext` (poppler) — M4-extra, #145, ADR-002.
 *
 * Roda o binário `pdftotext` sobre um PDF já baixado no cache e devolve a CAMADA
 * DE TEXTO do documento num {@link ExtractionResult}. ESPELHA ponto-a-ponto o
 * padrão do {@link TesseractExtractor} (ADR-002), todas as decisões exercitadas
 * por testes:
 *
 * - INVOCAÇÃO SEM SHELL: usa `execFile` (nunca `exec`/shell) com lista de
 *   argumentos explícita (`pdftotext -enc UTF-8 <file> -`, `-` = stdout) — o
 *   `filePath` NUNCA é interpolado numa string de shell, eliminando injeção por
 *   nome de arquivo malicioso.
 * - ENV SANITIZADO: o subprocesso recebe um env MÍNIMO e EXPLÍCITO (só `PATH`) —
 *   segredos do processo pai (ex.: `REDMINE_API_KEY`) NUNCA vazam para o pdftotext.
 * - TIMEOUT + KILL: um watchdog envia `SIGTERM` no timeout e, após a graça,
 *   `SIGKILL` — um pdftotext travado (PDF patológico) não pendura a fila de jobs.
 * - DEGRADAÇÃO GRACIOSA: binário ausente do PATH/locais convencionais NÃO lança;
 *   devolve `{ status: 'failed', metadata.reason }` com dica de instalação (o
 *   `doctor` da #53 orienta o usuário).
 *
 * SEMÂNTICA DO PDF SEM CAMADA DE TEXTO (escaneado): quando o `pdftotext` sai com
 * sucesso mas a saída é VAZIA ou só whitespace (form-feed por página), NÃO
 * devolvemos `{ status: 'done', text: '' }` — isso MENTIRIA ao consumidor,
 * afirmando "extração concluída, sem texto" quando na verdade não há camada de
 * texto extraível (o conteúdo é imagem, exigindo OCR). Devolvemos
 * `{ status: 'failed', reason: 'pdf-sem-camada-de-texto' }` com um `hint` de que
 * o OCR por página fica para uma issue futura — falha honesta e diagnosticável.
 *
 * A chave de cache do anexo (ADR-004) depende de `version` + `model` + `params`
 * ({@link buildAttachmentKey}); por isso o extrator expõe {@link PdfExtractor.version}
 * (derivada do binário real quando detectável, senão a versão da integração) e
 * {@link PdfExtractor.params} (inclui `enc`/`layout`, estáveis para a chave).
 */

import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

import type { ExtractorParams } from '../cache/contract.js';
import type { ExtractorConfig } from '../cache/keys.js';
import type { ExtractionResult } from '../contract.js';

import { type ExtractOptions, type Extractor } from './dispatcher.js';

/** Identificador estável do extrator (entra em metadados). */
const EXTRACTOR_ID = 'pdftotext';

/** Modelo lógico para a chave de cache (ADR-004). PDF→texto não versiona "modelo". */
const EXTRACTOR_MODEL = 'pdftotext';

/**
 * Versão de FALLBACK da integração, usada quando o binário não é detectável (não
 * instalado) e portanto sua versão não pode ser lida. Mantém `version` estável e
 * não-vazia para {@link buildAttachmentKey}.
 */
const INTEGRATION_VERSION = 'pdftotext-integration-1';

/** Encoding de saída — sempre UTF-8 (participa da chave de cache via `params`). */
const OUTPUT_ENCODING = 'UTF-8';

/** Timeout default de uma extração antes do `SIGTERM` (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Graça entre `SIGTERM` e `SIGKILL` (ms) — dá ao pdftotext chance de sair limpo. */
const DEFAULT_KILL_GRACE_MS = 2_000;

/** Teto do stdout capturado (32 MiB) — PDFs textuais densos cabem com folga. */
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/** MIME REAL (magic bytes `%PDF`, ver `./magic.ts`) que o pdftotext aceita. */
export const PDF_MIMES: readonly string[] = ['application/pdf'];

/**
 * Locais convencionais do binário `pdftotext`, por plataforma — consultados após
 * o `PATH`. No Windows, os builds do poppler (oschwartz10612.Poppler / choco)
 * instalam em `…\poppler\bin`. Reutilizados pelo `doctor` (#53) via {@link findPdftotext}.
 */
const CONVENTIONAL_UNIX = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'] as const;
const CONVENTIONAL_WINDOWS = [
  'C:\\Program Files\\poppler\\bin',
  'C:\\Program Files\\poppler\\Library\\bin',
  'C:\\poppler\\bin',
] as const;

/** Resultado de {@link findPdftotext}: caminho absoluto do binário localizado. */
export interface PdftotextLocation {
  /** Caminho absoluto do executável `pdftotext` encontrado. */
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
 * Localiza o binário `pdftotext` no `PATH` e em locais convencionais por
 * plataforma (`/opt/homebrew/bin`, `/usr/local/bin`, `C:\\Program Files\\poppler\\bin`).
 * Função pura e reutilizável pelo `doctor` (#53). Não executa o binário.
 *
 * @returns A localização encontrada, ou `undefined` se não instalado.
 * @example
 * const found = findPdftotext();
 * if (found === undefined) logger.warn('pdftotext (poppler) não instalado');
 */
export function findPdftotext(): PdftotextLocation | undefined {
  const isWindows = process.platform === 'win32';
  const exe = isWindows ? 'pdftotext.exe' : 'pdftotext';
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
 * Monta o env MÍNIMO e EXPLÍCITO do subprocesso (ADR-002). Só repassa `PATH`;
 * NENHUM outro segredo do pai (ex.: `REDMINE_API_KEY`) é herdado.
 *
 * @returns Env sanitizado para o subprocesso pdftotext.
 */
function sanitizedEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin' };
}

/** Erro interno: o watchdog matou o pdftotext por estourar o timeout. */
class PdftotextTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`pdftotext excedeu o timeout de ${timeoutMs}ms e foi encerrado`);
    this.name = 'PdftotextTimeoutError';
  }
}

/** Parâmetros de uma execução isolada do binário. */
interface RunOptions {
  readonly bin: string;
  readonly filePath: string;
  readonly layout: boolean;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
}

/**
 * Executa `pdftotext -enc UTF-8 [-layout] <file> -` SEM shell, com env sanitizado
 * e watchdog de timeout (`SIGTERM` → graça → `SIGKILL`). O `-` final direciona a
 * saída para o stdout.
 *
 * @param options - Ver {@link RunOptions}.
 * @returns O stdout (texto do PDF) do pdftotext.
 * @throws {PdftotextTimeoutError} Se estourar o timeout.
 * @throws {Error} Se o binário falhar (exit != 0, não encontrado em runtime, etc.).
 */
function runPdftotext(options: RunOptions): Promise<string> {
  const { bin, filePath, layout, timeoutMs, killGraceMs } = options;
  const args = ['-enc', OUTPUT_ENCODING, ...(layout ? ['-layout'] : []), filePath, '-'];

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
          settle(() => reject(new PdftotextTimeoutError(timeoutMs)));
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
            settle(() => reject(new PdftotextTimeoutError(timeoutMs)));
          }, killGraceMs),
        );
      }, timeoutMs),
    );
  });
}

/** Opções de construção do {@link PdfExtractor}. */
export interface PdfExtractorOptions {
  /**
   * Caminho absoluto do binário já resolvido. `undefined` = não instalado; nesse
   * caso {@link PdfExtractor.extract} degrada para `failed` (não lança).
   */
  readonly binaryPath?: string | undefined;
  /** Versão exposta na chave de cache (ver {@link INTEGRATION_VERSION} como fallback). */
  readonly version: string;
  /**
   * Preservar layout físico (`-layout`) em vez da ordem de leitura. Default `false`.
   * Participa da identidade da extração (chave de cache).
   */
  readonly layout?: boolean;
  /** Timeout antes do `SIGTERM` (ms); default {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Graça `SIGTERM`→`SIGKILL` (ms); default {@link DEFAULT_KILL_GRACE_MS}. */
  readonly killGraceMs?: number;
}

/**
 * Extrator de texto de PDF baseado no binário `pdftotext` do poppler (ADR-002).
 * Implementa {@link Extractor} e, além do contrato, expõe {@link params} e
 * {@link extractorConfig} estáveis para {@link buildAttachmentKey}.
 */
export class PdfExtractor implements Extractor {
  readonly id = EXTRACTOR_ID;
  readonly version: string;
  readonly supportedMimes = PDF_MIMES;
  /** Modelo lógico para a chave de cache (ADR-004). */
  readonly model = EXTRACTOR_MODEL;
  /** Parâmetros escalares estáveis (`enc`, `layout`) — participam da chave de cache. */
  readonly params: ExtractorParams;

  private readonly binaryPath: string | undefined;
  private readonly layout: boolean;
  private readonly timeoutMs: number;
  private readonly killGraceMs: number;

  /**
   * @param options - Ver {@link PdfExtractorOptions}.
   */
  constructor(options: PdfExtractorOptions) {
    this.version = options.version;
    this.binaryPath = options.binaryPath;
    this.layout = options.layout ?? false;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.params = { enc: OUTPUT_ENCODING, layout: this.layout };
  }

  /**
   * Configuração do extrator pronta para {@link buildAttachmentKey} (ADR-004).
   * @returns `{ version, model, params }` estáveis desta instância.
   */
  get extractorConfig(): ExtractorConfig {
    return { version: this.version, model: this.model, params: this.params };
  }

  /**
   * Extrai a camada de texto de `filePath`. Nunca lança: falhas (binário ausente,
   * timeout, erro de execução, PDF sem texto) viram `{ status: 'failed',
   * metadata.reason }` — degradação graciosa (ADR-002).
   *
   * IMPORTANTE (semântica): um PDF ESCANEADO (sem camada de texto) produz saída
   * vazia/whitespace no `pdftotext`; nesse caso devolvemos `failed` com
   * `reason: 'pdf-sem-camada-de-texto'` (e um `hint` de OCR), e NÃO
   * `{ status: 'done', text: '' }` — que afirmaria falsamente sucesso sem texto.
   *
   * @param filePath - Caminho absoluto do PDF baixado.
   * @param options - MIME real + logger — ver {@link ExtractOptions}.
   * @returns `done` com `text` no sucesso; `failed` com motivo claro na falha.
   */
  async extract(filePath: string, options: ExtractOptions): Promise<ExtractionResult> {
    const bin = this.binaryPath;
    if (bin === undefined) {
      options.logger?.warn(
        'pdftotext: binário não encontrado no PATH nem em locais convencionais; ' +
          'instale o poppler (ex.: `brew install poppler`) — veja o doctor',
      );
      return this.failed(options.mime, 'pdftotext-nao-instalado', {
        hint: 'instale o poppler (pdftotext); o doctor (#53) valida a instalação',
      });
    }

    let stdout: string;
    try {
      stdout = await runPdftotext({
        bin,
        filePath,
        layout: this.layout,
        timeoutMs: this.timeoutMs,
        killGraceMs: this.killGraceMs,
      });
    } catch (error) {
      const isTimeout = error instanceof PdftotextTimeoutError;
      return this.failed(options.mime, isTimeout ? 'timeout' : 'erro-execucao', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const text = stdout.trim();
    if (text.length === 0) {
      // PDF escaneado / sem camada de texto: `done` com text vazio MENTIRIA.
      return this.failed(options.mime, 'pdf-sem-camada-de-texto', {
        hint: 'PDF sem camada de texto (provavelmente escaneado) — OCR por página fica para issue futura',
      });
    }

    return {
      status: 'done',
      text,
      mime: options.mime,
      metadata: { extractorId: this.id, version: this.version, layout: this.layout },
    };
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
 * Lê a versão do binário via `pdftotext -v`. O poppler imprime
 * `pdftotext version X.Y.Z` no STDERR (não stdout) e sai com código 0. Não lança:
 * retorna `undefined` se o binário falhar ou a saída for inesperada.
 *
 * @param bin - Caminho absoluto do binário.
 * @returns A versão semântica detectada (ex.: `24.02.0`), ou `undefined`.
 */
export function detectPdftotextVersion(bin: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    execFile(
      bin,
      ['-v'],
      { env: sanitizedEnv(), encoding: 'utf8', windowsHide: true, timeout: DEFAULT_KILL_GRACE_MS },
      (error, stdout, stderr) => {
        // Reason: `pdftotext -v` sai com status 0 e escreve a versão no STDERR;
        // toleramos `error` não-nulo e ainda tentamos parsear ambos os streams.
        const combined = `${stderr}${stdout}`;
        const match = /pdftotext\s+version\s+(\d+\.\d+\.\d+)/i.exec(combined);
        if (match === null && error !== null) {
          resolve(undefined);
          return;
        }
        resolve(match?.[1]);
      },
    );
  });
}

/**
 * Cria um {@link PdfExtractor} resolvendo binário e versão. Localiza o
 * `pdftotext` ({@link findPdftotext}); se presente, lê a versão real do binário e
 * expõe `version = pdftotext-<X.Y.Z>`; se ausente (não instalado) ou versão
 * ilegível, usa {@link INTEGRATION_VERSION} e o extrator degrada em `extract`.
 *
 * @param config - Sobrescreve `layout`/timeouts — ver {@link PdfExtractorOptions}.
 * @returns O extrator pronto para registro no {@link ExtractorRegistry}.
 * @example
 * const extractor = await createPdfExtractor({ layout: true });
 */
export async function createPdfExtractor(
  config: Omit<PdfExtractorOptions, 'version' | 'binaryPath'> = {},
): Promise<PdfExtractor> {
  const found = findPdftotext();
  let version = INTEGRATION_VERSION;
  if (found !== undefined) {
    const detected = await detectPdftotextVersion(found.path);
    version = detected !== undefined ? `pdftotext-${detected}` : INTEGRATION_VERSION;
  }
  return new PdfExtractor({ ...config, binaryPath: found?.path, version });
}
