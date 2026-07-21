import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock parcial da superfície do core: preserva as classes de erro reais (para o
// `instanceof` do mapeamento de exit codes funcionar) e mocka apenas as funções.
vi.mock('../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/index.js')>();
  return {
    ...actual,
    fetchIssueBundle: vi.fn(),
    resolveApiKey: vi.fn(),
    loginWithPassword: vi.fn(),
    createCredentialCascade: vi.fn(),
  };
});

import * as core from '../../../src/index.js';
import type { CoreEvent, IssueBundleResult } from '../../../src/index.js';
import { run } from '../../../src/surfaces/cli/main.js';

/** Captura stdout/stderr e injeta prompts controláveis. */
function harness(overrides: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
    env: {} as NodeJS.ProcessEnv,
    prompt: vi.fn(),
    promptPassword: vi.fn(),
    ...overrides,
  };
  return { deps, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** Stream de bundle bem-sucedido: um progresso + o resultado. */
function bundleStream(content: string, format: 'md' | 'json' = 'md'): AsyncIterable<CoreEvent<IssueBundleResult>> {
  return (async function* () {
    yield { kind: 'progress', stage: 'fetch', message: 'Buscando issue' };
    yield { kind: 'result', value: { issueId: 42, format, content } };
  })();
}

/** Stream que emite progresso e então lança — para testar exit codes. */
function throwingStream(error: unknown): AsyncIterable<CoreEvent<IssueBundleResult>> {
  return (async function* () {
    yield { kind: 'progress', stage: 'fetch', message: 'Buscando issue' };
    throw error;
  })();
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('CLI: roteamento e help', () => {
  it('--help imprime uso em stdout, exit 0, sem referências a IA', async () => {
    const h = harness();
    const code = await run(['--help'], h.deps);
    expect(code).toBe(0);
    expect(h.stdout()).toContain('Uso:');
    expect(h.stdout()).toContain('Exit codes:');
    expect(h.stdout()).not.toMatch(/claude|gpt|openai|copilot|\bAI\b/i);
  });

  it('sem argumentos imprime help em stderr e retorna 1', async () => {
    const h = harness();
    const code = await run([], h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('Uso:');
  });

  it('comando desconhecido retorna 1', async () => {
    const h = harness();
    const code = await run(['frobnicate'], h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('Comando desconhecido');
  });
});

describe('CLI: comando issue', () => {
  it('imprime bundle MD em stdout e progresso em stderr', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD-BODY'));
    const h = harness();

    const code = await run(['issue', '42', '--url', 'https://redmine.example'], h.deps);

    expect(code).toBe(0);
    expect(h.stdout()).toBe('MD-BODY');
    expect(h.stderr()).toContain('Buscando issue');
    expect(core.fetchIssueBundle).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 42, format: 'md', baseUrl: 'https://redmine.example', apiKey: 'key' }),
    );
  });

  it('--json seleciona o formato JSON canônico', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('{"a":1}', 'json'));
    const h = harness();

    const code = await run(['issue', '42', '--json', '--url', 'https://x'], h.deps);

    expect(code).toBe(0);
    expect(h.stdout()).toBe('{"a":1}');
    expect(core.fetchIssueBundle).toHaveBeenCalledWith(expect.objectContaining({ format: 'json' }));
  });

  it('--out grava o bundle em arquivo e mantém stdout vazio', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD-OUT'));
    const dir = await mkdtemp(join(tmpdir(), 'rc-cli-'));
    const h = harness();

    const code = await run(['issue', '42', '--out', dir, '--url', 'https://x'], h.deps);

    expect(code).toBe(0);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toContain('gravado');
    expect(await readFile(join(dir, '42.md'), 'utf8')).toBe('MD-OUT');
  });

  it('usa REDMINE_URL do ambiente quando --url é omitido', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD'));
    const h = harness({ env: { REDMINE_URL: 'https://env.example' } as NodeJS.ProcessEnv });

    const code = await run(['issue', '42'], h.deps);

    expect(code).toBe(0);
    expect(core.fetchIssueBundle).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://env.example' }));
  });

  it('sem URL retorna 1 e orienta o uso', async () => {
    const h = harness();
    const code = await run(['issue', '42'], h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('REDMINE_URL');
    expect(core.resolveApiKey).not.toHaveBeenCalled();
  });

  it('id inválido retorna 1', async () => {
    const h = harness();
    const code = await run(['issue', 'abc', '--url', 'https://x'], h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('inválido');
  });

  it('sem credencial retorna 2 e orienta login', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(undefined);
    const h = harness();
    const code = await run(['issue', '42', '--url', 'https://x'], h.deps);
    expect(code).toBe(2);
    expect(h.stderr()).toContain('login');
  });

  it('mapeia erros para exit codes distintos', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    const cases: Array<[unknown, number]> = [
      [new core.RedmineAuthError('401', 401, 'u'), 2],
      [new core.RedmineNotFoundError('404', 404, 'u'), 4],
      [new core.RedmineHttpError('500', 500, 'u'), 3],
      [new Error('Falha de rede ao acessar https://x'), 3],
      [new Error('boom'), 1],
    ];
    for (const [error, expected] of cases) {
      vi.mocked(core.fetchIssueBundle).mockReturnValue(throwingStream(error));
      const h = harness();
      const code = await run(['issue', '42', '--url', 'https://x'], h.deps);
      expect(code).toBe(expected);
    }
  });
});

describe('CLI: comando login', () => {
  /** Mock da cascata com um `set` observável. */
  function cascadeMock() {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.mocked(core.createCredentialCascade).mockReturnValue({
      set,
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as ReturnType<typeof core.createCredentialCascade>);
    return set;
  }

  it('login por senha descobre e salva a api_key', async () => {
    const set = cascadeMock();
    vi.mocked(core.loginWithPassword).mockResolvedValue({
      apiKey: 'K',
      user: { id: 1, login: 'alice', name: 'Alice' },
    });
    const h = harness({
      prompt: vi.fn().mockResolvedValue('alice'),
      promptPassword: vi.fn().mockResolvedValue('secret'),
    });

    const code = await run(['login', '--url', 'https://redmine.example'], h.deps);

    expect(code).toBe(0);
    expect(core.loginWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://redmine.example', username: 'alice', password: 'secret' }),
    );
    expect(set).toHaveBeenCalledWith('https://redmine.example', 'K');
    expect(h.stderr()).toContain('Credencial salva');
  });

  it('--api-key salva diretamente sem pedir senha', async () => {
    const set = cascadeMock();
    const promptPassword = vi.fn();
    const h = harness({ prompt: vi.fn(), promptPassword });

    const code = await run(['login', '--url', 'https://x', '--api-key', 'ABC'], h.deps);

    expect(code).toBe(0);
    expect(set).toHaveBeenCalledWith('https://x', 'ABC');
    expect(core.loginWithPassword).not.toHaveBeenCalled();
    expect(promptPassword).not.toHaveBeenCalled();
  });

  it('no fallback 2FA orienta colar a api_key e a salva', async () => {
    const set = cascadeMock();
    vi.mocked(core.loginWithPassword).mockRejectedValue(new core.RedmineAuthError('2fa', 401, 'u'));
    const h = harness({
      prompt: vi.fn().mockResolvedValue('alice'),
      promptPassword: vi.fn().mockResolvedValueOnce('secret').mockResolvedValueOnce('PASTED-KEY'),
    });

    const code = await run(['login', '--url', 'https://x'], h.deps);

    expect(code).toBe(0);
    expect(h.stderr()).toContain('Cole sua api_key');
    expect(set).toHaveBeenCalledWith('https://x', 'PASTED-KEY');
  });

  it('pede a URL interativamente quando ausente', async () => {
    const set = cascadeMock();
    vi.mocked(core.loginWithPassword).mockResolvedValue({
      apiKey: 'K',
      user: { id: 1, login: 'alice', name: 'Alice' },
    });
    const prompt = vi.fn().mockResolvedValueOnce('https://prompt.example').mockResolvedValueOnce('alice');
    const h = harness({ prompt, promptPassword: vi.fn().mockResolvedValue('secret') });

    const code = await run(['login'], h.deps);

    expect(code).toBe(0);
    expect(core.loginWithPassword).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://prompt.example' }));
    expect(set).toHaveBeenCalledWith('https://prompt.example', 'K');
  });

  it('URL vazia aborta com exit 1', async () => {
    const h = harness({ prompt: vi.fn().mockResolvedValue('') });
    const code = await run(['login'], h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('obrigatória');
  });

  it('erro de login (não-auth) mapeia para exit 2', async () => {
    cascadeMock();
    vi.mocked(core.loginWithPassword).mockRejectedValue(new core.RedmineLoginError('REST desabilitada'));
    const h = harness({
      prompt: vi.fn().mockResolvedValue('alice'),
      promptPassword: vi.fn().mockResolvedValue('secret'),
    });

    const code = await run(['login', '--url', 'https://x'], h.deps);

    expect(code).toBe(2);
    expect(h.stderr()).toContain('REST desabilitada');
  });
});
