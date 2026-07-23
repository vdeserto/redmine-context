/**
 * Testes do download de anexo (M3-06, ADR-004 + segurança do plano).
 *
 * Cobrem o contrato observável de {@link downloadAttachment}: escrita atômica no
 * layout `<cache_dir>/<instance_hash>/attachments/<id>-<digest8>/original<ext>`,
 * idempotência (não rebaixa o mesmo id+digest), contenção de path-traversal (o
 * filename do Redmine NUNCA entra no path — só a extensão sanitizada), limpeza do
 * `.part` em erro e propagação do erro tipado (404). O client HTTP é mockado: seu
 * `getBinary` devolve um `ReadableStream<Uint8Array>` controlado pelo teste.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Attachment } from '../../src/contract.js';
import { instanceHash } from '../../src/cache/index.js';
import { RedmineNotFoundError, type HttpClient } from '../../src/client/index.js';
import { downloadAttachment } from '../../src/extract/index.js';

const INSTANCE_URL = 'https://redmine.example';

/** Anexo base de teste; sobrescrevível por campo. */
function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 7,
    filename: 'photo.png',
    filesize: 1024,
    created_on: '2026-07-20T00:00:00Z',
    content_url: 'https://redmine.example/attachments/download/7/photo.png',
    digest: 'deadbeefcafe1234',
    ...overrides,
  };
}

/** ReadableStream a partir de chunks fixos (bytes). */
function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

/** ReadableStream que falha na leitura (simula corte de rede no meio). */
function failingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    pull(controller) {
      controller.error(new Error('conexão perdida'));
    },
  });
}

/** Client HTTP falso: só `getBinary` importa aqui. */
function fakeHttp(getBinary: HttpClient['getBinary']): HttpClient {
  return {
    get: vi.fn(),
    getBinary,
  };
}

/** Diretório de cache correspondente ao layout ADR-004 para um anexo hex. */
function attachmentDir(cacheDir: string, attachment: Attachment): string {
  const digest8 = (attachment.digest ?? '').slice(0, 8);
  return join(cacheDir, instanceHash(INSTANCE_URL), 'attachments', `${attachment.id}-${digest8}`);
}

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'rc-download-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('downloadAttachment: escrita e layout (ADR-004)', () => {
  it('baixa e grava em <id>-<digest8>/original<ext> com o conteúdo correto', async () => {
    const attachment = makeAttachment();
    const getBinary = vi.fn().mockResolvedValue(streamOf(new Uint8Array([1, 2, 3, 4])));
    const http = fakeHttp(getBinary);

    const path = await downloadAttachment(http, attachment, { cacheDir, instanceUrl: INSTANCE_URL });

    const expected = join(attachmentDir(cacheDir, attachment), 'original.png');
    expect(path).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    expect(readFileSync(expected)).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('baixa via /attachments/download/<id>/<filename> autenticado (reusa o client)', async () => {
    const attachment = makeAttachment();
    const getBinary = vi.fn().mockResolvedValue(streamOf(new Uint8Array([9])));
    await downloadAttachment(fakeHttp(getBinary), attachment, { cacheDir, instanceUrl: INSTANCE_URL });

    expect(getBinary).toHaveBeenCalledTimes(1);
    const requestedPath = getBinary.mock.calls[0]?.[0] as string;
    expect(requestedPath).toContain('/attachments/download/7/');
  });

  it('concatena múltiplos chunks do stream na ordem correta', async () => {
    const attachment = makeAttachment();
    const stream = streamOf(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5]));
    const path = await downloadAttachment(fakeHttp(vi.fn().mockResolvedValue(stream)), attachment, {
      cacheDir,
      instanceUrl: INSTANCE_URL,
    });
    expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3, 4, 5]));
  });

  it('não deixa arquivos .part após um download bem-sucedido', async () => {
    const attachment = makeAttachment();
    await downloadAttachment(fakeHttp(vi.fn().mockResolvedValue(streamOf(new Uint8Array([1])))), attachment, {
      cacheDir,
      instanceUrl: INSTANCE_URL,
    });
    const leftovers = readdirSync(attachmentDir(cacheDir, attachment)).filter((n) => n.endsWith('.part'));
    expect(leftovers).toHaveLength(0);
  });
});

describe('downloadAttachment: extensão sanitizada', () => {
  it('normaliza a extensão para lowercase', async () => {
    const attachment = makeAttachment({ filename: 'DOC.PDF' });
    const path = await downloadAttachment(
      fakeHttp(vi.fn().mockResolvedValue(streamOf(new Uint8Array([1])))),
      attachment,
      { cacheDir, instanceUrl: INSTANCE_URL },
    );
    expect(path.endsWith('/original.pdf')).toBe(true);
  });

  it('usa .bin quando não há extensão', async () => {
    const attachment = makeAttachment({ filename: 'noextension' });
    const path = await downloadAttachment(
      fakeHttp(vi.fn().mockResolvedValue(streamOf(new Uint8Array([1])))),
      attachment,
      { cacheDir, instanceUrl: INSTANCE_URL },
    );
    expect(path.endsWith('/original.bin')).toBe(true);
  });

  it('usa .bin quando a extensão é inválida (não [a-z0-9]{1,8})', async () => {
    const attachment = makeAttachment({ filename: 'weird.tar!!' });
    const path = await downloadAttachment(
      fakeHttp(vi.fn().mockResolvedValue(streamOf(new Uint8Array([1])))),
      attachment,
      { cacheDir, instanceUrl: INSTANCE_URL },
    );
    expect(path.endsWith('/original.bin')).toBe(true);
  });

  it('usa .bin quando a extensão excede 8 caracteres', async () => {
    const attachment = makeAttachment({ filename: 'a.superlongext' });
    const path = await downloadAttachment(
      fakeHttp(vi.fn().mockResolvedValue(streamOf(new Uint8Array([1])))),
      attachment,
      { cacheDir, instanceUrl: INSTANCE_URL },
    );
    expect(path.endsWith('/original.bin')).toBe(true);
  });
});

describe('downloadAttachment: segurança anti path-traversal', () => {
  it('filename ../../../evil.sh NÃO escreve fora do cacheDir (só a extensão entra no path)', async () => {
    const attachment = makeAttachment({ filename: '../../../evil.sh' });
    const path = await downloadAttachment(
      fakeHttp(vi.fn().mockResolvedValue(streamOf(new Uint8Array([1])))),
      attachment,
      { cacheDir, instanceUrl: INSTANCE_URL },
    );

    // Caminho contido no cacheDir e derivado só de id+digest+extensão.
    expect(path.startsWith(cacheDir)).toBe(true);
    // '.sh' é válido pela regex, mas o filename inteiro nunca vira path.
    expect(path).toBe(join(attachmentDir(cacheDir, attachment), 'original.sh'));
    expect(path).not.toContain('evil');
    expect(existsSync(path)).toBe(true);
  });
});

describe('downloadAttachment: idempotência', () => {
  it('não baixa de novo se o arquivo (mesmo id+digest) já existe', async () => {
    const attachment = makeAttachment();
    const first = vi.fn().mockResolvedValue(streamOf(new Uint8Array([1, 2, 3])));
    const path = await downloadAttachment(fakeHttp(first), attachment, { cacheDir, instanceUrl: INSTANCE_URL });

    const second = vi.fn().mockResolvedValue(streamOf(new Uint8Array([9, 9, 9])));
    const again = await downloadAttachment(fakeHttp(second), attachment, { cacheDir, instanceUrl: INSTANCE_URL });

    expect(again).toBe(path);
    expect(second).not.toHaveBeenCalled();
    // Conteúdo original preservado (não sobrescrito).
    expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3]));
  });
});

describe('downloadAttachment: erros e limpeza', () => {
  it('remove o .part e não cria o arquivo final quando o stream falha', async () => {
    const attachment = makeAttachment();
    const http = fakeHttp(vi.fn().mockResolvedValue(failingStream()));

    await expect(
      downloadAttachment(http, attachment, { cacheDir, instanceUrl: INSTANCE_URL }),
    ).rejects.toThrow(/conexão perdida/);

    const dir = attachmentDir(cacheDir, attachment);
    const files = existsSync(dir) ? readdirSync(dir) : [];
    expect(files.filter((n) => n.endsWith('.part'))).toHaveLength(0);
    expect(existsSync(join(dir, 'original.png'))).toBe(false);
  });

  it('propaga 404 tipado (RedmineNotFoundError) sem deixar resíduo', async () => {
    const attachment = makeAttachment();
    const http = fakeHttp(
      vi.fn().mockRejectedValue(new RedmineNotFoundError('GET ... 404', 404, 'https://x')),
    );

    await expect(
      downloadAttachment(http, attachment, { cacheDir, instanceUrl: INSTANCE_URL }),
    ).rejects.toBeInstanceOf(RedmineNotFoundError);

    const dir = attachmentDir(cacheDir, attachment);
    expect(existsSync(dir) ? readdirSync(dir) : []).toHaveLength(0);
  });
});

describe('downloadAttachment: derivação do digest no path', () => {
  it('sem digest (Redmine < 4.x) deriva um digest8 hex determinístico', async () => {
    const attachment = makeAttachment({ digest: undefined });
    const path = await downloadAttachment(
      fakeHttp(vi.fn().mockResolvedValue(streamOf(new Uint8Array([1])))),
      attachment,
      { cacheDir, instanceUrl: INSTANCE_URL },
    );
    const material = [attachment.id, attachment.filesize, attachment.created_on].join('\0');
    const digest8 = createHash('sha256').update(material).digest('hex').slice(0, 8);
    expect(path).toContain(`${attachment.id}-${digest8}`);
  });

  it('digest não-hex é normalizado por sha256 (nunca vira path bruto)', async () => {
    const attachment = makeAttachment({ digest: '../../../etc' });
    const path = await downloadAttachment(
      fakeHttp(vi.fn().mockResolvedValue(streamOf(new Uint8Array([1])))),
      attachment,
      { cacheDir, instanceUrl: INSTANCE_URL },
    );
    expect(path.startsWith(cacheDir)).toBe(true);
    expect(path).not.toContain('..');
    const digest8 = createHash('sha256').update('../../../etc').digest('hex').slice(0, 8);
    expect(path).toContain(`${attachment.id}-${digest8}`);
  });
});
