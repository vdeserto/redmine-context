/**
 * Testes do hook `useIssueSearch` (M2-07, issue #30): busca textual +
 * filtro rápido de status via `fetchIssueSearch` do core, com debounce de
 * digitação e o mesmo padrão de estados de `use-my-issues.ts`
 * (loading/erro-de-rede/403/401-via-useAuthGuard). Escrito ANTES da
 * implementação (TDD). O core é mockado (`resolveApiKey`, `fetchIssueSearch`
 * — `RedmineForbiddenError` segue real, para o `instanceof` da
 * classificação de erro) — nenhuma chamada real de rede/keychain acontece
 * aqui.
 *
 * Debounce testado com um `debounceMs` PEQUENO injetado, não com fake timers:
 * uma sanity-check isolada (scratch, descartada) mostrou que
 * `vi.useFakeTimers()` não avança o repaint do `ink-testing-library` de
 * forma confiável (o scheduler do Ink depende de timers/microtasks reais) —
 * mesmo motivo pelo qual `use-exit-guard.test.tsx` já usa um `windowMs`
 * pequeno injetado em vez de fake timers para testar temporização.
 */
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/index.js')>();
  return { ...actual, resolveApiKey: vi.fn(), fetchIssueSearch: vi.fn() };
});

vi.mock('../../../../src/surfaces/tui/hooks/use-auth-guard.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-auth-guard.js')>();
  return { ...actual, useAuthGuard: vi.fn() };
});

import * as core from '../../../../src/index.js';
import { RedmineForbiddenError } from '../../../../src/index.js';
import {
  ReAuthAbortedError,
  useAuthGuard,
  type UseAuthGuardResult,
} from '../../../../src/surfaces/tui/hooks/use-auth-guard.js';
import {
  useIssueSearch,
  type SearchStatusFilter,
  type UseIssueSearchOptions,
} from '../../../../src/surfaces/tui/hooks/use-issue-search.js';

const BASE_URL = 'https://redmine.example';
const API_KEY = 'super-secret-api-key-should-never-leak';
/** Debounce pequeno para não deixar os testes lentos (ver JSDoc do arquivo). */
const DEBOUNCE_MS = 15;

/** Harness: expõe `query`/`filter` via `globalThis` e renderiza `state`. */
function Harness({ options }: { options?: UseIssueSearchOptions }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchStatusFilter>('all');
  // Reason: as opções injetadas precisam de identidade ESTÁVEL entre
  // re-renders do harness (disparados pelo próprio hook em cada mudança de
  // estado) — um objeto literal recriado a cada render mudaria a referência
  // de `env` a cada chamada, reentrando o efeito de busca indefinidamente.
  const mergedOptions = useMemo<UseIssueSearchOptions>(
    () => ({ env: { REDMINE_URL: BASE_URL }, debounceMs: DEBOUNCE_MS, ...options }),
    [options],
  );
  const { state, clear } = useIssueSearch(query, filter, mergedOptions);
  (globalThis as { __setQuery?: (value: string) => void }).__setQuery = setQuery;
  (globalThis as { __setFilter?: (value: SearchStatusFilter) => void }).__setFilter = setFilter;
  (globalThis as { __clear?: () => void }).__clear = clear;

  return (
    <Box flexDirection="column">
      <Text>{`status:${state.status}`}</Text>
      {state.status === 'loaded' ? (
        <Text>{`content:${state.content}|count:${state.count}|degraded:${state.degraded}`}</Text>
      ) : null}
      {state.status === 'error-network' || state.status === 'error-forbidden' || state.status === 'auth-aborted' ? (
        <Text>{`message:${state.message}`}</Text>
      ) : null}
    </Box>
  );
}

function setQuery(value: string): void {
  (globalThis as { __setQuery?: (value: string) => void }).__setQuery?.(value);
}
function setFilter(value: SearchStatusFilter): void {
  (globalThis as { __setFilter?: (value: SearchStatusFilter) => void }).__setFilter?.(value);
}
function clearSearch(): void {
  (globalThis as { __clear?: () => void }).__clear?.();
}

/** `guard()` passthrough — mesmo padrão de `use-my-issues.test.tsx`. */
const defaultGuardSpy = vi.fn((operation: () => Promise<unknown>) => operation());

beforeEach(() => {
  defaultGuardSpy.mockClear();
  vi.mocked(useAuthGuard).mockReturnValue({ guard: defaultGuardSpy });
});

afterEach(() => {
  vi.mocked(core.resolveApiKey).mockReset();
  vi.mocked(core.fetchIssueSearch).mockReset();
  vi.mocked(useAuthGuard).mockReset();
  delete (globalThis as { __setQuery?: unknown }).__setQuery;
  delete (globalThis as { __setFilter?: unknown }).__setFilter;
  delete (globalThis as { __clear?: unknown }).__clear;
});

describe('useIssueSearch: idle inicial', () => {
  it('começa em "idle" sem chamar fetchIssueSearch (query vazia + filtro "all")', () => {
    const { lastFrame } = render(<Harness />);
    expect(lastFrame()).toContain('status:idle');
    expect(core.fetchIssueSearch).not.toHaveBeenCalled();
  });
});

describe('useIssueSearch: debounce de digitação (300ms em produção, JSDoc)', () => {
  it('só chama fetchIssueSearch depois do debounce, uma única vez para digitação rápida', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.fetchIssueSearch).mockResolvedValue({
      content: 'md',
      count: 0,
      warnings: [],
      degraded: false,
    });

    const { lastFrame } = render(<Harness />);

    setQuery('t');
    setQuery('ti');
    setQuery('tim');
    // Ainda dentro da janela de debounce: nenhuma chamada disparada.
    expect(core.fetchIssueSearch).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(core.fetchIssueSearch).toHaveBeenCalledTimes(1);
    });
    expect(core.fetchIssueSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'tim',
        filters: expect.objectContaining({ assigned_to_id: 'me' }),
      }),
    );
    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
  });
});

describe('useIssueSearch: resultado', () => {
  it('renderiza conteúdo, contagem e degradação vindos de fetchIssueSearch', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.fetchIssueSearch).mockResolvedValue({
      content: '# Resultados da busca (1)\n',
      count: 1,
      warnings: [],
      degraded: false,
    });

    const { lastFrame } = render(<Harness />);
    setQuery('bug');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
    expect(lastFrame()).toContain('count:1');
    expect(lastFrame()).toContain('degraded:false');
  });

  it('degradação: aviso presente no payload aparece no estado (degraded=true)', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.fetchIssueSearch).mockResolvedValue({
      content: '> Aviso: Busca full-text indisponível (404 not found); exibindo apenas os filtros estruturados.\n',
      count: 0,
      warnings: ['Busca full-text indisponível (404 not found); exibindo apenas os filtros estruturados.'],
      degraded: true,
    });

    const { lastFrame } = render(<Harness />);
    setQuery('bug');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
    expect(lastFrame()).toContain('degraded:true');
    expect(lastFrame()).toContain('indispon');
  });
});

describe('useIssueSearch: filtro rápido de status dispara busca mesmo sem query', () => {
  it('mudar o filtro para "open" busca sem precisar de texto', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.fetchIssueSearch).mockResolvedValue({
      content: 'md',
      count: 2,
      warnings: [],
      degraded: false,
    });

    render(<Harness />);
    setFilter('open');

    await vi.waitFor(() => {
      expect(core.fetchIssueSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: undefined,
          filters: expect.objectContaining({ status_id: 'open' }),
        }),
      );
    });
  });

  it('filtro "closed" mapeia para status_id "closed"', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.fetchIssueSearch).mockResolvedValue({
      content: 'md',
      count: 0,
      warnings: [],
      degraded: false,
    });

    render(<Harness />);
    setFilter('closed');

    await vi.waitFor(() => {
      expect(core.fetchIssueSearch).toHaveBeenCalledWith(
        expect.objectContaining({ filters: expect.objectContaining({ status_id: 'closed' }) }),
      );
    });
  });
});

describe('useIssueSearch: clear() restaura "idle" SEM nova chamada (spy)', () => {
  it('clear() após um resultado carregado volta a "idle" sem chamar fetchIssueSearch de novo', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.fetchIssueSearch).mockResolvedValue({
      content: 'md',
      count: 1,
      warnings: [],
      degraded: false,
    });

    const { lastFrame } = render(<Harness />);
    setQuery('bug');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
    expect(core.fetchIssueSearch).toHaveBeenCalledTimes(1);

    clearSearch();
    setQuery('');
    setFilter('all');

    await vi.waitFor(() => expect(lastFrame()).toContain('status:idle'));
    // Espera adicional além do debounce: garante que nenhuma chamada tardia aconteceu.
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 3));
    expect(core.fetchIssueSearch).toHaveBeenCalledTimes(1);
  });
});

describe('useIssueSearch: erro de rede', () => {
  it('erro genérico do fetchIssueSearch resolve para "error-network" com a mensagem', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.fetchIssueSearch).mockRejectedValue(new Error('network unreachable'));

    const { lastFrame } = render(<Harness />);
    setQuery('bug');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:error-network'));
    expect(lastFrame()).toContain('message:network unreachable');
  });

  it('sem credencial resolvida pela cascata: "error-network" sem chamar fetchIssueSearch', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(undefined);

    const { lastFrame } = render(<Harness />);
    setQuery('bug');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:error-network'));
    expect(core.fetchIssueSearch).not.toHaveBeenCalled();
  });
});

describe('useIssueSearch: 403 (sem permissão)', () => {
  it('RedmineForbiddenError resolve para "error-forbidden"', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(core.fetchIssueSearch).mockRejectedValue(
      new RedmineForbiddenError('GET .../issues.json respondeu 403 Forbidden', 403, `${BASE_URL}/issues.json`),
    );

    const { lastFrame } = render(<Harness />);
    setQuery('bug');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:error-forbidden'));
  });
});

describe('useIssueSearch: 401 via useAuthGuard', () => {
  it('a busca é envolvida por guard(); ReAuthAbortedError vira o estado "auth-aborted"', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    vi.mocked(useAuthGuard).mockReturnValue({
      guard: vi.fn<UseAuthGuardResult['guard']>(() => Promise.reject(new ReAuthAbortedError())),
    });

    const { lastFrame } = render(<Harness />);
    setQuery('bug');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:auth-aborted'));
  });

  it('enquanto o re-auth está em andamento, o estado permanece "loading"', async () => {
    vi.mocked(core.resolveApiKey).mockResolvedValue(API_KEY);
    let resolveGuard: (value: unknown) => void = () => {};
    const guardSpy = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGuard = resolve;
        }),
    );
    vi.mocked(useAuthGuard).mockReturnValue({ guard: guardSpy });

    const { lastFrame } = render(<Harness />);
    setQuery('bug');
    await vi.waitFor(() => expect(guardSpy).toHaveBeenCalled());
    expect(lastFrame()).toContain('status:loading');

    resolveGuard({ content: 'md', count: 1, warnings: [], degraded: false });
    await vi.waitFor(() => expect(lastFrame()).toContain('status:loaded'));
  });
});
