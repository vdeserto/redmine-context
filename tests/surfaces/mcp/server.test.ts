import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock parcial da superfície do core: preserva as classes de erro reais (para o
// `instanceof` do mapeamento de mensagens tipadas) e mocka apenas as funções.
vi.mock('../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/index.js')>();
  return {
    ...actual,
    fetchIssueBundle: vi.fn(),
    resolveApiKey: vi.fn(),
  };
});

import * as core from '../../../src/index.js';
import type { CoreEvent, IssueBundleResult } from '../../../src/index.js';
import {
  createGetIssueContextHandler,
  createMcpServer,
  defaultMcpDeps,
  type McpServerDeps,
} from '../../../src/surfaces/mcp/server.js';

/** Stream de bundle bem-sucedido: um progresso + o resultado. */
function bundleStream(content: string, format: 'md' | 'json' = 'md'): AsyncIterable<CoreEvent<IssueBundleResult>> {
  return (async function* () {
    yield { kind: 'progress', stage: 'fetch', message: 'Buscando issue' };
    yield { kind: 'result', value: { issueId: 42, format, content } };
  })();
}

/** Stream que emite progresso e então lança — para testar mensagens de erro. */
function throwingStream(error: unknown): AsyncIterable<CoreEvent<IssueBundleResult>> {
  return (async function* () {
    yield { kind: 'progress', stage: 'fetch', message: 'Buscando issue' };
    throw error;
  })();
}

/** Deps default apontando para o core mockado, com env e logger controláveis. */
function makeDeps(overrides: Partial<McpServerDeps> = {}): McpServerDeps & { logs: string[] } {
  const logs: string[] = [];
  return {
    fetchIssueBundle: core.fetchIssueBundle,
    resolveApiKey: core.resolveApiKey,
    env: { REDMINE_URL: 'https://redmine.example' } as NodeJS.ProcessEnv,
    toolVersion: '9.9.9',
    log: (m: string) => logs.push(m),
    logs,
    ...overrides,
  };
}

/** Extrai o texto concatenado de um CallToolResult. */
function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('MCP: get_issue_context handler', () => {
  it('sucesso markdown: retorna o bundle MD e propaga issue_id/format=md', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD-BODY'));
    const deps = makeDeps();
    const handler = createGetIssueContextHandler(deps);

    const result = await handler({ issue_id: 42 });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe('MD-BODY');
    expect(core.fetchIssueBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 42,
        format: 'md',
        baseUrl: 'https://redmine.example',
        apiKey: 'key',
        toolVersion: '9.9.9',
      }),
    );
    // Progresso vai para o logger (stderr), nunca para o conteúdo.
    expect(deps.logs.join('')).toContain('Buscando issue');
  });

  it('sucesso json: format=json mapeia para o formato canônico do core', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('{"a":1}', 'json'));
    const handler = createGetIssueContextHandler(makeDeps());

    const result = await handler({ issue_id: 42, format: 'json' });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe('{"a":1}');
    expect(core.fetchIssueBundle).toHaveBeenCalledWith(expect.objectContaining({ format: 'json' }));
  });

  it('format ausente usa markdown por padrão', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD'));
    const handler = createGetIssueContextHandler(makeDeps());

    await handler({ issue_id: 7 });

    expect(core.fetchIssueBundle).toHaveBeenCalledWith(expect.objectContaining({ format: 'md' }));
  });

  it('insecure default: repassa insecure=false ao core', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD'));
    const handler = createGetIssueContextHandler(makeDeps());

    await handler({ issue_id: 7 });

    expect(core.fetchIssueBundle).toHaveBeenCalledWith(expect.objectContaining({ insecure: false }));
  });

  it('insecure habilitado: repassa insecure=true ao core (http local)', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(bundleStream('MD'));
    const handler = createGetIssueContextHandler(makeDeps({ insecure: true }));

    await handler({ issue_id: 7 });

    expect(core.fetchIssueBundle).toHaveBeenCalledWith(expect.objectContaining({ insecure: true }));
  });

  it('404: isError com mensagem tipada de issue inexistente', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(throwingStream(new core.RedmineNotFoundError('nf', 404, 'u')));
    const handler = createGetIssueContextHandler(makeDeps());

    const result = await handler({ issue_id: 42 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('#42');
    expect(textOf(result)).toContain('404');
  });

  it('403: isError com mensagem tipada de acesso negado', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(throwingStream(new core.RedmineForbiddenError('fb', 403, 'u')));
    const handler = createGetIssueContextHandler(makeDeps());

    const result = await handler({ issue_id: 42 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('403');
  });

  it('401: isError orientando a verificar a credencial', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(throwingStream(new core.RedmineAuthError('auth', 401, 'u')));
    const handler = createGetIssueContextHandler(makeDeps());

    const result = await handler({ issue_id: 42 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('REDMINE_API_KEY');
  });

  it('erro genérico: isError com a mensagem do erro', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(throwingStream(new Error('boom interno')));
    const handler = createGetIssueContextHandler(makeDeps());

    const result = await handler({ issue_id: 42 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('boom interno');
  });

  it('sem REDMINE_URL: isError orientando a configurar REDMINE_URL', async () => {
    const handler = createGetIssueContextHandler(makeDeps({ env: {} as NodeJS.ProcessEnv }));

    const result = await handler({ issue_id: 42 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('REDMINE_URL');
    expect(core.resolveApiKey).not.toHaveBeenCalled();
  });

  it('sem credencial: isError orientando a configurar REDMINE_API_KEY', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(undefined);
    const handler = createGetIssueContextHandler(makeDeps());

    const result = await handler({ issue_id: 42 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('REDMINE_API_KEY');
    expect(core.fetchIssueBundle).not.toHaveBeenCalled();
  });

  it('falha ao resolver credencial: isError com a mensagem', async () => {
    vi.mocked(core.resolveApiKey).mockRejectedValue(new Error('cofre corrompido'));
    const handler = createGetIssueContextHandler(makeDeps());

    const result = await handler({ issue_id: 42 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('cofre corrompido');
  });

  it('stream sem resultado: isError informando ausência de bundle', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue('key');
    vi.mocked(core.fetchIssueBundle).mockReturnValue(
      (async function* () {
        yield { kind: 'progress', stage: 'fetch', message: 'só progresso' };
      })(),
    );
    const handler = createGetIssueContextHandler(makeDeps());

    const result = await handler({ issue_id: 42 });

    expect(result.isError).toBe(true);
  });
});

describe('MCP: createMcpServer', () => {
  it('constrói um McpServer com a tool registrada (read-only, sem URL/host)', () => {
    const server = createMcpServer(makeDeps());
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe('function');
  });
});

describe('MCP: defaultMcpDeps', () => {
  const prev = process.env.REDMINE_INSECURE;
  afterEach(() => {
    if (prev === undefined) delete process.env.REDMINE_INSECURE;
    else process.env.REDMINE_INSECURE = prev;
  });

  it('insecure=false quando REDMINE_INSECURE ausente', () => {
    delete process.env.REDMINE_INSECURE;
    expect(defaultMcpDeps().insecure).toBe(false);
  });

  it('insecure=true quando REDMINE_INSECURE=1', () => {
    process.env.REDMINE_INSECURE = '1';
    expect(defaultMcpDeps().insecure).toBe(true);
  });

  it('insecure=true quando REDMINE_INSECURE=true (case-insensitive)', () => {
    process.env.REDMINE_INSECURE = 'TRUE';
    expect(defaultMcpDeps().insecure).toBe(true);
  });
});
