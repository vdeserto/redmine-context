/**
 * Testes do download do modelo GGUF do whisper.cpp com verificação de integridade
 * (M4-02, #58, ADR-002). Escritos ANTES da implementação (TDD). Todas as deps
 * (fetch/fs) são INJETADAS — nenhum acesso real a rede ou ao filesystem do usuário
 * (o único teste que toca o disco usa um diretório temporário isolado + `fetch`
 * global stubado, sem rede). Provam: guard headless recusa antes de qualquer IO;
 * apenas HTTPS é aceito; checksum válido grava e renomeia; checksum divergente
 * DESCARTA o `.part` e lança erro claro (esperado vs. obtido); e o destino default
 * é o {@link whisperModelDir} (`<cache>/models`), ponto único de verdade da M4.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  downloadGgufModel,
  GGUF_MODEL_NAME,
  GGUF_MODEL_SHA256,
  GGUF_MODEL_URL,
  GgufDownloadError,
  type GgufDeps,
} from '../../src/extract/gguf.js';
import { whisperModelDir } from '../../src/extract/whisper.js';

/** Buffer determinístico usado como "modelo baixado" nas provas de checksum. */
const FIXTURE = new Uint8Array([0x67, 0x67, 0x6d, 0x6c, 0x00, 0x01, 0x02, 0x03]);

/** SHA-256 hex real do {@link FIXTURE} — computado, nunca hardcoded. */
const FIXTURE_SHA256 = createHash('sha256').update(FIXTURE).digest('hex');

/** Monta um conjunto de deps injetáveis com spies, com `fetch` configurável. */
function makeDeps(fetchImpl: GgufDeps['fetch']): {
  deps: GgufDeps;
  fetch: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  const fetch = vi.fn(fetchImpl);
  const mkdir = vi.fn(async () => {});
  const writeFile = vi.fn(async () => {});
  const rename = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  return {
    deps: { fetch, mkdir, writeFile, rename, rm: remove },
    fetch,
    mkdir,
    writeFile,
    rename,
    remove,
  };
}

/** `fetch` que devolve o {@link FIXTURE} com `200 OK`. */
const okFetch: GgufDeps['fetch'] = async () => new Response(FIXTURE, { status: 200 });

describe('extract/gguf: constantes pinadas', () => {
  it('pinna uma URL HTTPS oficial e um SHA-256 de 64 hex', () => {
    expect(GGUF_MODEL_URL.startsWith('https://')).toBe(true);
    expect(GGUF_MODEL_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(GGUF_MODEL_NAME).toMatch(/\.bin$/);
  });
});

describe('extract/gguf: guard headless (MCP)', () => {
  it('recusa o download em ambiente headless ANTES de qualquer IO', async () => {
    const h = makeDeps(okFetch);
    await expect(
      downloadGgufModel({ headless: true, destDir: '/models', deps: h.deps }),
    ).rejects.toMatchObject({ code: 'headless' });
    // Nenhuma rede nem escrita: é opt-in interativo (ADR-002).
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it('a mensagem do guard é acionável (menciona opt-in interativo)', async () => {
    const h = makeDeps(okFetch);
    await expect(
      downloadGgufModel({ headless: true, destDir: '/models', deps: h.deps }),
    ).rejects.toThrow(/interativ|--download-binaries/i);
  });
});

describe('extract/gguf: apenas HTTPS', () => {
  it('recusa URL http:// sem tocar a rede', async () => {
    const h = makeDeps(okFetch);
    await expect(
      downloadGgufModel({
        url: 'http://huggingface.co/model.bin',
        destDir: '/models',
        deps: h.deps,
      }),
    ).rejects.toMatchObject({ code: 'insecure-url' });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('extract/gguf: verificação de checksum', () => {
  it('aceita e grava quando o SHA-256 confere (write + rename atômico)', async () => {
    const h = makeDeps(okFetch);
    const result = await downloadGgufModel({
      url: 'https://huggingface.co/model.bin',
      sha256: FIXTURE_SHA256,
      destDir: '/models',
      deps: h.deps,
    });

    const finalPath = join('/models', GGUF_MODEL_NAME);
    expect(result).toBe(finalPath);
    expect(h.mkdir).toHaveBeenCalledWith('/models');
    expect(h.writeFile).toHaveBeenCalledWith(`${finalPath}.part`, FIXTURE);
    expect(h.rename).toHaveBeenCalledWith(`${finalPath}.part`, finalPath);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('DESCARTA o arquivo e lança erro claro quando o checksum diverge', async () => {
    const wrong = 'f'.repeat(64);
    const h = makeDeps(okFetch);

    const finalPath = join('/models', GGUF_MODEL_NAME);
    const promise = downloadGgufModel({
      url: 'https://huggingface.co/model.bin',
      sha256: wrong,
      destDir: '/models',
      deps: h.deps,
    });

    await expect(promise).rejects.toBeInstanceOf(GgufDownloadError);
    await expect(promise).rejects.toMatchObject({ code: 'checksum-mismatch' });
    // A mensagem menciona esperado vs. obtido (ambos são hashes, não paths).
    await expect(promise).rejects.toThrow(new RegExp(wrong));
    await expect(promise).rejects.toThrow(new RegExp(FIXTURE_SHA256));
    // O `.part` corrompido é removido; o destino final NUNCA aparece.
    expect(h.remove).toHaveBeenCalledWith(`${finalPath}.part`);
    expect(h.rename).not.toHaveBeenCalled();
  });
});

describe('extract/gguf: erro HTTP', () => {
  it('lança quando a resposta não é 2xx', async () => {
    const h = makeDeps(async () => new Response(null, { status: 404 }));
    await expect(
      downloadGgufModel({
        url: 'https://huggingface.co/model.bin',
        destDir: '/models',
        deps: h.deps,
      }),
    ).rejects.toMatchObject({ code: 'http-error' });
    expect(h.writeFile).not.toHaveBeenCalled();
  });
});

describe('extract/gguf: destino default', () => {
  it('grava em whisperModelDir() (<cache>/models) quando destDir é omitido', async () => {
    const h = makeDeps(okFetch);
    const result = await downloadGgufModel({
      url: 'https://huggingface.co/model.bin',
      sha256: FIXTURE_SHA256,
      deps: h.deps,
    });
    expect(result).toBe(join(whisperModelDir(), GGUF_MODEL_NAME));
  });
});

describe('extract/gguf: deps default (fs real, fetch stubado, sem rede)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('usa fetch global + node:fs num diretório temporário isolado', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rc-gguf-'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(FIXTURE, { status: 200 })),
    );
    try {
      const result = await downloadGgufModel({
        url: 'https://huggingface.co/model.bin',
        sha256: FIXTURE_SHA256,
        destDir: dir,
      });
      expect(result).toBe(join(dir, GGUF_MODEL_NAME));
      const written = new Uint8Array(await readFile(result));
      expect(written).toEqual(FIXTURE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
