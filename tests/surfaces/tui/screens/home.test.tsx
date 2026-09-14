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

import { symbols } from '../../../../src/surfaces/tui/symbols.js';
import {
  consumeEscapeInterceptor,
  resetEscapeInterceptor,
} from '../../../../src/surfaces/tui/hooks/use-escape-interceptor.js';
import * as useIssueSearchModule from '../../../../src/surfaces/tui/hooks/use-issue-search.js';
import { resetTypingGuard } from '../../../../src/surfaces/tui/hooks/use-typing-guard.js';
import type { IssueSearchState } from '../../../../src/surfaces/tui/hooks/use-issue-search.js';
import * as useMyIssuesModule from '../../../../src/surfaces/tui/hooks/use-my-issues.js';
import type { MyIssuesState } from '../../../../src/surfaces/tui/hooks/use-my-issues.js';
import { NavigationProvider, type NavigationValue } from '../../../../src/surfaces/tui/navigation.js';
import { HomeSelectionProvider } from '../../../../src/surfaces/tui/screens/home-selection.js';
import { HomeScreen } from '../../../../src/surfaces/tui/screens/home.js';
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
        {/* #31: `HomeScreen` agora depende de `useHomeSelection()` (índice
            preservado + issue selecionada) — ver `home-selection.test.tsx`
            para a cobertura dedicada desse contrato. */}
        <HomeSelectionProvider>
          <HomeScreen />
        </HomeSelectionProvider>
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
  // A guarda de digitação é um contador em nível de módulo: um campo montado
  // e não desmontado vazaria o estado para o próximo teste, suspendendo
  // atalhos que deveriam funcionar.
  resetTypingGuard();
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
      expect(spy).toHaveBeenLastCalledWith('bug', 'open');
    });
  });

  // A tela renderiza os itens ESTRUTURADOS: o `content` é Markdown do bundle,
  // com fences `<untrusted-content>` destinadas ao LLM — exibi-las seria ruído.
  it('resultado da busca renderiza os itens, não o Markdown com fences', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState({
      status: 'loaded',
      content: '# Resultados (1)\n- **#7** — <untrusted-content>assunto de teste</untrusted-content>',
      items: [{ id: 7, subject: 'assunto de teste', status: 'Nova', assignee: 'Victor' }],
      count: 1,
      degraded: false,
      warnings: [],
    });
    const { lastFrame, stdin } = renderHome();
    stdin.write('/');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('assunto de teste');
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('#7');
    expect(frame).toContain('Nova');
    // A marcação do bundle NÃO chega à tela.
    expect(frame).not.toContain('untrusted-content');
  });

  it('degradação (full-text indisponível) exibe o aviso presente no payload', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState({
      status: 'loaded',
      content: '> Aviso: Busca full-text indisponível.\n',
      items: [],
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

  // `f` abre um SELETOR em vez de ciclar: a instância tem uma dezena de status
  // (Nova, Fila, Atribuída, Em Andamento…) e todos são "abertos" — ciclar
  // aberto/fechado devolvia a mesma lista e parecia que nada acontecia.
  it('"f" abre o seletor de status com os agregados e o atual marcado', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState();
    const { lastFrame, stdin } = renderHome();
    await vi.waitFor(() => expect(lastFrame()).toContain('[Abertas]'));

    stdin.write('f');

    await vi.waitFor(() => expect(lastFrame()).toContain('Filtrar por status'));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Todas');
    expect(frame).toContain('Abertas');
    expect(frame).toContain('Fechadas');
    // O default (`open`) aparece marcado como atual.
    expect(frame).toContain('atual');
    expect(frame).toContain('Enter');
    expect(frame).toContain('Esc');
  });

  it('Enter no seletor aplica o filtro escolhido à lista', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState();
    const { lastFrame, stdin } = renderHome();
    await vi.waitFor(() => expect(lastFrame()).toContain('[Abertas]'));

    stdin.write('f');
    await vi.waitFor(() => expect(lastFrame()).toContain('Filtrar por status'));

    // Sobe uma posição: de "Abertas" para "Todas".
    stdin.write('k');
    stdin.write(ENTER);

    await vi.waitFor(() => expect(lastFrame()).toContain('[Todas]'));
    expect(useMyIssuesModule.useMyIssues).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusFilter: 'all' }),
    );
  });

  // Regressão: o Ink entrega a tecla a TODOS os handlers, então o Enter que
  // aplica o filtro abria também a issue selecionada por baixo.
  it('Enter no seletor NÃO abre a issue selecionada', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState();
    const nav = navMock();
    const { lastFrame, stdin } = renderHome(nav);
    await vi.waitFor(() => expect(lastFrame()).toContain('[Abertas]'));

    stdin.write('f');
    await vi.waitFor(() => expect(lastFrame()).toContain('Filtrar por status'));
    stdin.write(ENTER);

    await vi.waitFor(() => expect(lastFrame()).not.toContain('Filtrar por status'));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('Esc cancela o seletor sem mudar o filtro', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState();
    const { lastFrame, stdin } = renderHome();
    await vi.waitFor(() => expect(lastFrame()).toContain('[Abertas]'));

    stdin.write('f');
    await vi.waitFor(() => expect(lastFrame()).toContain('Filtrar por status'));
    expect(consumeEscapeInterceptor()).toBe(true);

    await vi.waitFor(() => expect(lastFrame()).not.toContain('Filtrar por status'));
    expect(lastFrame()).toContain('[Abertas]');
  });

  it('o filtro escolhido no seletor chega à LISTA (useMyIssues), não só à busca', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState();
    const { lastFrame, stdin } = renderHome();
    await vi.waitFor(() => expect(lastFrame()).toContain('[Abertas]'));

    stdin.write('f');
    await vi.waitFor(() => expect(lastFrame()).toContain('Filtrar por status'));
    // Desce de "Abertas" para "Fechadas".
    stdin.write('j');
    stdin.write(ENTER);

    await vi.waitFor(() => expect(lastFrame()).toContain('[Fechadas]'));
    expect(useMyIssuesModule.useMyIssues).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusFilter: 'closed' }),
    );
  });

  // Regressão: o filtro é escolhido ANTES da busca e governa a LISTA — fechar a
  // busca não pode desfazer essa escolha (achado M1 da auditoria de QA).
  it('Esc na busca PRESERVA o filtro escolhido para a lista', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState();
    const { lastFrame, stdin } = renderHome();
    await vi.waitFor(() => expect(lastFrame()).toContain('[Abertas]'));

    // Escolhe "Fechadas" no seletor.
    stdin.write('f');
    await vi.waitFor(() => expect(lastFrame()).toContain('Filtrar por status'));
    stdin.write('j');
    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain('[Fechadas]'));

    // Abre a busca e fecha com Esc, sem tocar no filtro.
    stdin.write('/');
    await vi.waitFor(() => expect(lastFrame()).toContain('digite para buscar'));
    expect(consumeEscapeInterceptor()).toBe(true);

    await vi.waitFor(() => expect(lastFrame()).not.toContain('digite para buscar'));
    expect(lastFrame()).toContain('[Fechadas]');
    expect(useMyIssuesModule.useMyIssues).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusFilter: 'closed' }),
    );
  });


  // Achar o chamado e não conseguir abrir é o mesmo que não ter achado: a
  // navegação da LISTA fica desligada durante a busca (as teclas pertencem ao
  // campo), então os resultados precisam da sua própria.
  describe('navegação nos resultados da busca', () => {
    const ITENS = [
      { id: 71219, subject: 'Primeiro resultado', status: 'Fechada', assignee: 'Victor' },
      { id: 71119, subject: 'Segundo resultado', status: 'Fechada', assignee: 'Victor' },
    ];

    function buscaCom(items: typeof ITENS) {
      mockState({ status: 'loaded', issues: ISSUES });
      mockSearchState({
        status: 'loaded',
        content: '',
        items,
        count: items.length,
        degraded: false,
        warnings: [],
      });
    }

    it('setas movem o cursor entre os resultados', async () => {
      buscaCom(ITENS);
      const { lastFrame, stdin } = renderHome();
      stdin.write('/');
      await vi.waitFor(() => expect(lastFrame()).toContain('Primeiro resultado'));

      // O primeiro começa selecionado; a seta move para o segundo.
      stdin.write(ARROW_DOWN);
      await vi.waitFor(() => {
        const linha = (lastFrame() ?? '').split('\n').find((l) => l.includes('Segundo resultado'));
        expect(linha).toContain(symbols.pointerSmall);
      });
    });

    it('Enter abre a issue sob o cursor', async () => {
      buscaCom(ITENS);
      const nav = navMock();
      const { lastFrame, stdin } = renderHome(nav);
      stdin.write('/');
      await vi.waitFor(() => expect(lastFrame()).toContain('Primeiro resultado'));

      stdin.write(ARROW_DOWN);
      stdin.write(ENTER);

      await vi.waitFor(() => expect(nav.push).toHaveBeenCalledWith('issue-detail'));
    });

    // Failure case: sem resultados, Enter não pode navegar para lugar nenhum.
    it('Enter não faz nada quando a busca não devolveu resultados', async () => {
      buscaCom([]);
      const nav = navMock();
      const { lastFrame, stdin } = renderHome(nav);
      stdin.write('/');
      await vi.waitFor(() => expect(lastFrame()).toContain('nenhuma issue encontrada'));

      stdin.write(ENTER);

      await vi.waitFor(() => expect(lastFrame()).toContain('nenhuma issue encontrada'));
      expect(nav.push).not.toHaveBeenCalled();
    });
  });

  it('"f" com a busca ABERTA digita na query (buscar "workflow" é possível) e NÃO abre o seletor', async () => {
    mockState({ status: 'loaded', issues: ISSUES });
    mockSearchState();
    const { lastFrame, stdin } = renderHome();
    stdin.write('/');
    await vi.waitFor(() => expect(lastFrame()).toContain('digite para buscar'));

    stdin.write('f');
    await vi.waitFor(() => expect(lastFrame()).toMatch(/Buscar: f/));
    // O filtro permaneceu no default e o SELETOR não abriu — dentro do campo,
    // "f" é texto.
    expect(lastFrame()).toContain('[Abertas]');
    expect(lastFrame()).not.toContain('Filtrar por status');
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

describe('TUI: HomeScreen — painel de jobs (#34)', () => {
  it('"t" empilha "jobs" com a busca fechada', async () => {
    mockState({ status: 'loaded', issues: [] });
    const nav = navMock();
    const { stdin } = renderHome(nav);
    stdin.write('t');
    await vi.waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith('jobs');
    });
  });

  it('"t" digitado dentro da busca aberta vira texto da query, não navega', async () => {
    mockState({ status: 'loaded', issues: [] });
    const spy = mockSearchState();
    const nav = navMock();
    const { lastFrame, stdin } = renderHome(nav);
    stdin.write('/');
    await vi.waitFor(() => expect(lastFrame()).toContain('digite para buscar'));

    stdin.write('t');
    await vi.waitFor(() => {
      expect(spy).toHaveBeenLastCalledWith('t', 'open');
    });
    expect(nav.push).not.toHaveBeenCalledWith('jobs');
  });
});
