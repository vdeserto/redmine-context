/**
 * Testes do hook `useMyIssues` (M2-06, #29) — resolve a credencial pela
 * cascata do core, monta o client HTTP e lista "minhas issues"
 * (`assigned_to_id=me`) via `listIssues`. Escrito ANTES da implementação
 * (TDD). O core é mockado (`resolveApiKey`, `createHttpClient`, `listIssues`
 * — `RedmineForbiddenError` segue real, para o `instanceof` da classificação
 * de erro) — nenhuma chamada real de rede/keychain acontece aqui.
 */
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/index.js')>();
  return {
    ...actual,
    resolveApiKey: vi.fn(),
    createHttpClient: vi.fn(),
    listIssues: vi.fn(),
  };
});

import * as core from '../../../../src/index.js';
import { RedmineForbiddenError, type HttpClient } from '../../../../src/index.js';
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
      {state.status === 'error-network' || state.status === 'error-forbidden' ? (
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

afterEach(() => {
  vi.mocked(core.resolveApiKey).mockReset();
  vi.mocked(core.createHttpClient).mockReset();
  vi.mocked(core.listIssues).mockReset();
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
