/**
 * Testes da tela de detalhe de issue — placeholder mínimo (M2-06, #29). O
 * detalhe real (bundle completo via o core) é escopo da #31; aqui só se
 * cobre o registro da navegação: renderiza e `b` volta (pop). Escrito ANTES
 * da implementação (TDD).
 */
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { IssueDetailScreen } from '../../../../src/surfaces/tui/screens/issue-detail.js';
import { NavigationProvider, type NavigationValue } from '../../../../src/surfaces/tui/navigation.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

function navMock(overrides: Partial<NavigationValue> = {}): NavigationValue {
  return {
    stack: ['welcome', 'home', 'issue-detail'],
    current: 'issue-detail',
    push: vi.fn(),
    navigate: vi.fn(),
    pop: vi.fn(),
    replace: vi.fn(),
    resetTo: vi.fn(),
    ...overrides,
  };
}

function renderDetail(nav: NavigationValue = navMock()) {
  const utils = render(
    <ThemeProvider>
      <NavigationProvider value={nav}>
        <IssueDetailScreen />
      </NavigationProvider>
    </ThemeProvider>,
  );
  return { ...utils, nav };
}

describe('TUI: IssueDetailScreen (placeholder da #29, detalhe real na #31)', () => {
  it('renderiza um placeholder identificável', () => {
    const { lastFrame } = renderDetail();
    expect(lastFrame()).toContain('Detalhe da issue');
  });

  it('"b" volta para a tela anterior (pop)', () => {
    const nav = navMock();
    const { stdin } = renderDetail(nav);
    stdin.write('b');
    expect(nav.pop).toHaveBeenCalledOnce();
  });
});
