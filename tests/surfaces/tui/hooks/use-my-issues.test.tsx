/**
 * Testes do hook `useMyIssues` (M2-06, #29) — resolve a credencial pela
 * cascata do core, monta o client HTTP e lista "minhas issues"
 * (`assigned_to_id=me`) via `listIssues`. Escrito ANTES da implementação
 * (TDD). O core é mockado (`resolveApiKey`, `createHttpClient`, `listIssues`
 * — `RedmineForbiddenError` segue real, para o `instanceof` da classificação
 * de erro) — nenhuma chamada real de rede/keychain acontece aqui.
 *
 * Fix do review do PR #120: `useAuthGuard` (M2-13, #36) também é mockado —
 * por padrão um passthrough (`guard: (op) => op()`, ver `beforeEach`) para
 * que os testes pré-existentes (sem 401 nenhum) continuem inalterados; os
 * blocos "401 via useAuthGuard" e "abandono do re-login" abaixo substituem
 * esse mock por implementações que controlam quando/como `guard()`
 * resolve/rejeita — sem precisar montar `NavigationProvider`/
 * `OnboardingProvider` reais (esse fluxo de navegação já é coberto por
 * `use-auth-guard.test.tsx`; aqui só importa que `useMyIssues` USE `guard()`
 * corretamente).
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
    listIssues: vi.fn(),
  };
});

vi.mock('../../../../src/surfaces/tui/hooks/use-auth-guard.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-auth-guard.js')>();
  return { ...actual, useAuthGuard: vi.fn() };
});

import * as core from '../../../../src/index.js';
import { RedmineForbiddenError, type HttpClient } from '../../../../src/index.js';
import {
  ReAuthAbortedError,
  useAuthGuard,
  type UseAuthGuardResult,
} from '../../../../src/surfaces/tui/hooks/use-auth-guard.js';
import { useMyIssues, type UseMyIssuesOptions } from '../../../../src/surfaces/tui/hooks/use-my-issues.js';

const BASE_URL = 'https://redmine.example';
const API_KEY = 'super-secret-api-key-should-never-leak';
const FAKE_HTTP_CLIENT: HttpClient = { get: vi.fn() };

/** Harness: renderiza `state.status` + um resumo, e expõe `retry` via tecla 'r'. */
function Harness({ options }: { options?: UseMyIssuesOptions }) {
  const { state, retry } = useMyIssues(options);
  return (
    <Box flexDirection="column">
      <Text>{`status:${state.status}`}</Text>
      {state.status === 'loaded' ? (
        <Text>{`issues:${state.issues.map((issue) => `${issue.id}:${issue.subject}:${issue.statusName}`).join(',')}`}</Text>
      ) : null}
      {state.status === 'error-network' || state.status === 'error-forbidden' || state.status === 'auth-aborted' ? (
        <Text>{`message:${state.message}`}</Text>
      ) : null}
      <RetryOnR retry={retry} />
    </Box>
  );
}

// Testa `retry` sem depender de useInput/stdin: chama diretamente via uma prop
// exposta a `globalThis` para o teste acionar deliberadamente.
function RetryOnR({ retry }: { retry: () => void }) {
  (globalThis as { __retry?: () => void }).__retry = retry;
  return null;
}

/**
 * `guard()` passthrough — chama a operação direto, sem re-auth nenhum
 * (default de todo teste que não é sobre 401). Referência ESTÁVEL
 * (`defaultGuardSpy` fixo, reaproveitado via `mockReturnValue`, nunca
 * `mockImplementation`/uma factory nova por chamada): `guard` está nas deps
 * do `useEffect` de `useMyIssues` — uma identidade nova a cada render faria o
 * efeito reentrar infinitamente.
 */
const defaultGuardSpy = vi.fn((operation: () => Promise<unknown>) => operation());

beforeEach(() => {
  defaultGuardSpy.mockClear();
  vi.mocked(useAuthGuard).mockReturnValue({ guard: defaultGuardSpy });
});

afterEach(() => {
  vi.mocked(core.resolveApiKey).mockReset();
  vi.mocked(core.createHttpClient).mockReset();
  vi.mocked(core.listIssues).mockReset();
  vi.mocked(useAuthGuard).mockReset();
  delete (globalThis as { __retry?: () => void }).__retry;
});

describe('useMyIssues: carregando → sucesso', () => {
  it('começa em loading e resolve para loaded com as issues mapeadas', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.listIssues).mockResolvedValue([
      { id: 1, subject: 'Corrigir bug X', status: { id: 1, name: 'Nova' } },
      { id: 2, subject: 'Implementar Y', status: { id: 2, name: 'Em andamento' } },
    ]);

    const { lastFrame } = render(
      <Harness options={{ env: { REDMINE_URL: BASE_URL } }} />,
    );

    expect(lastFrame()).toContain('status:loading');

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:loaded');
    });
    expect(lastFrame()).toContain('issues:1:Corrigir bug X:Nova,2:Implementar Y:Em andamento');
    expect(core.resolveApiKey).toHaveBeenCalledWith(BASE_URL, expect.objectContaining({ env: expect.anything() }));
    expect(core.createHttpClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: BASE_URL, apiKey: API_KEY }),
    );
    expect(core.listIssues).toHaveBeenCalledWith(
      FAKE_HTTP_CLIENT,
      expect.objectContaining({ filters: expect.objectContaining({ assigned_to_id: 'me' }) }),
    );
  });

  it('NUNCA vaza a api_key em nenhum frame', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.listIssues).mockResolvedValue([
      { id: 1, subject: 'Corrigir bug X', status: { id: 1, name: 'Nova' } },
    ]);

    const { lastFrame } = render(<Harness options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
    expect(lastFrame()).not.toContain(API_KEY);
  });
});

describe('useMyIssues: vazio', () => {
  it('nenhuma issue atribuída resolve para o estado "empty"', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.listIssues).mockResolvedValue([]);

    const { lastFrame } = render(<Harness options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:empty');
    });
  });
});

describe('useMyIssues: erro de rede', () => {
  it('erro genérico do listIssues resolve para "error-network" com a mensagem', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.listIssues).mockRejectedValue(new Error('network unreachable'));

    const { lastFrame } = render(<Harness options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-network');
    });
    expect(lastFrame()).toContain('message:network unreachable');
  });

  it('sem REDMINE_URL configurada: "error-network" sem chamar resolveApiKey/listIssues', async () => {
    const { lastFrame } = render(<Harness options={{ env: {} }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-network');
    });
    expect(core.resolveApiKey).not.toHaveBeenCalled();
    expect(core.listIssues).not.toHaveBeenCalled();
  });

  it('sem credencial resolvida pela cascata: "error-network" sem chamar listIssues', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(undefined);

    const { lastFrame } = render(<Harness options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-network');
    });
    expect(core.listIssues).not.toHaveBeenCalled();
  });

  it('retry() reexecuta a busca e pode se recuperar do erro', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.listIssues)
      .mockRejectedValueOnce(new Error('network unreachable'))
      .mockResolvedValueOnce([{ id: 1, subject: 'Corrigir bug X', status: { id: 1, name: 'Nova' } }]);

    const { lastFrame } = render(<Harness options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-network');
    });

    (globalThis as { __retry?: () => void }).__retry?.();

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:loaded');
    });
    expect(core.listIssues).toHaveBeenCalledTimes(2);
  });
});

describe('useMyIssues: 403 (sem permissão)', () => {
  it('RedmineForbiddenError resolve para "error-forbidden" com mensagem específica de permissão', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.listIssues).mockRejectedValue(
      new RedmineForbiddenError('GET .../issues.json respondeu 403 Forbidden', 403, `${BASE_URL}/issues.json`),
    );

    const { lastFrame } = render(<Harness options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('status:error-forbidden');
    });
    expect(lastFrame()).toContain('permiss');
  });
});

describe('useMyIssues: 401 via useAuthGuard (fix do review #120)', () => {
  it('a busca é envolvida por guard(); enquanto a Promise não resolve (re-auth em andamento), o estado permanece "loading"', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);

    let resolveGuard: (value: unknown) => void = () => {};
    const guardSpy = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGuard = resolve;
        }),
    );
    vi.mocked(useAuthGuard).mockReturnValue({ guard: guardSpy });

    const { lastFrame } = render(<Harness options={{ env: { REDMINE_URL: BASE_URL } }} />);

    await vi.waitFor(() => expect(guardSpy).toHaveBeenCalledWith(expect.any(Function)));
    // 401 nunca vira um "error-network" cru — o estado segue "loading" até o
    // re-login (simulado pelo guard() controlado acima) resolver.
    expect(lastFrame()).toContain('status:loading');

    resolveGuard([{ id: 7, subject: 'Retomada pós re-login', status: { id: 1, name: 'Nova' } }]);

    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
    expect(lastFrame()).toContain('issues:7:Retomada pós re-login:Nova');
  });
});

describe('useMyIssues: abandono do re-login — ReAuthAbortedError (fix do review #120)', () => {
  it('guard() rejeitando com ReAuthAbortedError resolve para o estado "auth-aborted", não um erro cru', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(useAuthGuard).mockReturnValue({ guard: vi.fn(() => Promise.reject(new ReAuthAbortedError())) });

    const { lastFrame } = render(<Harness options={{ env: { REDMINE_URL: BASE_URL } }} />);

    await vi.waitFor(() => expect(lastFrame()).toContain('status:auth-aborted'));
    expect(lastFrame()).toContain('message:login cancelado');
    expect(lastFrame()).toContain('pressione r');
  });

  it('retry() após "auth-aborted" refaz a busca do zero e pode carregar com sucesso', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.createHttpClient).mockReturnValue(FAKE_HTTP_CLIENT);
    vi.mocked(core.listIssues).mockResolvedValue([
      { id: 1, subject: 'Corrigir bug X', status: { id: 1, name: 'Nova' } },
    ]);
    const guardSpy = vi
      .fn<UseAuthGuardResult['guard']>()
      .mockRejectedValueOnce(new ReAuthAbortedError())
      .mockImplementationOnce((operation) => operation());
    vi.mocked(useAuthGuard).mockReturnValue({ guard: guardSpy });

    const { lastFrame } = render(<Harness options={{ env: { REDMINE_URL: BASE_URL } }} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('status:auth-aborted'));

    (globalThis as { __retry?: () => void }).__retry?.();

    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
    expect(guardSpy).toHaveBeenCalledTimes(2);
  });
});
