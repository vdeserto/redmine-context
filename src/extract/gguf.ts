/**
 * Download do modelo GGUF do whisper.cpp com verificação de integridade
 * (M4-02, #58, ADR-002).
 *
 * A transcrição local (ADR-002) exige um modelo `.gguf`, artefato independente do
 * binário `whisper-cli` ({@link findWhisper}). Este módulo baixa esse modelo de
 * forma AUDITÁVEL e SEGURA, respeitando a política híbrida de binários do ADR-002:
 *
 * - CONSTANTES PINADAS: URL HTTPS oficial ({@link GGUF_MODEL_URL}) e SHA-256
 *   esperado ({@link GGUF_MODEL_SHA256}) ficam no código, não em config remota — a
 *   integridade não depende de o servidor "dizer" qual é o hash certo.
 * - SÓ HTTPS: qualquer URL `http://` é RECUSADA antes de tocar a rede (defesa
 *   contra downgrade/MITM em ambiente corporativo).
 * - CHECKSUM OBRIGATÓRIO: o conteúdo é gravado num `.part`, seu SHA-256 é comparado
 *   ao pinado e só então renomeado para o destino; divergência → o `.part` é
 *   DESCARTADO e um erro claro (esperado vs. obtido) é lançado. A atomicidade fina
 *   e a retomada via HTTP Range ficam para a #59 (M4-03) — aqui basta write+verify.
 * - NUNCA EM MCP HEADLESS: o download é OPT-IN INTERATIVO (`--download-binaries`,
 *   ADR-002). Quando a chamada sinaliza ambiente MCP/headless ({@link DownloadGgufOptions.headless}),
 *   a função RECUSA antes de qualquer IO, com erro acionável — download silencioso
 *   de executáveis/modelos é vetor de supply chain.
 *
 * Todas as dependências de efeito colateral (fetch/fs) são INJETÁVEIS
 * ({@link GgufDeps}) para tornar os testes herméticos — sem rede nem FS real.
 */

import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { whisperModelDir } from './whisper.js';

/**
 * Modelo GGUF default: `ggml-tiny` (multilíngue, ~78 MB) do repositório oficial
 * `ggerganov/whisper.cpp` no Hugging Face. Escolhido por ser o MENOR modelo
 * multilíngue oficial — mantém o auto-detect de idioma do ADR-002 com o menor
 * custo de download para o primeiro contato. Modelos maiores (base/small) são
 * evolução futura configurável; a MECÂNICA de download+verificação é idêntica.
 */
export const GGUF_MODEL_NAME = 'ggml-tiny.bin' as const;

/** URL HTTPS oficial e fixa do {@link GGUF_MODEL_NAME} (Hugging Face resolve). */
export const GGUF_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin' as const;

/**
 * SHA-256 hex esperado do {@link GGUF_MODEL_NAME}. É a ÂNCORA de integridade:
 * o arquivo baixado só é aceito se seu hash bater exatamente com esta constante.
 */
export const GGUF_MODEL_SHA256 =
  'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21' as const;

/** Sufixo do arquivo parcial durante a escrita, antes do rename para o destino. */
const PART_SUFFIX = '.part';

/** Categorias de falha do download — discriminante acionável do {@link GgufDownloadError}. */
export type GgufDownloadFailure = 'headless' | 'insecure-url' | 'http-error' | 'checksum-mismatch';

/**
 * Erro tipado de qualquer recusa/falha do download do modelo GGUF. O campo
 * {@link GgufDownloadError.code} permite ao chamador (CLI/doctor) reagir de forma
 * específica sem casar strings de mensagem.
 */
export class GgufDownloadError extends Error {
  /** Categoria da falha — ver {@link GgufDownloadFailure}. */
  readonly code: GgufDownloadFailure;

  constructor(code: GgufDownloadFailure, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * Dependências injetáveis de efeito colateral (rede + filesystem). O default
 * ({@link defaultGgufDeps}) usa `fetch` global e `node:fs/promises`; os testes
 * injetam spies para permanecerem herméticos.
 */
export interface GgufDeps {
  /** Busca a URL e devolve a resposta (wrapper fino sobre o `fetch` global). */
  readonly fetch: (url: string) => Promise<Response>;
  /** Cria o diretório de destino recursivamente (idempotente). */
  readonly mkdir: (dir: string) => Promise<void>;
  /** Grava os bytes baixados num caminho (o `.part`). */
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>;
  /** Renomeia o `.part` verificado para o destino final. */
  readonly rename: (from: string, to: string) => Promise<void>;
  /** Remove um caminho (o `.part` descartado), sem lançar se ausente. */
  readonly rm: (path: string) => Promise<void>;
}

/** Opções de {@link downloadGgufModel}. Tudo tem default seguro para produção. */
export interface DownloadGgufOptions {
  /** Diretório de destino do modelo. Default: {@link whisperModelDir}. */
  readonly destDir?: string;
  /**
   * Indica ambiente MCP/headless. Quando `true`, o download é RECUSADO (opt-in
   * interativo, ADR-002). Default: `false`.
   */
  readonly headless?: boolean;
  /** URL de origem (HTTPS). Default: {@link GGUF_MODEL_URL}. */
  readonly url?: string;
  /** SHA-256 hex esperado. Default: {@link GGUF_MODEL_SHA256}. */
  readonly sha256?: string;
  /** Dependências injetáveis (fetch/fs). Default: {@link defaultGgufDeps}. */
  readonly deps?: GgufDeps;
}

/**
 * Constrói as dependências reais de produção: `fetch` global e `node:fs/promises`
 * (`mkdir` recursivo, `rm` com `force`). Isolado para manter {@link downloadGgufModel}
 * testável sem tocar rede/FS.
 *
 * @returns Deps ligadas ao ambiente real.
 */
export function defaultGgufDeps(): GgufDeps {
  return {
    fetch: (url) => fetch(url),
    mkdir: async (dir) => {
      await mkdir(dir, { recursive: true });
    },
    writeFile: (path, data) => writeFile(path, data),
    rename: (from, to) => rename(from, to),
    rm: (path) => rm(path, { force: true }),
  };
}

/**
 * Baixa o modelo GGUF do whisper.cpp e o grava no cache local, verificando o
 * SHA-256 pinado antes de considerá-lo válido (ADR-002, M4-02).
 *
 * Ordem dos portões (todos exercitados por testes): (1) guard headless — recusa
 * antes de qualquer IO; (2) só HTTPS — recusa `http://` sem tocar a rede; (3)
 * download; (4) grava `.part` e compara o SHA-256 ao esperado — se bater, renomeia
 * atomicamente para o destino e devolve o caminho; se não, DESCARTA o `.part` e
 * lança {@link GgufDownloadError} com esperado vs. obtido.
 *
 * @param options - Destino, flag headless, origem/checksum e deps — ver {@link DownloadGgufOptions}.
 * @returns Caminho absoluto do modelo `.gguf`/`.bin` gravado e verificado.
 * @throws {GgufDownloadError} `headless` (ambiente MCP), `insecure-url` (não-HTTPS),
 *   `http-error` (resposta não-2xx) ou `checksum-mismatch` (integridade divergente).
 * @example
 * const modelPath = await downloadGgufModel({ headless: false });
 * logger.info(`modelo pronto em ${modelPath}`);
 */
export async function downloadGgufModel(options: DownloadGgufOptions = {}): Promise<string> {
  const headless = options.headless ?? false;
  const url = options.url ?? GGUF_MODEL_URL;
  const expected = (options.sha256 ?? GGUF_MODEL_SHA256).toLowerCase();
  const destDir = options.destDir ?? whisperModelDir();
  const deps = options.deps ?? defaultGgufDeps();

  // Portão 1: opt-in interativo (ADR-002). Nunca baixa em MCP/headless.
  if (headless) {
    throw new GgufDownloadError(
      'headless',
      'Download do modelo GGUF é opt-in interativo (--download-binaries) e não pode ' +
        'rodar em ambiente MCP/headless (ADR-002). Execute a CLI interativamente para baixá-lo.',
    );
  }

  // Portão 2: só HTTPS — bloqueia downgrade/MITM antes de qualquer rede.
  const protocol = new URL(url).protocol;
  if (protocol !== 'https:') {
    throw new GgufDownloadError(
      'insecure-url',
      `Download recusado: apenas HTTPS é permitido para o modelo GGUF (protocolo recebido: '${protocol}').`,
    );
  }

  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new GgufDownloadError(
      'http-error',
      `Falha ao baixar o modelo GGUF: resposta HTTP ${response.status}.`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  await deps.mkdir(destDir);
  const finalPath = join(destDir, GGUF_MODEL_NAME);
  const partPath = `${finalPath}${PART_SUFFIX}`;
  await deps.writeFile(partPath, bytes);

  // Portão 3: integridade. Só o hash pinado valida o conteúdo — nunca o servidor.
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    // Descarta o download corrompido; o destino final NUNCA chega a existir.
    await deps.rm(partPath);
    throw new GgufDownloadError(
      'checksum-mismatch',
      `Integridade do modelo GGUF divergente: esperado ${expected}, obtido ${actual}. Arquivo descartado.`,
    );
  }

  await deps.rename(partPath, finalPath);
  return finalPath;
}
