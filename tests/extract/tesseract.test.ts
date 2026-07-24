/**
 * Testes unitários do extrator tesseract (M3-09, ADR-002) com `execFile` e
 * `fs.accessSync` MOCKADOS — nenhum binário real é chamado aqui (o teste de
 * integração REAL vive em `tesseract.integration.test.ts`, opt-in).
 *
 * Provam: args corretos (lang/psm/stdout), env SANITIZADO (sem `REDMINE_API_KEY`),
 * timeout → `SIGTERM`+`SIGKILL`, erro de execução → `failed`, binário ausente →
 * `failed` sem lançar, {@link findTesseract} (PATH e ausência), detecção de versão,
 * e a composição de {@link createTesseractExtractor}/{@link createDefaultRegistry}.
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
  createDefaultRegistry,
  createTesseractExtractor,
  detectTesseractVersion,
  findTesseract,
  TesseractExtractor,
} from '../../src/extract/tesseract.js';

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

describe('TesseractExtractor.extract: sucesso e argumentos', () => {
  it('invoca execFile SEM shell com args corretos (lang, psm, stdout) e devolve done', async () => {
    stubExec((cb) => queueMicrotask(() => cb(null, '  HELLO\n', '')));
    const extractor = new TesseractExtractor({ binaryPath: '/opt/tesseract', version: 'tesseract-5.5.2' });

    const result = await extractor.extract('/cache/img.png', { mime: 'image/png' });

    expect(result.status).toBe('done');
    expect(result.text).toBe('HELLO'); // trim aplicado
    expect(result.mime).toBe('image/png');

    const { file, args } = lastExecCall();
    expect(file).toBe('/opt/tesseract');
    expect(args).toEqual(['/cache/img.png', 'stdout', '-l', 'por+eng', '--psm', '3']);
  });

  it('respeita lang/psm customizados (que também alimentam params da chave de cache)', async () => {
    stubExec((cb) => queueMicrotask(() => cb(null, 'texto', '')));
    const extractor = new TesseractExtractor({
      binaryPath: '/opt/tesseract',
      version: 'v1',
      lang: 'eng',
      psm: 6,
    });

    await extractor.extract('/cache/x.png', { mime: 'image/png' });

    expect(lastExecCall().args).toEqual(['/cache/x.png', 'stdout', '-l', 'eng', '--psm', '6']);
    expect(extractor.params).toEqual({ lang: 'eng', psm: 6 });
    expect(extractor.extractorConfig).toEqual({
      version: 'v1',
      model: 'tesseract',
      params: { lang: 'eng', psm: 6 },
    });
  });

  it('SANITIZA o env do subprocesso: repassa PATH mas NUNCA segredos do pai', async () => {
    const previous = process.env.REDMINE_API_KEY;
    process.env.REDMINE_API_KEY = 'super-secreto';
    try {
      stubExec((cb) => queueMicrotask(() => cb(null, 'ok', '')));
      const extractor = new TesseractExtractor({ binaryPath: '/opt/tesseract', version: 'v1' });

      await extractor.extract('/cache/x.png', { mime: 'image/png' });

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

describe('TesseractExtractor.extract: falhas graciosas', () => {
  it('binário ausente (binaryPath undefined) → failed com motivo de instalação, avisa e NÃO lança', async () => {
    const extractor = new TesseractExtractor({ binaryPath: undefined, version: 'tesseract-integration-1' });
    const logger = { warn: vi.fn() };

    const result = await extractor.extract('/cache/x.png', { mime: 'image/png', logger });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('tesseract-nao-instalado');
    expect(result.metadata?.hint).toBeDefined();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('erro de execução (exit != 0) → failed com reason erro-execucao', async () => {
    stubExec((cb) => queueMicrotask(() => cb(new Error('exit 1'), '', 'boom')));
    const extractor = new TesseractExtractor({ binaryPath: '/opt/tesseract', version: 'v1' });

    const result = await extractor.extract('/cache/x.png', { mime: 'image/png' });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('erro-execucao');
    expect(result.metadata?.error).toContain('exit 1');
  });

  it('timeout → SIGTERM e, após a graça, SIGKILL; resultado failed com reason timeout', async () => {
    vi.useFakeTimers();
    // Nunca chama o callback: simula um tesseract travado.
    const child = stubExec(() => undefined);
    const extractor = new TesseractExtractor({
      binaryPath: '/opt/tesseract',
      version: 'v1',
      timeoutMs: 1_000,
      killGraceMs: 500,
    });

    const promise = extractor.extract('/cache/x.png', { mime: 'image/png' });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    const result = await promise;
    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('timeout');
  });
});

describe('findTesseract', () => {
  it('encontra o binário no PATH (checado antes dos locais convencionais)', () => {
    const dir = '/custom/bin';
    const previous = process.env.PATH;
    process.env.PATH = dir;
    const expected = join(dir, process.platform === 'win32' ? 'tesseract.exe' : 'tesseract');
    // accessSync só "existe" para o caminho esperado.
    mockAccessSync.mockImplementation((path) => {
      if (path === expected) return;
      throw new Error('ENOENT');
    });
    try {
      expect(findTesseract()).toEqual({ path: expected });
    } finally {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
    }
  });

  it('retorna undefined quando nenhum candidato é executável', () => {
    // accessSync sempre lança (default do beforeEach) → nada encontrado.
    expect(findTesseract()).toBeUndefined();
  });
});

describe('detectTesseractVersion', () => {
  it('parseia a versão da primeira linha de `tesseract --version`', async () => {
    stubExec((cb) => queueMicrotask(() => cb(null, 'tesseract 5.5.2\n leptonica-1.87.0\n', '')));
    expect(await detectTesseractVersion('/opt/tesseract')).toBe('5.5.2');
  });

  it('retorna undefined se o binário falhar ou a saída for inesperada', async () => {
    stubExec((cb) => queueMicrotask(() => cb(new Error('não achou'), '', '')));
    expect(await detectTesseractVersion('/opt/tesseract')).toBeUndefined();

    stubExec((cb) => queueMicrotask(() => cb(null, 'saída sem versão', '')));
    expect(await detectTesseractVersion('/opt/tesseract')).toBeUndefined();
  });
});

describe('createTesseractExtractor / createDefaultRegistry', () => {
  it('sem binário instalado → version cai na versão da integração e degrada em extract', async () => {
    const extractor = await createTesseractExtractor();
    expect(extractor.version).toBe('tesseract-integration-1');

    const result = await extractor.extract('/cache/x.png', { mime: 'image/png' });
    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('tesseract-nao-instalado');
  });

  it('com binário detectável → version derivada do binário (tesseract-<X.Y.Z>)', async () => {
    mockAccessSync.mockImplementation(() => undefined); // primeiro candidato serve
    stubExec((cb) => queueMicrotask(() => cb(null, 'tesseract 5.5.2\n', '')));

    const extractor = await createTesseractExtractor();
    expect(extractor.version).toBe('tesseract-5.5.2');
  });

  it('createDefaultRegistry registra o tesseract para os MIMEs de imagem e o pdftotext para PDF', async () => {
    const registry = await createDefaultRegistry();
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(registry.find(mime)?.id).toBe('tesseract-ocr');
    }
    expect(registry.find('application/pdf')?.id).toBe('pdftotext');
  });
});
