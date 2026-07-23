/**
 * Testes do hook `useIssueDetail` (#31): busca o detalhe completo de uma
 * issue via `getIssue` + `normalizeIssue` do core — sem passar pelo bundle
 * Markdown/JSON (esse é o formato de saída da CLI/MCP, não o modelo em
 * memória que a tela de detalhe da TUI precisa para paginar/rolar o
 * conteúdo). Escrito ANTES da implementação (TDD).
 *
 * Mesmo padrão de `use-my-issues.test.tsx`: o core é mockado (`resolveApiKey`,
 * `createHttpClient`, `getIssue`, `normalizeIssue` — `RedmineForbiddenError`/
 * `RedmineNotFoundError` seguem reais, para o `instanceof` da classificação
 * de erro) e `useAuthGuard` também é mockado (passthrough por padrão via
 * `beforeEach`) — nenhuma chamada real de rede/keychain acontece aqui.
 */
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/index.js')>();
  return {
    ...actual,
    resolveApiKey: vi.fn(),
    createHttpClient: vi.fn(),
    getIssue: vi.fn(),
    normalizeIssue: vi.fn(),
  };
});

vi.mock('../../../../src/surfaces/tui/hooks/use-auth-guard.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-auth-guard.js')>();
  return { ...actual, useAuthGuard: vi.fn() };
});

import * as core from '../../../../src/index.js';
import {
  RedmineForbiddenError,
  RedmineNotFoundError,
  type HttpClient,
  type Issue,
  type RedmineIssuePayload,
} from '../../../../src/index.js';
import {
  ReAuthAbortedError,
  useAuthGuard,
  type UseAuthGuardResult,
} from '../../../../src/surfaces/tui/hooks/use-auth-guard.js';
import {
  useIssueDetail,
  type UseIssueDetailOptions,
} from '../../../../src/surfaces/tui/hooks/use-issue-detail.js';

const BASE_URL = 'https://redmine.example';
const API_KEY = 'super-secret-api-key-should-never-leak';
const FAKE_HTTP_CLIENT: HttpClient = { get: vi.fn() };
const RAW_PAYLOAD: RedmineIssuePayload = { id: 42, subject: 'Issue bruta' };
const NORMALIZED_ISSUE: Issue = {
  id: 42,
  subject: 'Corrigir bug de login',
  project: { id: 1, name: 'Projeto X' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 1, name: 'Nova' },
  priority: { id: 1, name: 'Normal' },
  author: { id: 1, name: 'Ana Autora' },
  created_on: '2024-01-01T10:00:00Z',
  updated_on: '2024-01-02T10:00:00Z',
  custom_fields: [],
  journals: [],
  attachments: [],
  relations: [],
  children: [],
};

/** Harness: renderiza `state.status` + um resumo, e expõe `retry` via `globalThis`. */
function Harness({ issueId, options }: { issueId: number | undefined; options?: UseIssueDetailOptions }) {
  const { state, retry } = useIssueDetail(issueId, options);
  (globalThis as { __retry?: () => void }).__retry = retry;
  return (
    <Box flexDirection="column">
      <Text>{`status:${state.status}`}</Text>
      {state.status === 'loaded' ? <Text>{`subject:${state.issue.subject}`}</Text> : null}
      {state.status === 'error-network' ||
      state.status === 'error-forbidden' ||
      state.status === 'error-not-found' ||
      state.status === 'auth-aborted' ? (
        <Text>{`message:${state.message}`}</Text>
      ) : null}
    </Box>
  );
}

const defaultGuardSpy = vi.fn((operation: () => Promise<unknown>) => operation());

beforeEach(() => {
  defaultGuardSpy.mockClear();
  vi.mocked(useAuthGuard).mockReturnValue({ guard: defaultGuardSpy });
});

afterEach(() => {
  vi.mocked(core.resolveApiKey).mockReset();
  vi.mocked(core.createHttpClient).mockReset();
  vi.mocked(core.getIssue).mockReset();
  vi.mocked(core.normalizeIssue).mockReset();
  vi.mocked(useAuthGuard).mockReset();
  delete (globalThis as { __retry?: () => void }).__retry;
});

describe('useIssueDetail: sem issue selecionada', () => {
  it('issueId undefined resolve direto para "no-selection", sem chamar o core', async () => {
    const { lastFrame } = render(<Harness issueId={undefined} options={{ env: { REDMINE_URL: BASE_URL } }} />);
    expect(lastFrame()).toContain('status:no-selection');
    expect(core.resolveApiKey).not.toHaveBeenCalled();
    expect(core.getIssue).not.toHaveBeenCalled();
  });
});

describe('useIssueDetail: carregando → sucesso', () => {
  it('começa em loading e resolve para loaded com a issue normalizada (getIssue + normalizeIssue, sem bundle)', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.getIssue).mockResolvedValue(RAW_PAYLOAD);
    vi.mocked(core.normalizeIssue).mockReturnValue(NORMALIZED_ISSUE);

    const { lastFrame } = render(<Harness issueId={42} options={{ env: { REDMINE_URL: BASE_URL } }} />);
    expect(lastFrame()).toContain('status:loading');

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:loaded');
    });
    expect(lastFrame()).toContain('subject:Corrigir bug de login');
    expect(core.getIssue).toHaveBeenCalledWith(FAKE_HTTP_CLIENT, 42);
    expect(core.normalizeIssue).toHaveBeenCalledWith(RAW_PAYLOAD);
    expect(core.createHttpClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: BASE_URL, apiKey: API_KEY }),
    );
  });

  it('NUNCA vaza a api_key em nenhum frame', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.getIssue).mockResolvedValue(RAW_PAYLOAD);
    vi.mocked(core.normalizeIssue).mockReturnValue(NORMALIZED_ISSUE);

    const { lastFrame } = render(<Harness issueId={42} options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
    expect(lastFrame()).not.toContain(API_KEY);
  });
});

describe('useIssueDetail: erro de rede', () => {
  it('erro genérico do getIssue resolve para "error-network" com a mensagem', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.getIssue).mockRejectedValue(new Error('network unreachable'));

    const { lastFrame } = render(<Harness issueId={42} options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-network');
    });
    expect(lastFrame()).toContain('message:network unreachable');
  });

  it('sem REDMINE_URL configurada: "error-network" sem chamar resolveApiKey/getIssue', async () => {
    const { lastFrame } = render(<Harness issueId={42} options={{ env: {} }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-network');
    });
    expect(core.resolveApiKey).not.toHaveBeenCalled();
    expect(core.getIssue).not.toHaveBeenCalled();
  });

  it('retry() reexecuta a busca e pode se recuperar do erro', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.normalizeIssue).mockReturnValue(NORMALIZED_ISSUE);
    vi.mocked(core.getIssue)
      .mockRejectedValueOnce(new Error('network unreachable'))
      .mockResolvedValueOnce(RAW_PAYLOAD);

    const { lastFrame } = render(<Harness issueId={42} options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-network');
    });

    (globalThis as { __retry?: () => void }).__retry?.();

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:loaded');
    });
    expect(core.getIssue).toHaveBeenCalledTimes(2);
  });
});

describe('useIssueDetail: 403 (sem permissão)', () => {
  it('RedmineForbiddenError resolve para "error-forbidden" com mensagem específica de permissão', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.getIssue).mockRejectedValue(
      new RedmineForbiddenError('GET .../issues/42.json respondeu 403 Forbidden', 403, `${BASE_URL}/issues/42.json`),
    );

    const { lastFrame } = render(<Harness issueId={42} options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-forbidden');
    });
    expect(lastFrame()).toContain('permiss');
  });
});

describe('useIssueDetail: 404 (issue inexistente)', () => {
  it('RedmineNotFoundError resolve para "error-not-found" com mensagem específica', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.getIssue).mockRejectedValue(
      new RedmineNotFoundError('GET .../issues/42.json respondeu 404 Not Found', 404, `${BASE_URL}/issues/42.json`),
    );

    const { lastFrame } = render(<Harness issueId={42} options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-not-found');
    });
    expect(lastFrame()).toContain('#42');
  });
});

describe('useIssueDetail: 401 via useAuthGuard', () => {
  it('a busca é envolvida por guard(); enquanto a Promise não resolve (re-auth em andamento), o estado permanece "loading"', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.normalizeIssue).mockReturnValue(NORMALIZED_ISSUE);

    let resolveGuard: (value: unknown) => void = () => {};
    const guardSpy = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGuard = resolve;
        }),
    );
    vi.mocked(useAuthGuard).mockReturnValue({ guard: guardSpy });

    const { lastFrame } = render(<Harness issueId={42} options={{ env: { REDMINE_URL: BASE_URL } }} />);

    await vi.waitFor(() => expect(guardSpy).toHaveBeenCalledWith(expect.any(Function)));
    expect(lastFrame()).toContain('status:loading');

    resolveGuard(RAW_PAYLOAD);

    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
  });
});

describe('useIssueDetail: abandono do re-login — ReAuthAbortedError', () => {
  it('guard() rejeitando com ReAuthAbortedError resolve para o estado "auth-aborted", não um erro cru', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(useAuthGuard).mockReturnValue({ guard: vi.fn(() => Promise.reject(new ReAuthAbortedError())) });

    const { lastFrame } = render(<Harness issueId={42} options={{ env: { REDMINE_URL: BASE_URL } }} />);

    await vi.waitFor(() => expect(lastFrame()).toContain('status:auth-aborted'));
    expect(lastFrame()).toContain('message:login cancelado');
    expect(lastFrame()).toContain('pressione r');
  });

  it('retry() após "auth-aborted" refaz a busca do zero e pode carregar com sucesso', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.getIssue).mockResolvedValue(RAW_PAYLOAD);
    vi.mocked(core.normalizeIssue).mockReturnValue(NORMALIZED_ISSUE);
    const guardSpy = vi
      .fn<UseAuthGuardResult['guard']>()
      .mockRejectedValueOnce(new ReAuthAbortedError())
      .mockImplementationOnce((operation) => operation());
    vi.mocked(useAuthGuard).mockReturnValue({ guard: guardSpy });

    const { lastFrame } = render(<Harness issueId={42} options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('status:auth-aborted'));

    (globalThis as { __retry?: () => void }).__retry?.();

    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
    expect(guardSpy).toHaveBeenCalledTimes(2);
  });
});
