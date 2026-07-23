/**
 * Testes da tela home (M2-06/#29, busca M2-07/#30): "minhas issues" via
 * `useMyIssues` + busca inline via `useIssueSearch` (ambos mockados — o
 * comportamento interno de cada hook já é coberto por
 * `tests/surfaces/tui/hooks/use-my-issues.test.tsx` e
 * `tests/surfaces/tui/hooks/use-issue-search.test.tsx`). Cobre os 4 estados
 * visuais originais (loading/empty/error de rede com retry/403), a lista com
 * seleção por teclado, o Enter abrindo o placeholder de detalhe, e a busca
 * inline (M2-07): `/` abre o campo, resultado/degradação renderizam, `f`
 * cicla o filtro de status, e Esc (via `consumeEscapeInterceptor`, mesmo
 * mecanismo usado pelo roteador global — ver `../app.tsx`) fecha a busca sem
 * disparar uma nova busca. Escrito ANTES da implementação (TDD).
 */
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/surfaces/tui/hooks/use-my-issues.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-my-issues.js')>();
  return { ...actual, useMyIssues: vi.fn() };
});

vi.mock('../../../../src/surfaces/tui/hooks/use-issue-search.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-issue-search.js')>();
  return { ...actual, useIssueSearch: vi.fn() };
});

import {
  consumeEscapeInterceptor,
  resetEscapeInterceptor,
} from '../../../../src/surfaces/tui/hooks/use-escape-interceptor.js';
import * as useIssueSearchModule from '../../../../src/surfaces/tui/hooks/use-issue-search.js';
import type { IssueSearchState } from '../../../../src/surfaces/tui/hooks/use-issue-search.js';
import * as useMyIssuesModule from '../../../../src/surfaces/tui/hooks/use-my-issues.js';
import type { MyIssuesState } from '../../../../src/surfaces/tui/hooks/use-my-issues.js';
import { HomeScreen } from '../../../../src/surfaces/tui/screens/home.js';
import { NavigationProvider, type NavigationValue } from '../../../../src/surfaces/tui/navigation.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Enter (retorno de carro). */
const ENTER = '\r';
/** Caractere ESC (0x1B) — prefixo das sequências CSI de seta abaixo. */
const ESC = String.fromCharCode(0x1b);
/** Sequência CSI da seta para baixo (mesma decodificada por `parse-keypress` do Ink). */
const ARROW_DOWN = `${ESC}[B`;

/** Constrói um `NavigationValue` de teste com todos os métodos espiados. */
function navMock(overrides: Partial<NavigationValue> = {}): NavigationValue {
  return {
    stack: ['welcome', 'home'],
    current: 'home',
    push: vi.fn(),
    navigate: vi.fn(),
    pop: vi.fn(),
    replace: vi.fn(),
    resetTo: vi.fn(),
    ...overrides,
  };
}

function mockState(state: MyIssuesState, retry: () => void = vi.fn()): void {
  vi.mocked(useMyIssuesModule.useMyIssues).mockReturnValue({ state, retry });
}

/** Mocka `useIssueSearch` — default `idle` (spy `clear` acessível via retorno). */
function mockSearchState(
  state: IssueSearchState = { status: 'idle' },
  clear: () => void = vi.fn(),
): ReturnType<typeof vi.fn> {
  const spy = vi.mocked(useIssueSearchModule.useIssueSearch);
  spy.mockReturnValue({ state, clear });
  return spy;
}

function renderHome(nav: NavigationValue = navMock()) {
  const utils = render(
    <ThemeProvider>
      <NavigationProvider value={nav}>
        <HomeScreen />
      </NavigationProvider>
    </ThemeProvider>,
  );
  return { ...utils, nav };
}

beforeEach(() => {
  // Default neutro: testes que não exercitam a busca não precisam mockar
  // `useIssueSearch` explicitamente.
  mockSearchState();
});

afterEach(() => {
  // Reason: `HomeScreen` registra um interceptor de Esc em nível de módulo
  // (`use-escape-interceptor.ts`) enquanto a busca está aberta — sem
  // desmontar/resetar entre testes, um teste anterior poderia deixar o
  // interceptor "vivo" para o próximo (`ink-testing-library` não desmonta
  // sozinho, mesmo padrão já documentado em `app.test.tsx`).
  cleanup();
  resetEscapeInterceptor();
  vi.mocked(useMyIssuesModule.useMyIssues).mockReset();
  vi.mocked(useIssueSearchModule.useIssueSearch).mockReset();
});

describe('TUI: HomeScreen — estado loading', () => {
  it('mostra o spinner enquanto carrega', () => {
    mockState({ status: 'loading' });
    const { lastFrame } = renderHome();
    expect(lastFrame()).toContain('Carregando');
  });
});

describe('TUI: HomeScreen — estado vazio', () => {
  it('mostra "nenhuma issue atribuída"', () => {
    mockState({ status: 'empty' });
    const { lastFrame } = renderHome();
    expect(lastFrame()).toContain('nenhuma issue atribuída');
  });
});

describe('TUI: HomeScreen — erro de rede', () => {
  it('mostra o banner de erro e o hint de retry', () => {
    mockState({ status: 'error-network', message: 'network unreachable' });
    const { lastFrame } = renderHome();
    expect(lastFrame()).toContain('network unreachable');
    expect(lastFrame()).toContain('r');
  });

  it('"r" chama retry()', () => {
    const retry = vi.fn();
    mockState({ status: 'error-network', message: 'network unreachable' }, retry);
    const { stdin } = renderHome();
    stdin.write('r');
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('TUI: HomeScreen — 403', () => {
  it('mostra mensagem específica de permissão', () => {
    mockState({ status: 'error-forbidden', message: 'Sem permissão para listar suas issues nesta instância (403).' });
    const { lastFrame } = renderHome();
    expect(lastFrame()).toContain('permiss');
    expect(lastFrame()).toContain('403');
  });
});

describe('TUI: HomeScreen — abandono do re-login (fix do review #120)', () => {
  it('mostra a mensagem neutra de "auth-aborted" (não o banner de erro)', () => {
    mockState({ status: 'auth-aborted', message: 'login cancelado — pressione r para tentar de novo' });
    const { lastFrame } = renderHome();
    expect(lastFrame()).toContain('login cancelado');
    expect(lastFrame()).toContain('pressione r');
  });

  it('"r" chama retry() a partir do estado "auth-aborted"', () => {
    const retry = vi.fn();
    mockState({ status: 'auth-aborted', message: 'login cancelado — pressione r para tentar de novo' }, retry);
    const { stdin } = renderHome();
    stdin.write('r');
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('TUI: HomeScreen — lista com issues', () => {
  const ISSUES = [
    { id: 10, subject: 'Corrigir bug de login', statusName: 'Nova' },
    { id: 11, subject: 'Implementar exportação', statusName: 'Em andamento' },
  ];

  it('lista cada issue com #id, subject e status', () => {
    mockState({ status: 'loaded', issues: ISSUES });
    const { lastFrame } = renderHome();
    expect(lastFrame()).toContain('#10');
    expect(lastFrame()).toContain('Corrigir bug de login');
    expect(lastFrame()).toContain('Nova');
    expect(lastFrame()).toContain('#11');
    expect(lastFrame()).toContain('Implementar exportação');
    expect(lastFrame()).toContain('Em andamento');
  });

  it('navega a seleção com as setas (useListNavigation)', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    const { lastFrame, stdin } = renderHome();
    const before = lastFrame();
    stdin.write(ARROW_DOWN);
    await vi.waitFor(() => {
      expect(lastFrame()).not.toBe(before);
    });
  });

  it('Enter sobre a issue selecionada empilha "issue-detail"', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    const nav = navMock();
    const { stdin } = renderHome(nav);
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith('issue-detail');
    });
  });
});

describe('TUI: HomeScreen — busca inline (M2-07, #30)', () => {
  const ISSUES = [{ id: 20, subject: 'Issue qualquer', statusName: 'Nova' }];

  it('"/" abre o campo de busca inline', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    const { lastFrame, stdin } = renderHome();
    expect(lastFrame()).not.toContain('digite para buscar');
    stdin.write('/');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('digite para buscar');
    });
  });

  it('digitar no campo aberto repassa a query mais recente a useIssueSearch', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    const spy = mockSearchState();
    const { lastFrame, stdin } = renderHome();
    stdin.write('/');
    // Espera o campo estar de fato montado/ativo (não só que o hook tenha
    // sido chamado — ele já é chamado em TODO render, mesmo sem busca aberta).
    await vi.waitFor(() => expect(lastFrame()).toContain('digite para buscar'));

    stdin.write('bug');
    await vi.waitFor(() => {
      expect(spy).toHaveBeenLastCalledWith('bug', 'all');
    });
  });

  it('resultado da busca renderiza o conteúdo devolvido por useIssueSearch', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState({
      status: 'loaded',
      content: '# Resultados da busca (1)\n- **#7** — status: Nova — assunto de teste',
      count: 1,
      degraded: false,
      warnings: [],
    });
    const { lastFrame, stdin } = renderHome();
    stdin.write('/');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('assunto de teste');
    });
  });

  it('degradação (full-text indisponível) exibe o aviso presente no payload', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState({
      status: 'loaded',
      content: '> Aviso: Busca full-text indisponível.\n',
      count: 0,
      degraded: true,
      warnings: ['Busca full-text indisponível (404 not found); exibindo apenas os filtros estruturados.'],
    });
    const { lastFrame, stdin } = renderHome();
    stdin.write('/');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('indispon');
    });
  });

  it('"f" cicla o filtro de status (aberta → fechada → todas), mostrado como badge', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    const spy = mockSearchState();
    const { lastFrame, stdin } = renderHome();
    stdin.write('/');
    await vi.waitFor(() => expect(lastFrame()).toContain('todas'));

    stdin.write('f');
    await vi.waitFor(() => expect(lastFrame()).toContain('aberta'));
    expect(spy).toHaveBeenLastCalledWith('', 'open');

    stdin.write('f');
    await vi.waitFor(() => expect(lastFrame()).toContain('fechada'));

    stdin.write('f');
    await vi.waitFor(() => expect(lastFrame()).toContain('todas'));
  });

  it('Esc (via consumeEscapeInterceptor) fecha a busca e restaura a lista original SEM nova chamada', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    const clear = vi.fn();
    const spy = mockSearchState({ status: 'idle' }, clear);
    const { lastFrame, stdin } = renderHome();

    stdin.write('/');
    await vi.waitFor(() => expect(lastFrame()).toContain('digite para buscar'));
    const callsBeforeEscape = spy.mock.calls.length;

    // Mesmo mecanismo consultado pelo roteador global (`../app.tsx`) antes do
    // `pop()` padrão — aqui simulado diretamente pois este teste não monta o
    // `AppShell` (só a `HomeScreen` isolada, como os demais testes do arquivo).
    expect(consumeEscapeInterceptor()).toBe(true);

    // O `pop()`/repaint do Ink é assíncrono (mesmo motivo documentado no
    // topo do arquivo de app.test.tsx) — espera o frame refletir o fechamento.
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain('digite para buscar');
    });
    expect(lastFrame()).toContain('Issue qualquer');
    expect(clear).toHaveBeenCalledOnce();
    // "sem nova chamada": nenhum call ADICIONAL de useIssueSearch com uma
    // query diferente da anterior — a única mudança é o efeito do próprio
    // re-render (idle → idle), nunca uma busca nova.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeEscape);
    for (const call of spy.mock.calls.slice(callsBeforeEscape)) {
      expect(call[0]).toBe('');
      expect(call[1]).toBe('all');
    }
  });

  it('Esc fora do modo de busca não é interceptado (deixa o pop() global agir)', () => {
    mockState({ status: 'loaded', issues: ISSUES });
    renderHome();
    expect(consumeEscapeInterceptor()).toBe(false);
  });
});
