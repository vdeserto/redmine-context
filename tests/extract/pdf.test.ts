/**
 * Testes unitários do extrator de PDF via `pdftotext` (#145, ADR-002) com
 * `execFile` e `fs.accessSync` MOCKADOS — nenhum binário real é chamado aqui (o
 * teste de integração REAL vive em `pdf.integration.test.ts`, opt-in).
 *
 * Provam: args corretos (`-enc UTF-8 <file> -`, `-layout` opcional), env
 * SANITIZADO (sem `REDMINE_API_KEY`), timeout → `SIGTERM`+`SIGKILL`, erro de
 * execução → `failed`, binário ausente → `failed` (com hint de instalação) sem
 * lançar, PDF SEM CAMADA DE TEXTO (saída vazia/whitespace) → `failed` com
 * `reason: 'pdf-sem-camada-de-texto'` (hint de OCR), {@link findPdftotext} (PATH e
 * ausência), detecção de versão (via STDERR) e a composição de
 * {@link createPdfExtractor}.
 */

import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock do child_process: capturamos a última chamada e controlamos o child.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
// Mock parcial do fs: só interceptamos accessSync (detecção do binário).
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, accessSync: vi.fn() };
});

import { execFile } from 'node:child_process';
import { accessSync } from 'node:fs';

import {
  createPdfExtractor,
  detectPdftotextVersion,
  findPdftotext,
  PdfExtractor,
} from '../../src/extract/pdf.js';

/** Referências tipadas aos mocks. */
const mockExecFile = vi.mocked(execFile);
const mockAccessSync = vi.mocked(accessSync);

/** Child fake com `kill` espionável; capturado pela última chamada de execFile. */
interface FakeChild {
  kill: ReturnType<typeof vi.fn>;
}

/** Callback do execFile na forma (error, stdout, stderr). */
type ExecCb = (error: Error | null, stdout: string, stderr: string) => void;

/**
 * Configura o mock de execFile para chamar o callback (assíncrono) com um
 * resultado, devolvendo um child fake com `kill`. Retorna o child para asserções.
 */
function stubExec(behavior: (cb: ExecCb) => void): FakeChild {
  const child: FakeChild = { kill: vi.fn() };
  mockExecFile.mockImplementation(((...args: unknown[]): FakeChild => {
    const cb = args[args.length - 1] as ExecCb;
    behavior(cb);
    return child;
  }) as unknown as typeof execFile);
  return child;
}

/** Extrai a última chamada de execFile (file, args, options). */
function lastExecCall(): { file: string; args: string[]; options: { env?: NodeJS.ProcessEnv } } {
  const call = mockExecFile.mock.calls.at(-1);
  if (call === undefined) throw new Error('execFile não foi chamado');
  return {
    file: call[0] as string,
    args: call[1] as string[],
    options: call[2] as { env?: NodeJS.ProcessEnv },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nenhum binário encontrado (accessSync lança) — testes que precisam
  // de binário sobrescrevem por caminho.
  mockAccessSync.mockImplementation(() => {
    throw new Error('ENOENT');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PdfExtractor.extract: sucesso e argumentos', () => {
  it('invoca execFile SEM shell com args corretos (-enc UTF-8 <file> -) e devolve done', async () => {
    stubExec((cb) => queueMicrotask(() => cb(null, '  Olá mundo\n\f', '')));
    const extractor = new PdfExtractor({ binaryPath: '/opt/pdftotext', version: 'pdftotext-24.02.0' });

    const result = await extractor.extract('/cache/doc.pdf', { mime: 'application/pdf' });

    expect(result.status).toBe('done');
    expect(result.text).toBe('Olá mundo'); // trim aplicado (inclui form-feed)
    expect(result.mime).toBe('application/pdf');

    const { file, args } = lastExecCall();
    expect(file).toBe('/opt/pdftotext');
    expect(args).toEqual(['-enc', 'UTF-8', '/cache/doc.pdf', '-']);
  });

  it('layout=true adiciona -layout e alimenta params/extractorConfig da chave de cache', async () => {
    stubExec((cb) => queueMicrotask(() => cb(null, 'texto', '')));
    const extractor = new PdfExtractor({ binaryPath: '/opt/pdftotext', version: 'v1', layout: true });

    await extractor.extract('/cache/x.pdf', { mime: 'application/pdf' });

    expect(lastExecCall().args).toEqual(['-enc', 'UTF-8', '-layout', '/cache/x.pdf', '-']);
    expect(extractor.params).toEqual({ enc: 'UTF-8', layout: true });
    expect(extractor.extractorConfig).toEqual({
      version: 'v1',
      model: 'pdftotext',
      params: { enc: 'UTF-8', layout: true },
    });
  });

  it('SANITIZA o env do subprocesso: repassa PATH mas NUNCA segredos do pai', async () => {
    const previous = process.env.REDMINE_API_KEY;
    process.env.REDMINE_API_KEY = 'super-secreto';
    try {
      stubExec((cb) => queueMicrotask(() => cb(null, 'ok', '')));
      const extractor = new PdfExtractor({ binaryPath: '/opt/pdftotext', version: 'v1' });

      await extractor.extract('/cache/x.pdf', { mime: 'application/pdf' });

      const env = lastExecCall().options.env ?? {};
      expect(env.PATH).toBeDefined();
      expect(env.REDMINE_API_KEY).toBeUndefined();
      expect(Object.keys(env)).not.toContain('REDMINE_API_KEY');
    } finally {
      if (previous === undefined) delete process.env.REDMINE_API_KEY;
      else process.env.REDMINE_API_KEY = previous;
    }
  });
});

describe('PdfExtractor.extract: falhas graciosas', () => {
  it('binário ausente (binaryPath undefined) → failed com hint de instalação, avisa e NÃO lança', async () => {
    const extractor = new PdfExtractor({ binaryPath: undefined, version: 'pdftotext-integration-1' });
    const logger = { warn: vi.fn() };

    const result = await extractor.extract('/cache/x.pdf', { mime: 'application/pdf', logger });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('pdftotext-nao-instalado');
    expect(result.metadata?.hint).toContain('poppler');
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('PDF SEM camada de texto (saída só whitespace/form-feed) → failed com reason pdf-sem-camada-de-texto e hint de OCR', async () => {
    // pdftotext de um PDF escaneado sai 0 mas devolve só form-feed/whitespace.
    stubExec((cb) => queueMicrotask(() => cb(null, '\f\n   \n\f', '')));
    const extractor = new PdfExtractor({ binaryPath: '/opt/pdftotext', version: 'v1' });

    const result = await extractor.extract('/cache/scan.pdf', { mime: 'application/pdf' });

    expect(result.status).toBe('failed');
    expect(result.text).toBeUndefined(); // NÃO mente com { done, text: '' }
    expect(result.metadata?.reason).toBe('pdf-sem-camada-de-texto');
    expect(String(result.metadata?.hint)).toContain('OCR');
  });

  it('erro de execução (exit != 0) → failed com reason erro-execucao', async () => {
    stubExec((cb) => queueMicrotask(() => cb(new Error('exit 1'), '', 'PDF corrompido')));
    const extractor = new PdfExtractor({ binaryPath: '/opt/pdftotext', version: 'v1' });

    const result = await extractor.extract('/cache/x.pdf', { mime: 'application/pdf' });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('erro-execucao');
    expect(result.metadata?.error).toContain('exit 1');
  });

  it('timeout → SIGTERM e, após a graça, SIGKILL; resultado failed com reason timeout', async () => {
    vi.useFakeTimers();
    // Nunca chama o callback: simula um pdftotext travado.
    const child = stubExec(() => undefined);
    const extractor = new PdfExtractor({
      binaryPath: '/opt/pdftotext',
      version: 'v1',
      timeoutMs: 1_000,
      killGraceMs: 500,
    });

    const promise = extractor.extract('/cache/x.pdf', { mime: 'application/pdf' });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    const result = await promise;
    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('timeout');
  });
});

describe('findPdftotext', () => {
  it('encontra o binário no PATH (checado antes dos locais convencionais)', () => {
    const dir = '/custom/bin';
    const previous = process.env.PATH;
    process.env.PATH = dir;
    const expected = join(dir, process.platform === 'win32' ? 'pdftotext.exe' : 'pdftotext');
    mockAccessSync.mockImplementation((path) => {
      if (path === expected) return;
      throw new Error('ENOENT');
    });
    try {
      expect(findPdftotext()).toEqual({ path: expected });
    } finally {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
    }
  });

  it('retorna undefined quando nenhum candidato é executável', () => {
    expect(findPdftotext()).toBeUndefined();
  });
});

describe('detectPdftotextVersion', () => {
  it('parseia a versão do STDERR de `pdftotext -v` (poppler escreve no stderr, exit 0)', async () => {
    stubExec((cb) => queueMicrotask(() => cb(null, '', 'pdftotext version 24.02.0\nCopyright ...\n')));
    expect(await detectPdftotextVersion('/opt/pdftotext')).toBe('24.02.0');
  });

  it('retorna undefined se o binário falhar e nenhuma versão for legível', async () => {
    stubExec((cb) => queueMicrotask(() => cb(new Error('não achou'), '', '')));
    expect(await detectPdftotextVersion('/opt/pdftotext')).toBeUndefined();

    stubExec((cb) => queueMicrotask(() => cb(null, '', 'saída sem versão')));
    expect(await detectPdftotextVersion('/opt/pdftotext')).toBeUndefined();
  });
});

describe('createPdfExtractor', () => {
  it('sem binário instalado → version cai na versão da integração e degrada em extract', async () => {
    const extractor = await createPdfExtractor();
    expect(extractor.version).toBe('pdftotext-integration-1');
    expect(extractor.supportedMimes).toEqual(['application/pdf']);

    const result = await extractor.extract('/cache/x.pdf', { mime: 'application/pdf' });
    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('pdftotext-nao-instalado');
  });

  it('com binário detectável → version derivada do binário (pdftotext-<X.Y.Z>)', async () => {
    mockAccessSync.mockImplementation(() => undefined); // primeiro candidato serve
    stubExec((cb) => queueMicrotask(() => cb(null, '', 'pdftotext version 24.02.0\n')));

    const extractor = await createPdfExtractor();
    expect(extractor.version).toBe('pdftotext-24.02.0');
  });
});
