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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/** Opções de {@link makeDeps}: estado inicial de um `.part` parcial (retomada). */
interface MakeDepsOptions {
  /** Tamanho reportado por `statPart` (bytes do `.part` existente), ou ausente. */
  readonly partSize?: number;
  /** Conteúdo devolvido por `readPart` (bytes já gravados no `.part`). */
  readonly partBytes?: Uint8Array;
}

/** Monta um conjunto de deps injetáveis com spies, com `fetch` configurável. */
function makeDeps(
  fetchImpl: GgufDeps['fetch'],
  partState: MakeDepsOptions = {},
): {
  deps: GgufDeps;
  fetch: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  appendFile: ReturnType<typeof vi.fn>;
  readPart: ReturnType<typeof vi.fn>;
  statPart: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  const fetch = vi.fn(fetchImpl);
  const mkdir = vi.fn(async () => {});
  const writeFile = vi.fn(async () => {});
  const appendFile = vi.fn(async () => {});
  const readPart = vi.fn(async () => partState.partBytes ?? new Uint8Array());
  const statPart = vi.fn(async () => partState.partSize);
  const rename = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  return {
    deps: { fetch, mkdir, writeFile, appendFile, readPart, statPart, rename, rm: remove },
    fetch,
    mkdir,
    writeFile,
    appendFile,
    readPart,
    statPart,
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

  it('recusa URL malformada como insecure-url (não vaza TypeError cru)', async () => {
    const h = makeDeps(okFetch);
    await expect(
      downloadGgufModel({
        url: 'nao-e-uma-url',
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

describe('extract/gguf: retomada via HTTP Range (#59)', () => {
  it('sem .part existente: comportamento #58 intacto (sem Range, write do zero)', async () => {
    const h = makeDeps(okFetch); // statPart → undefined (partSize ausente)
    const finalPath = join('/models', GGUF_MODEL_NAME);
    const result = await downloadGgufModel({
      url: 'https://huggingface.co/model.bin',
      sha256: FIXTURE_SHA256,
      destDir: '/models',
      deps: h.deps,
    });

    expect(result).toBe(finalPath);
    // Nenhum cabeçalho Range quando não há parcial: baixa o corpo inteiro.
    expect(h.fetch).toHaveBeenCalledWith('https://huggingface.co/model.bin');
    expect(h.writeFile).toHaveBeenCalledWith(`${finalPath}.part`, FIXTURE);
    expect(h.appendFile).not.toHaveBeenCalled();
    expect(h.rename).toHaveBeenCalledWith(`${finalPath}.part`, finalPath);
  });

  it('.part parcial (N bytes): manda Range bytes=N-, anexa o 206 e valida o TOTAL', async () => {
    const prefix = FIXTURE.slice(0, 3); // já gravado no .part
    const rest = FIXTURE.slice(3); // o servidor devolve só o restante
    let seenInit: unknown;
    const rangeFetch: GgufDeps['fetch'] = async (_url, init) => {
      seenInit = init;
      return new Response(rest, { status: 206 });
    };
    const h = makeDeps(rangeFetch, { partSize: 3, partBytes: prefix });
    const finalPath = join('/models', GGUF_MODEL_NAME);

    const result = await downloadGgufModel({
      url: 'https://huggingface.co/model.bin',
      sha256: FIXTURE_SHA256, // hash do FIXTURE COMPLETO (prefix + rest)
      destDir: '/models',
      deps: h.deps,
    });

    expect(result).toBe(finalPath);
    // Pediu exatamente a partir do byte N=3.
    expect(seenInit).toEqual({ headers: { Range: 'bytes=3-' } });
    // ANEXA o restante (não regrava o prefixo), rename após checksum do total.
    expect(h.appendFile).toHaveBeenCalledWith(`${finalPath}.part`, rest);
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.rename).toHaveBeenCalledWith(`${finalPath}.part`, finalPath);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('servidor IGNORA o Range (responde 200 inteiro): recomeça do zero sem corromper', async () => {
    // .part tem 3 bytes, mas o 200 traz o corpo COMPLETO → regrava, não anexa.
    const h = makeDeps(async () => new Response(FIXTURE, { status: 200 }), {
      partSize: 3,
      partBytes: FIXTURE.slice(0, 3),
    });
    const finalPath = join('/models', GGUF_MODEL_NAME);

    const result = await downloadGgufModel({
      url: 'https://huggingface.co/model.bin',
      sha256: FIXTURE_SHA256,
      destDir: '/models',
      deps: h.deps,
    });

    expect(result).toBe(finalPath);
    // Fallback: sobrescreve o .part com o corpo inteiro (write, nunca append).
    expect(h.writeFile).toHaveBeenCalledWith(`${finalPath}.part`, FIXTURE);
    expect(h.appendFile).not.toHaveBeenCalled();
    expect(h.rename).toHaveBeenCalledWith(`${finalPath}.part`, finalPath);
  });

  it('checksum do TOTAL diverge após retomada: DESCARTA o .part e não renomeia', async () => {
    const prefix = FIXTURE.slice(0, 3);
    const badRest = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]); // corrompe o total
    const h = makeDeps(async () => new Response(badRest, { status: 206 }), {
      partSize: 3,
      partBytes: prefix,
    });
    const finalPath = join('/models', GGUF_MODEL_NAME);

    const promise = downloadGgufModel({
      url: 'https://huggingface.co/model.bin',
      sha256: FIXTURE_SHA256,
      destDir: '/models',
      deps: h.deps,
    });

    await expect(promise).rejects.toMatchObject({ code: 'checksum-mismatch' });
    expect(h.remove).toHaveBeenCalledWith(`${finalPath}.part`);
    expect(h.rename).not.toHaveBeenCalled();
  });

  it('.part inservível (416 Range Not Satisfiable): descarta e recomeça limpo', async () => {
    let calls = 0;
    const inits: unknown[] = [];
    const flakyFetch: GgufDeps['fetch'] = async (_url, init) => {
      inits.push(init);
      calls += 1;
      // 1ª tentativa (com Range) → 416; 2ª (sem Range) → corpo inteiro 200.
      return calls === 1
        ? new Response(null, { status: 416 })
        : new Response(FIXTURE, { status: 200 });
    };
    const h = makeDeps(flakyFetch, { partSize: 99, partBytes: new Uint8Array([0xde]) });
    const finalPath = join('/models', GGUF_MODEL_NAME);

    const result = await downloadGgufModel({
      url: 'https://huggingface.co/model.bin',
      sha256: FIXTURE_SHA256,
      destDir: '/models',
      deps: h.deps,
    });

    expect(result).toBe(finalPath);
    expect(calls).toBe(2);
    // Primeiro com Range, depois sem — e o .part poison foi removido no meio.
    expect(inits[0]).toEqual({ headers: { Range: 'bytes=99-' } });
    expect(inits[1]).toBeUndefined();
    expect(h.remove).toHaveBeenCalledWith(`${finalPath}.part`);
    expect(h.writeFile).toHaveBeenCalledWith(`${finalPath}.part`, FIXTURE);
    expect(h.rename).toHaveBeenCalledWith(`${finalPath}.part`, finalPath);
  });

  it('.part vazio (0 bytes) não dispara Range — trata como download novo', async () => {
    const h = makeDeps(okFetch, { partSize: 0 });
    const result = await downloadGgufModel({
      url: 'https://huggingface.co/model.bin',
      sha256: FIXTURE_SHA256,
      destDir: '/models',
      deps: h.deps,
    });
    expect(result).toBe(join('/models', GGUF_MODEL_NAME));
    expect(h.fetch).toHaveBeenCalledWith('https://huggingface.co/model.bin');
    expect(h.appendFile).not.toHaveBeenCalled();
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

  it('retoma um .part parcial REAL: statPart/readPart/appendFile default anexam o 206', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rc-gguf-'));
    // Pré-grava um .part com os 3 primeiros bytes — como um download interrompido.
    const partPath = join(dir, `${GGUF_MODEL_NAME}.part`);
    await writeFile(partPath, FIXTURE.slice(0, 3));

    let seenRange: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
        seenRange = init?.headers?.Range ?? null;
        // Servidor honra o Range: 206 com APENAS os bytes a partir de N=3.
        return new Response(FIXTURE.slice(3), { status: 206 });
      }),
    );
    try {
      const result = await downloadGgufModel({
        url: 'https://huggingface.co/model.bin',
        sha256: FIXTURE_SHA256,
        destDir: dir,
      });
      expect(seenRange).toBe('bytes=3-');
      // O arquivo final é o FIXTURE completo (prefixo + bytes anexados).
      const written = new Uint8Array(await readFile(result));
      expect(written).toEqual(FIXTURE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
