/**
 * Extrator de transcrição de áudio via whisper.cpp (M4-05, #61, ADR-002).
 *
 * Recebe um WAV (o formato PCM 16 kHz mono produzido pela conversão da #60) e o
 * transcreve para texto rodando o binário do whisper.cpp com o modelo GGUF do
 * cache local. Espelha o estilo dos extratores já estabelecidos
 * ({@link TesseractExtractor}, {@link convertAudioToWav}). Decisões de
 * segurança/robustez (ADR-002), todas exercitadas por testes:
 *
 * - INVOCAÇÃO SEM SHELL: usa `execFile` (nunca `exec`/shell) com uma lista de
 *   argumentos explícita — o caminho do WAV e do modelo NUNCA são interpolados
 *   numa string de shell.
 * - ENV SANITIZADO: o subprocesso recebe um env MÍNIMO (só `PATH`) — segredos do
 *   processo pai (ex.: `REDMINE_API_KEY`) NUNCA vazam para o whisper.
 * - MODELO GGUF DO CACHE: o modelo é passado via `-m <path>`, resolvido a partir
 *   do diretório canônico de modelos ({@link whisperModelDir}) + {@link GGUF_MODEL_NAME}
 *   — o binário e o modelo são artefatos independentes (ver `whisper.ts`).
 * - IDIOMA AUTO-DETECT: nenhuma flag de idioma é passada aqui; o auto-detect é o
 *   default do whisper.cpp (ADR-002). O override explícito de idioma é a #62.
 * - TIMEOUT + KILL: um watchdog envia `SIGTERM` no timeout e, após a graça,
 *   `SIGKILL` — um whisper travado não pendura a fila de jobs.
 * - DEGRADAÇÃO GRACIOSA: binário ausente, modelo GGUF ausente, exit != 0 ou
 *   timeout NÃO lançam; devolvem `{ status: 'failed', metadata.reason }` com dica.
 *
 * UNTRUSTED: a transcrição é conteúdo DERIVADO de um anexo (input hostil), logo é
 * NÃO-CONFIÁVEL. Este extrator NÃO reembrulha o texto: expõe `text` cru, e a
 * camada bundle (`src/bundle/json.ts` / `src/bundle/markdown.ts`) o isola em
 * `{ untrusted: true }` / `<untrusted-content>` — o mesmo mecanismo do tesseract.
 *
 * CONFIDENCE: o stdout default do whisper.cpp (mesmo com timestamps) NÃO carrega
 * um score de confiança agregado; obter probabilidades por token exigiria a saída
 * JSON (`-oj`) + leitura de arquivo, fora do escopo XS desta issue. Por isso
 * `confidence` é OMITIDO do resultado (respeitando `exactOptionalPropertyTypes`,
 * nunca injetado como `undefined`) — "se disponível na saída, senão omita".
 *
 * TESTABILIDADE: o executor do subprocesso, o localizador do binário e o do modelo
 * são INJETÁVEIS — os testes unitários são herméticos (sem whisper/modelo/FS reais)
 * e asseguram os args passados ao executor.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtractorParams } from '../cache/contract.js';
import type { ExtractorConfig } from '../cache/keys.js';
import type { ExtractionResult } from '../contract.js';

import type { ExtractOptions, Extractor } from './dispatcher.js';
import { GGUF_MODEL_NAME } from './gguf.js';
import { findWhisper, whisperModelDir } from './whisper.js';

/** Identificador estável do extrator (entra em metadados). */
const EXTRACTOR_ID = 'whisper-transcribe';

/**
 * Modelo lógico para a chave de cache (ADR-004): o nome do arquivo GGUF. Trocar o
 * modelo (ex.: `ggml-tiny` → `ggml-base`) muda a identidade e invalida o cache.
 */
const EXTRACTOR_MODEL = GGUF_MODEL_NAME;

/**
 * Versão da integração. Diferente de ffmpeg/tesseract, o whisper.cpp não tem um
 * `--version` estável entre releases (ver `whisper.ts`), então usamos uma versão
 * de integração fixa para a chave de cache (ADR-004).
 */
const INTEGRATION_VERSION = 'whisper-integration-1';

/** Timeout default de uma transcrição antes do `SIGTERM` (ms) — áudio é lento. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Graça entre `SIGTERM` e `SIGKILL` (ms) — dá ao whisper chance de sair limpo. */
const DEFAULT_KILL_GRACE_MS = 2_000;

/** Teto do stdout capturado (16 MiB) — transcrições longas cabem com folga. */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/** Flag `-nt` (no timestamps): mantém o stdout como texto puro, fácil de parsear. */
const NO_TIMESTAMPS_FLAG = '-nt';

/**
 * MIMEs de áudio roteados para a transcrição. O whisper.cpp consome o WAV; o
 * pipeline real (áudio → WAV via #60 → whisper) é orquestrado por quem chama.
 * Registrar estes MIMEs deixa o extrator pronto no registry default.
 */
export const WHISPER_MIMES: readonly string[] = [
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
];

/** Regex do prefixo de timestamp do whisper.cpp: `[00:00:00.000 --> 00:00:02.000]`. */
const TIMESTAMP_PREFIX = /^\[[0-9:.]+\s*-->\s*[0-9:.]+\]\s*/;

/** Colapsa qualquer sequência de espaços em branco num único espaço. */
const WHITESPACE_RUN = /\s+/g;

/**
 * Parseia o stdout do whisper.cpp numa transcrição de linha única. Remove o
 * prefixo de timestamp de cada linha (robustez, mesmo com `-nt` ativo), descarta
 * linhas vazias e junta o texto com espaço, colapsando espaços em branco.
 *
 * @param stdout - Saída bruta do whisper.cpp.
 * @returns O texto transcrito, ou string vazia se não houver conteúdo.
 * @example
 * parseWhisperOutput('[00:00:00.000 --> 00:00:02.000]  Olá\n'); // 'Olá'
 */
export function parseWhisperOutput(stdout: string): string {
  return stdout
    .split('\n')
    .map((line) => line.replace(TIMESTAMP_PREFIX, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/** Invocação concreta do whisper passada ao {@link WhisperRunner}. */
export interface WhisperInvocation {
  /** Caminho absoluto do binário whisper.cpp já resolvido. */
  readonly bin: string;
  /** Argumentos (sem shell): `-m <modelo GGUF> -f <wav> -nt`. */
  readonly args: readonly string[];
  /** Env SANITIZADO do subprocesso (só `PATH`). */
  readonly env: NodeJS.ProcessEnv;
  /** Timeout antes do `SIGTERM` (ms). */
  readonly timeoutMs: number;
  /** Graça `SIGTERM` → `SIGKILL` (ms). */
  readonly killGraceMs: number;
}

/**
 * Executor injetável do subprocesso whisper. Resolve com o `stdout` (a
 * transcrição) no sucesso; rejeita em falha (exit != 0, binário não-executável em
 * runtime) — rejeitando com um erro de nome `WhisperTimeoutError` no estouro de
 * timeout.
 */
export type WhisperRunner = (invocation: WhisperInvocation) => Promise<string>;

/** Erro interno: o watchdog matou o whisper por estourar o timeout. */
class WhisperTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`whisper excedeu o timeout de ${timeoutMs}ms e foi encerrado`);
    this.name = 'WhisperTimeoutError';
  }
}

/**
 * Monta o env MÍNIMO do subprocesso: só `PATH`. Nenhum segredo do pai (ex.:
 * `REDMINE_API_KEY`) vaza para o whisper (ADR-002).
 *
 * @returns Env sanitizado para o subprocesso.
 */
function sanitizedEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin' };
}

/**
 * Monta os argumentos do whisper.cpp: modelo GGUF via `-m`, entrada WAV via `-f`
 * e `-nt` (sem timestamps, stdout limpo). Nenhuma flag de idioma — auto-detect é o
 * default (ADR-002; o override é a #62).
 *
 * @param modelPath - Caminho absoluto do modelo GGUF no cache.
 * @param inputPath - Caminho absoluto do WAV a transcrever.
 * @returns Lista de argumentos, na ordem esperada pelo whisper.cpp.
 */
function buildWhisperArgs(modelPath: string, inputPath: string): readonly string[] {
  return ['-m', modelPath, '-f', inputPath, NO_TIMESTAMPS_FLAG];
}

/** `true` se o erro sinaliza estouro de timeout do watchdog (por nome, robusto a DI). */
function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'WhisperTimeoutError';
}

/**
 * Executor default: roda o whisper.cpp SEM shell com env sanitizado e watchdog de
 * timeout (`SIGTERM` → graça → `SIGKILL`). Resolve com o `stdout` no exit 0;
 * rejeita caso contrário (com {@link WhisperTimeoutError} no estouro de timeout).
 *
 * @param invocation - Ver {@link WhisperInvocation}.
 * @returns O stdout (transcrição) do whisper.
 */
function defaultRun(invocation: WhisperInvocation): Promise<string> {
  const { bin, args, env, timeoutMs, killGraceMs } = invocation;

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
      [...args],
      { env, encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES, windowsHide: true },
      (error, stdout) => {
        if (timedOut) {
          settle(() => reject(new WhisperTimeoutError(timeoutMs)));
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
            settle(() => reject(new WhisperTimeoutError(timeoutMs)));
          }, killGraceMs),
        );
      }, timeoutMs),
    );
  });
}

/** Opções de construção do {@link WhisperExtractor}. */
export interface WhisperExtractorOptions {
  /**
   * Caminho absoluto do binário já resolvido. `undefined` = não instalado; nesse
   * caso {@link WhisperExtractor.extract} degrada para `failed` (não lança).
   */
  readonly binaryPath?: string | undefined;
  /**
   * Caminho absoluto do modelo GGUF no cache. `undefined` = modelo ausente; nesse
   * caso {@link WhisperExtractor.extract} degrada para `failed` (não lança).
   */
  readonly modelPath?: string | undefined;
  /** Versão exposta na chave de cache (default de fábrica: {@link INTEGRATION_VERSION}). */
  readonly version: string;
  /** Executor do subprocesso; default: watchdog real com `execFile`. */
  readonly run?: WhisperRunner;
  /** Timeout antes do `SIGTERM` (ms); default {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Graça `SIGTERM` → `SIGKILL` (ms); default {@link DEFAULT_KILL_GRACE_MS}. */
  readonly killGraceMs?: number;
}

/**
 * Extrator de transcrição baseado no binário whisper.cpp (ADR-002). Implementa
 * {@link Extractor} e, além do contrato, expõe {@link extractorConfig} estável
 * para {@link buildAttachmentKey}.
 */
export class WhisperExtractor implements Extractor {
  readonly id = EXTRACTOR_ID;
  readonly version: string;
  readonly supportedMimes = WHISPER_MIMES;
  /** Modelo lógico (nome do GGUF) para a chave de cache (ADR-004). */
  readonly model = EXTRACTOR_MODEL;
  /** Sem parâmetros escalares próprios (idioma é auto-detect; override é a #62). */
  readonly params: ExtractorParams = {};

  private readonly binaryPath: string | undefined;
  private readonly modelPath: string | undefined;
  private readonly run: WhisperRunner;
  private readonly timeoutMs: number;
  private readonly killGraceMs: number;

  /**
   * @param options - Ver {@link WhisperExtractorOptions}.
   */
  constructor(options: WhisperExtractorOptions) {
    this.version = options.version;
    this.binaryPath = options.binaryPath;
    this.modelPath = options.modelPath;
    this.run = options.run ?? defaultRun;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  }

  /**
   * Configuração do extrator pronta para {@link buildAttachmentKey} (ADR-004).
   * @returns `{ version, model, params }` estáveis desta instância.
   */
  get extractorConfig(): ExtractorConfig {
    return { version: this.version, model: this.model, params: this.params };
  }

  /**
   * Transcreve o WAV em `filePath`. Nunca lança: falhas (binário ausente, modelo
   * GGUF ausente, timeout, erro de execução) viram `{ status: 'failed',
   * metadata.reason }` — degradação graciosa (ADR-002).
   *
   * @param filePath - Caminho absoluto do WAV (ou áudio) a transcrever.
   * @param options - MIME real + logger — ver {@link ExtractOptions}.
   * @returns `done` com `text` no sucesso; `failed` com motivo claro na falha.
   */
  async extract(filePath: string, options: ExtractOptions): Promise<ExtractionResult> {
    const bin = this.binaryPath;
    if (bin === undefined) {
      options.logger?.warn(
        'whisper: binário não encontrado no PATH nem em locais convencionais; ' +
          'instale o whisper.cpp (ex.: `brew install whisper-cpp`) — veja o doctor',
      );
      return this.failed(options.mime, 'whisper-nao-instalado', {
        hint: 'instale o whisper.cpp (whisper-cli/whisper-cpp); o doctor (#57) valida a instalação',
      });
    }

    const model = this.modelPath;
    if (model === undefined) {
      options.logger?.warn(
        'whisper: modelo GGUF não encontrado no cache; ' +
          'baixe o modelo (ex.: `--download-binaries`) — veja o doctor',
      );
      return this.failed(options.mime, 'modelo-nao-encontrado', {
        hint: 'o modelo GGUF do whisper.cpp não está no cache; o doctor (#57) orienta o download',
      });
    }

    try {
      const stdout = await this.run({
        bin,
        args: buildWhisperArgs(model, filePath),
        env: sanitizedEnv(),
        timeoutMs: this.timeoutMs,
        killGraceMs: this.killGraceMs,
      });
      return {
        status: 'done',
        text: parseWhisperOutput(stdout),
        mime: options.mime,
        metadata: { extractorId: this.id, version: this.version, model: this.model },
      };
    } catch (error) {
      return this.failed(options.mime, isTimeoutError(error) ? 'timeout' : 'erro-transcricao', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Monta um `ExtractionResult` `failed` com metadados de diagnóstico, sem injetar
   * chaves `undefined` (respeita `exactOptionalPropertyTypes`).
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

/** Opções de composição do {@link createWhisperExtractor} (localizadores injetáveis). */
export interface CreateWhisperExtractorOptions {
  /**
   * Localizador do binário whisper.cpp; retorna o caminho absoluto ou `undefined`
   * (não instalado). Default: {@link findWhisper} no ambiente real.
   */
  readonly findBinary?: () => string | undefined;
  /**
   * Localizador do modelo GGUF no cache; retorna o caminho absoluto ou `undefined`
   * (ausente). Default: {@link whisperModelDir} + {@link GGUF_MODEL_NAME} se existir.
   */
  readonly findModel?: () => string | undefined;
  /** Executor do subprocesso; default: watchdog real com `execFile`. */
  readonly run?: WhisperRunner;
  /** Timeout antes do `SIGTERM` (ms); default {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Graça `SIGTERM` → `SIGKILL` (ms); default {@link DEFAULT_KILL_GRACE_MS}. */
  readonly killGraceMs?: number;
}

/**
 * Resolve o caminho default do modelo GGUF no cache — {@link whisperModelDir} +
 * {@link GGUF_MODEL_NAME} — retornando-o só se o arquivo existir.
 *
 * @returns O caminho absoluto do modelo, ou `undefined` se ausente do cache.
 */
function defaultFindModel(): string | undefined {
  const modelPath = join(whisperModelDir(), GGUF_MODEL_NAME);
  return existsSync(modelPath) ? modelPath : undefined;
}

/**
 * Cria um {@link WhisperExtractor} resolvendo binário e modelo GGUF. Localiza o
 * whisper.cpp ({@link findWhisper}) e o modelo no cache; ambos ausentes fazem o
 * extrator degradar graciosamente em `extract` (ADR-002), sem lançar aqui.
 *
 * @param options - Localizadores/executor/timeouts injetáveis — ver {@link CreateWhisperExtractorOptions}.
 * @returns O extrator pronto para registro no {@link ExtractorRegistry}.
 * @example
 * const extractor = await createWhisperExtractor();
 */
export function createWhisperExtractor(
  options: CreateWhisperExtractorOptions = {},
): Promise<WhisperExtractor> {
  const findBinary = options.findBinary ?? ((): string | undefined => findWhisper()?.path);
  const findModel = options.findModel ?? defaultFindModel;
  const extractor = new WhisperExtractor({
    binaryPath: findBinary(),
    modelPath: findModel(),
    version: INTEGRATION_VERSION,
    ...(options.run !== undefined ? { run: options.run } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.killGraceMs !== undefined ? { killGraceMs: options.killGraceMs } : {}),
  });
  return Promise.resolve(extractor);
}
