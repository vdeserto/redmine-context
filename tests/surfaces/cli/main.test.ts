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

// TUI (M2-01): mockada aqui para testar só o wire de dispatch (TTY → abre a
// TUI); o roteador em si é testado em tests/surfaces/tui/app.test.tsx.
vi.mock('../../../src/surfaces/tui/index.js', () => ({
  runTui: vi.fn().mockResolvedValue(0),
}));

import * as core from '../../../src/index.js';
import type { CoreEvent, IssueBundleResult } from '../../../src/index.js';
import { run } from '../../../src/surfaces/cli/main.js';
import { runTui } from '../../../src/surfaces/tui/index.js';

/** Captura stdout/stderr e injeta prompts controláveis. */
function harness(overrides: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  // Settings em memória (#187): isola do arquivo real de config — sem esta
  // injeção, `run()` usaria `defaultSettingsStore()` (arquivo do usuário) e os
  // testes poluiriam/liriam a instância persistida real.
  const settings = {
    getInstanceUrl: vi.fn().mockResolvedValue(undefined),
    setInstanceUrl: vi.fn().mockResolvedValue(undefined),
    clearInstanceUrl: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
    env: {} as NodeJS.ProcessEnv,
    prompt: vi.fn(),
    promptPassword: vi.fn(),
    settings,
    ...overrides,
  };
  return { deps, settings, stdout: () => out.join(''), stderr: () => err.join('') };
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

  it('--version imprime a versão semver em stdout, exit 0', async () => {
    const h = harness();
    const code = await run(['--version'], h.deps);
    expect(code).toBe(0);
    expect(h.stdout().trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(h.stdout()).toBe(`${core.TOOL_VERSION}\n`);
    expect(h.stderr()).toBe('');
  });

  it('-v é alias de --version', async () => {
    const h = harness();
    const code = await run(['-v'], h.deps);
    expect(code).toBe(0);
    expect(h.stdout()).toBe(`${core.TOOL_VERSION}\n`);
  });

  it('sem argumentos imprime help em stderr e retorna 1 (sem TTY)', async () => {
    const h = harness();
    const code = await run([], h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('Uso:');
    expect(runTui).not.toHaveBeenCalled();
  });

  it('sem argumentos e stdout TTY abre a TUI (M2-01)', async () => {
    // `restoreAllMocks` (afterEach) reseta mocks vi.fn() para um no-op sem
    // retorno — reconfigura o resolved value aqui em vez de depender do
    // default definido na factory do vi.mock (mesmo padrão dos demais mocks
    // do core neste arquivo).
    vi.mocked(runTui).mockResolvedValue(0);
    const h = harness({ isTTY: true });
    const code = await run([], h.deps);
    expect(runTui).toHaveBeenCalledTimes(1);
    expect(code).toBe(0);
    expect(h.stderr()).toBe('');
  });

  it('comando desconhecido retorna 1', async () => {
    const h = harness();
    const code = await run(['frobnicate'], h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('Comando desconhecido');
  });
});

describe('CLI: degradação NO_COLOR / não-TTY / CI (M2-03)', () => {
  it('NO_COLOR definida degrada mesmo com stdout TTY — não abre a TUI', async () => {
    const h = harness({ isTTY: true, env: { NO_COLOR: '1' } as NodeJS.ProcessEnv });
    const code = await run([], h.deps);
    expect(runTui).not.toHaveBeenCalled();
    expect(code).toBe(1);
    expect(h.stderr()).toContain('Uso:');
  });

  it('CI=true degrada mesmo com stdout TTY — não abre a TUI', async () => {
    const h = harness({ isTTY: true, env: { CI: 'true' } as NodeJS.ProcessEnv });
    const code = await run([], h.deps);
    expect(runTui).not.toHaveBeenCalled();
    expect(code).toBe(1);
    expect(h.stderr()).toContain('Uso:');
  });

  it('stdout não-TTY degrada independente do ambiente (env limpo)', async () => {
    const h = harness({ isTTY: false });
    const code = await run([], h.deps);
    expect(runTui).not.toHaveBeenCalled();
    expect(code).toBe(1);
  });

  it('saída da degradação é texto puro, sem códigos ANSI', async () => {
    const h = harness({ isTTY: true, env: { NO_COLOR: '1', CI: 'true' } as NodeJS.ProcessEnv });
    const code = await run([], h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).not.toMatch(/\x1b\[/);
    expect(h.stdout()).toBe('');
  });

  it('--help nunca contém códigos ANSI, TTY ou não', async () => {
    const h = harness({ isTTY: true, env: { NO_COLOR: '1' } as NodeJS.ProcessEnv });
    const code = await run(['--help'], h.deps);
    expect(code).toBe(0);
    expect(h.stdout()).not.toMatch(/\x1b\[/);
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

  it('sem --extract não liga a extração de anexos (default false)', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD'));
    const h = harness();

    const code = await run(['issue', '42', '--url', 'https://x'], h.deps);

    expect(code).toBe(0);
    expect(core.fetchIssueBundle).toHaveBeenCalledWith(expect.objectContaining({ extractAttachments: false }));
  });

  it('--extract liga o pipeline de extração no core (spy)', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD'));
    const h = harness();

    const code = await run(['issue', '42', '--extract', '--url', 'https://x'], h.deps);

    expect(code).toBe(0);
    expect(core.fetchIssueBundle).toHaveBeenCalledWith(expect.objectContaining({ extractAttachments: true }));
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

  it('usa a URL PERSISTIDA (login) quando --url e REDMINE_URL ausentes (#187)', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD'));
    const h = harness();
    h.settings.getInstanceUrl.mockResolvedValue('https://persisted.example');

    const code = await run(['issue', '42'], h.deps);

    expect(code).toBe(0);
    expect(core.fetchIssueBundle).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://persisted.example' }),
    );
    // SEGURANÇA (#187): URL persistida (origem config) NÃO usa a env-key.
    expect(core.resolveApiKey).toHaveBeenCalledWith(
      'https://persisted.example',
      expect.objectContaining({ allowEnvFallback: false }),
    );
  });

  it('--url/REDMINE_URL (origem confiável) mantêm o fallback de ambiente (#187)', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD'));
    const h = harness();

    await run(['issue', '42', '--url', 'https://flag.example'], h.deps);

    expect(core.resolveApiKey).toHaveBeenCalledWith(
      'https://flag.example',
      expect.objectContaining({ allowEnvFallback: true }),
    );
  });

  it('--url tem precedência sobre a URL persistida (#187)', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD'));
    const h = harness();
    h.settings.getInstanceUrl.mockResolvedValue('https://persisted.example');

    await run(['issue', '42', '--url', 'https://flag.example'], h.deps);

    expect(core.fetchIssueBundle).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://flag.example' }),
    );
  });

  it('sem URL retorna 1 e orienta o uso', async () => {
    const h = harness();
    const code = await run(['issue', '42'], h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('REDMINE_URL');
    expect(h.stderr()).toContain('login');
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

  it('persiste a URL da instância no login bem-sucedido (#187)', async () => {
    cascadeMock();
    vi.mocked(core.loginWithPassword).mockResolvedValue({
      apiKey: 'K',
      user: { id: 1, login: 'alice', name: 'Alice' },
    });
    const h = harness({
      prompt: vi.fn().mockResolvedValue('alice'),
      promptPassword: vi.fn().mockResolvedValue('secret'),
    });

    const code = await run(['login', '--url', 'https://login.example'], h.deps);

    expect(code).toBe(0);
    expect(h.settings.setInstanceUrl).toHaveBeenCalledWith('https://login.example');
  });

  it('login usa a URL persistida como fallback antes de perguntar (#187)', async () => {
    cascadeMock();
    vi.mocked(core.loginWithPassword).mockResolvedValue({
      apiKey: 'K',
      user: { id: 1, login: 'alice', name: 'Alice' },
    });
    const prompt = vi.fn().mockResolvedValue('alice');
    const h = harness({ prompt, promptPassword: vi.fn().mockResolvedValue('secret') });
    h.settings.getInstanceUrl.mockResolvedValue('https://saved.example');

    const code = await run(['login'], h.deps);

    expect(code).toBe(0);
    // Não perguntou a URL (usou a persistida); o login foi contra ela.
    expect(prompt).not.toHaveBeenCalledWith(expect.stringContaining('URL'));
    expect(core.loginWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://saved.example' }),
    );
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
