/**
 * Download de anexo com nome derivado de `id + digest` (M3-06, ADR-004).
 *
 * Baixa o binário de um anexo do Redmine de forma AUTENTICADA (reusa o
 * {@link HttpClient} com retry/TLS via `getBinary`) e o grava em disco no layout
 * do ADR-004:
 *
 *   `<cache_dir>/<instance_hash>/attachments/<id>-<digest8>/original<ext>`
 *
 * — o MESMO diretório em que as extrações caras do anexo são cacheadas, de modo
 * que o arquivo original e seus derivados coexistam sob a mesma identidade
 * imutável de conteúdo.
 *
 * Segurança (plano): o `filename` que o Redmine reporta NUNCA entra no caminho em
 * disco — apenas sua EXTENSÃO, e ainda assim sanitizada (lowercase, regex
 * `^[a-z0-9]{1,8}$`, senão `.bin`). Um `filename` malicioso como
 * `../../../evil.sh` não consegue escapar do `cache_dir`, pois o nome do arquivo
 * é sempre `original<ext>` e o resto do path deriva só de `id`/`digest` (hex).
 *
 * Atomicidade: o conteúdo é transmitido para um arquivo `.part` único e só então
 * renomeado para o destino (`rename` atômico no mesmo filesystem). Um leitor nunca
 * observa conteúdo parcial com o nome final; se o stream falhar, o `.part` é
 * removido. Idempotência: se o destino (mesmo `id + digest`) já existe, o download
 * é PULADO — anexos são imutáveis, então re-baixar seria desperdício.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { instanceHash } from '../cache/index.js';
import { deriveAttachmentDigest } from '../cache/keys.js';
import type { HttpClient } from '../client/index.js';
import type { Attachment } from '../contract.js';

/** Subdiretório da camada de attachment sob cada instância (espelha o DiskCacheStore). */
const ATTACHMENTS_DIR = 'attachments';

/** Comprimento (chars hex) do digest usado no path do anexo (ADR-004). */
const DIGEST_PATH_LENGTH = 8;

/** Nome-base fixo do arquivo original — o filename do Redmine nunca entra aqui. */
const ORIGINAL_BASENAME = 'original';

/** Extensão de fallback quando a do anexo é ausente/insegura. */
const FALLBACK_EXTENSION = '.bin';

/** Extensão considerada segura: 1–8 caracteres alfanuméricos minúsculos. */
const SAFE_EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;

/** Padrão de um digest já em forma hexadecimal (8–64 chars). */
const HEX_DIGEST_PATTERN = /^[0-9a-fA-F]{8,64}$/;

/** Opções de {@link downloadAttachment}. */
export interface DownloadAttachmentOptions {
  /** Raiz do cache em disco (mesma do {@link DiskCacheStore}). */
  cacheDir: string;
  /** URL base da instância Redmine — vira o `instance_hash` do path. */
  instanceUrl: string;
}

/**
 * Deriva a extensão SEGURA a partir do `filename` do Redmine. Apenas a extensão é
 * aproveitada (nunca o nome inteiro) e ainda passa por sanitização: minúsculas e
 * regex `^[a-z0-9]{1,8}$`; qualquer coisa fora disso vira `.bin`.
 *
 * @param filename - Nome de arquivo reportado pelo Redmine (não confiável).
 * @returns Extensão com ponto (ex.: `.png`) ou `.bin`.
 * @example
 * safeExtension('photo.PNG'); // '.png'
 * safeExtension('../../../evil.sh'); // '.sh' (mas só a extensão entra no path)
 * safeExtension('noext'); // '.bin'
 */
export function safeExtension(filename: string): string {
  const ext = extname(filename).replace(/^\./, '').toLowerCase();
  return SAFE_EXTENSION_PATTERN.test(ext) ? `.${ext}` : FALLBACK_EXTENSION;
}

/**
 * Calcula o segmento `<digest8>` do path do anexo, espelhando a lógica do
 * {@link DiskCacheStore}: usa `attachment.digest` quando é hex puro; deriva um
 * digest determinístico de `(id, filesize, created_on)` quando ausente (Redmine
 * < 4.x); e re-hasheia por SHA-256 qualquer digest não-hex (defesa contra
 * traversal). O resultado são sempre 8 chars hex — impossível conter `/` ou `..`.
 *
 * @param attachment - Anexo do contrato.
 * @returns Primeiros 8 chars hex do digest normalizado.
 */
function digest8For(attachment: Attachment): string {
  const raw =
    attachment.digest !== undefined && attachment.digest !== ''
      ? attachment.digest
      : deriveAttachmentDigest(attachment);
  const hex = HEX_DIGEST_PATTERN.test(raw)
    ? raw.toLowerCase()
    : createHash('sha256').update(raw).digest('hex');
  return hex.slice(0, DIGEST_PATH_LENGTH);
}

/** Indica se um caminho existe no filesystem. */
async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Consome um `ReadableStream` web como um `AsyncGenerator` de chunks, para
 * alimentar o `pipeline` do Node sem depender da conversão web→node (evita
 * `Readable.fromWeb` e casts inseguros).
 */
async function* toChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Baixa o binário de um anexo do Redmine e o grava no cache local (ADR-004).
 *
 * O download é autenticado via `http.getBinary` (herdando retry/TLS e erros
 * tipados) na rota `/attachments/download/<id>/<filename>`; o `filename` é
 * percent-encoded na URL e NÃO é usado no caminho em disco (só a extensão
 * sanitizada). A escrita é atômica (`.part` + `rename`) e idempotente (não
 * re-baixa se o mesmo `id + digest` já existe).
 *
 * @param http - Client HTTP autenticado da instância — ver {@link HttpClient}.
 * @param attachment - Anexo a baixar — ver {@link Attachment}.
 * @param options - Diretório de cache e URL da instância — ver {@link DownloadAttachmentOptions}.
 * @returns Caminho absoluto do arquivo `original<ext>` gravado.
 * @throws {RedmineNotFoundError} Se o anexo não existir (404).
 * @throws {RedmineHttpError} Em qualquer outro erro HTTP do download.
 * @throws {Error} Se o stream falhar durante a escrita (o `.part` é removido).
 * @example
 * const file = await downloadAttachment(http, attachment, {
 *   cacheDir: '~/.cache/redmine-context',
 *   instanceUrl: 'https://redmine.example',
 * });
 */
export async function downloadAttachment(
  http: HttpClient,
  attachment: Attachment,
  options: DownloadAttachmentOptions,
): Promise<string> {
  const dir = join(
    options.cacheDir,
    instanceHash(options.instanceUrl),
    ATTACHMENTS_DIR,
    `${attachment.id}-${digest8For(attachment)}`,
  );
  const finalPath = join(dir, `${ORIGINAL_BASENAME}${safeExtension(attachment.filename)}`);

  // Idempotência: anexos são imutáveis; se já baixamos este id+digest, reusa.
  if (await pathExists(finalPath)) {
    return finalPath;
  }

  await mkdir(dir, { recursive: true });

  // O filename entra na URL (percent-encoded) — nunca no path em disco. `%2F`
  // impede que um `/` no filename altere a rota do servidor.
  const downloadPath = `/attachments/download/${attachment.id}/${encodeURIComponent(attachment.filename)}`;
  const stream = await http.getBinary(downloadPath);

  // Escreve-e-renomeia: o destino só surge, completo, após o rename atômico.
  const partPath = `${finalPath}.${createHash('sha256').update(String(Date.now() + Math.random())).digest('hex').slice(0, 12)}.part`;
  try {
    await pipeline(toChunks(stream), createWriteStream(partPath));
    await rename(partPath, finalPath);
  } catch (error) {
    // Nunca deixa conteúdo parcial para trás em caso de falha do stream/IO.
    await rm(partPath, { force: true });
    throw error;
  }

  return finalPath;
}
