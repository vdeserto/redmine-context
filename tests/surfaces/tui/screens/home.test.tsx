/**
 * Testes da tela home (M2-06, #29): "minhas issues" via `useMyIssues`
 * (mockado — a busca em si já é coberta por
 * `tests/surfaces/tui/hooks/use-my-issues.test.tsx`). Cobre os 4 estados
 * visuais (loading/empty/error de rede com retry/403), a lista com seleção
 * por teclado e o Enter abrindo o placeholder de detalhe. Escrito ANTES da
 * implementação (TDD).
 */
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/surfaces/tui/hooks/use-my-issues.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-my-issues.js')>();
  return { ...actual, useMyIssues: vi.fn() };
});

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

afterEach(() => {
  vi.mocked(useMyIssuesModule.useMyIssues).mockReset();
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
