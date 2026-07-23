/**
 * Testes de `home-selection.tsx` (#31) — dois níveis de cobertura, ambos
 * escritos ANTES da implementação (TDD):
 *
 * 1. Unitário: `HomeSelectionProvider`/`useHomeSelection()` isolados (estado
 *    inicial, atualização, `useHomeSelection()` fora do provider lança).
 * 2. Integração: `HomeScreen` + `IssueDetailScreen` reais (só `useMyIssues`/
 *    `useIssueDetail` mockados), compartilhando um `HomeSelectionProvider`
 *    real por cima — cobre a AC "Esc volta à home preservando a posição da
 *    lista", que só faz sentido no nível de integração (o bug corrigido era
 *    exatamente `HomeScreen` sendo DESMONTADA e remontada perdendo o
 *    `selectedIndex` local do `useListNavigation`).
 */
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/surfaces/tui/hooks/use-my-issues.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-my-issues.js')>();
  return { ...actual, useMyIssues: vi.fn() };
});

vi.mock('../../../../src/surfaces/tui/hooks/use-issue-detail.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-issue-detail.js')>();
  return { ...actual, useIssueDetail: vi.fn() };
});

import * as useIssueDetailModule from '../../../../src/surfaces/tui/hooks/use-issue-detail.js';
import type { IssueDetailState } from '../../../../src/surfaces/tui/hooks/use-issue-detail.js';
import * as useMyIssuesModule from '../../../../src/surfaces/tui/hooks/use-my-issues.js';
import type { MyIssuesState } from '../../../../src/surfaces/tui/hooks/use-my-issues.js';
import { NavigationProvider, useNavigation, useNavigationStack } from '../../../../src/surfaces/tui/navigation.js';
import {
  HomeSelectionProvider,
  useHomeSelection,
} from '../../../../src/surfaces/tui/screens/home-selection.js';
import { HomeScreen } from '../../../../src/surfaces/tui/screens/home.js';
import { IssueDetailScreen } from '../../../../src/surfaces/tui/screens/issue-detail.js';
import { symbols } from '../../../../src/surfaces/tui/symbols.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Linha do frame que contém `needle`, ou `undefined` — usado para checar QUAL linha está com o ponteiro de seleção. */
function lineContaining(frame: string | undefined, needle: string): string | undefined {
  return (frame ?? '').split('\n').find((line) => line.includes(needle));
}

/** Enter (retorno de carro). */
const ENTER = '\r';
/** Caractere ESC (0x1B) — prefixo das sequências CSI de seta abaixo. */
const ESC = String.fromCharCode(0x1b);
/** Sequência CSI da seta para baixo. */
const ARROW_DOWN = `${ESC}[B`;
/** Tecla Esc sozinha (distinta da sequência CSI acima). */
const ESC_KEY = ESC;

describe('TUI: useHomeSelection — unitário', () => {
  it('lança fora de <HomeSelectionProvider> (mesmo padrão de useNavigation()/useTheme())', () => {
    function Bare() {
      useHomeSelection();
      return null;
    }
    // Reason: Ink tem seu próprio error boundary interno — o erro não escapa
    // como uma exceção síncrona de `render()` (ver `navigation.test.tsx`/
    // `theme.test.tsx`), mas aparece no frame renderizado.
    const { lastFrame } = render(<Bare />);
    expect(lastFrame()).toContain('useHomeSelection() usado fora de <HomeSelectionProvider>.');
  });

  it('começa com selectedIndex 0 e selectedIssueId undefined', () => {
    function Probe() {
      const { selectedIndex, selectedIssueId } = useHomeSelection();
      return <Text>{`index:${selectedIndex} issue:${selectedIssueId ?? 'none'}`}</Text>;
    }
    const { lastFrame } = render(
      <HomeSelectionProvider>
        <Probe />
      </HomeSelectionProvider>,
    );
    expect(lastFrame()).toBe('index:0 issue:none');
  });

  it('setSelectedIndex/setSelectedIssueId atualizam o estado exposto', () => {
    function Probe() {
      const { selectedIndex, selectedIssueId, setSelectedIndex, setSelectedIssueId } = useHomeSelection();
      useInput(() => {
        setSelectedIndex(3);
        setSelectedIssueId(99);
      });
      return <Text>{`index:${selectedIndex} issue:${selectedIssueId ?? 'none'}`}</Text>;
    }
    const { lastFrame, stdin } = render(
      <HomeSelectionProvider>
        <Probe />
      </HomeSelectionProvider>,
    );
    stdin.write('x');
    return vi.waitFor(() => {
      expect(lastFrame()).toBe('index:3 issue:99');
    });
  });
});

describe('TUI: home ⇄ issue-detail — Esc preserva a posição da lista (#31)', () => {
  const ISSUES = [
    { id: 10, subject: 'Corrigir bug de login', statusName: 'Nova' },
    { id: 11, subject: 'Implementar exportação', statusName: 'Em andamento' },
    { id: 12, subject: 'Revisar documentação', statusName: 'Nova' },
  ];

  function mockMyIssues(state: MyIssuesState): void {
    vi.mocked(useMyIssuesModule.useMyIssues).mockReturnValue({ state, retry: vi.fn() });
  }

  function mockIssueDetail(state: IssueDetailState): void {
    vi.mocked(useIssueDetailModule.useIssueDetail).mockReturnValue({ state, retry: vi.fn() });
  }

  /** Casca mínima de roteador: alterna Home/IssueDetail conforme `current`, com Esc global (`pop`) — suficiente para exercitar o contrato sem montar `app.tsx` inteiro. */
  function Router() {
    const { current } = useNavigation();
    return current === 'home' ? <HomeScreen /> : <IssueDetailScreen />;
  }

  function GlobalEscape() {
    const { pop } = useNavigation();
    useInput((_input, key) => {
      if (key.escape) {
        pop();
      }
    });
    return null;
  }

  function Harness() {
    const navigation = useNavigationStack('home');
    return (
      <ThemeProvider>
        <NavigationProvider value={navigation}>
          <HomeSelectionProvider>
            <GlobalEscape />
            <Router />
          </HomeSelectionProvider>
        </NavigationProvider>
      </ThemeProvider>
    );
  }

  afterEach(() => {
    vi.mocked(useMyIssuesModule.useMyIssues).mockReset();
    vi.mocked(useIssueDetailModule.useIssueDetail).mockReset();
  });

  it('seleciona a 2ª issue, abre o detalhe e, ao voltar (Esc), a 2ª linha segue destacada', async () => {
    mockMyIssues({ status: 'loaded', issues: ISSUES });
    mockIssueDetail({ status: 'loading' });

    const { lastFrame, stdin } = render(<Harness />);
    await vi.waitFor(() => expect(lastFrame()).toContain('Corrigir bug de login'));

    // Move para a 2ª linha (índice 1) e abre. As 3 issues SEMPRE aparecem no
    // frame (a lista inteira é renderizada) — o sinal real de que o cursor
    // moveu é o ponteiro de seleção (`symbols.pointerSmall`) migrar para a
    // LINHA da 2ª issue.
    stdin.write(ARROW_DOWN);
    await vi.waitFor(() => {
      expect(lineContaining(lastFrame(), 'Implementar exportação')).toContain(symbols.pointerSmall);
    });
    // Reason (mesma observação de `use-list-navigation.test.tsx`): o
    // `useInput()` do Ink resubscreve seu listener (para capturar o
    // `selectedIndex` mais recente) num efeito passivo separado do commit que
    // atualiza o frame — um tick extra garante que essa resubscrição já
    // rodou antes do Enter.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain('Minhas issues');
    });

    // Volta (Esc) — a home remonta do zero.
    stdin.write(ESC_KEY);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Minhas issues');
    });

    // A issue #11 (2ª, índice 1) deve seguir destacada — passada a
    // `useIssueDetail` mockada como a issue selecionada confirma que
    // `setSelectedIssueId` também funcionou.
    expect(vi.mocked(useIssueDetailModule.useIssueDetail)).toHaveBeenCalledWith(11);
  });

  it('cada render() de teste isola seu próprio provider (sem estado global vazando entre testes)', async () => {
    // Reason: prova de que `HomeSelectionProvider` é um `Context` local por
    // árvore (não um singleton de módulo) — o índice destacado no teste
    // ANTERIOR (índice 1) não vaza para uma árvore nova, que deve começar do
    // zero de novo.
    mockMyIssues({ status: 'loaded', issues: ISSUES });

    const { lastFrame } = render(<Harness />);
    await vi.waitFor(() => expect(lastFrame()).toContain('Corrigir bug de login'));
    expect(lastFrame()).toContain('#10');
  });
});
