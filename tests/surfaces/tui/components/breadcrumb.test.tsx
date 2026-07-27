/**
 * Testes do `Breadcrumb` (M2-04) — primeiro componente compartilhado da
 * TUI (`components/`). Puramente apresentacional: recebe a pilha via prop
 * e renderiza o caminho "Início › Atalhos", sem depender do
 * `NavigationProvider`. Escrito ANTES da implementação (TDD).
 */
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { Breadcrumb } from '../../../../src/surfaces/tui/components/breadcrumb.js';
import { SCREENS } from '../../../../src/surfaces/tui/screen.js';
import { symbols } from '../../../../src/surfaces/tui/symbols.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';
import { Catch } from '../catch-boundary.js';

describe('TUI: Breadcrumb', () => {
  it('com pilha de 1 item, renderiza só o título da tela inicial (sem separador)', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Breadcrumb stack={['welcome']} />
      </ThemeProvider>,
    );
    const frame = lastFrame();
    expect(frame).toContain(SCREENS.welcome.title);
    expect(frame).not.toContain(symbols.pointerSmall);
  });

  it('renderiza o caminho completo da pilha, separado pelo símbolo de navegação e na ordem correta', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Breadcrumb stack={['welcome', 'about']} />
      </ThemeProvider>,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain(SCREENS.welcome.title);
    expect(frame).toContain(SCREENS.about.title);
    expect(frame).toContain(symbols.pointerSmall);

    const welcomeIndex = frame.indexOf(SCREENS.welcome.title);
    const separatorIndex = frame.indexOf(symbols.pointerSmall);
    const aboutIndex = frame.indexOf(SCREENS.about.title);
    expect(welcomeIndex).toBeGreaterThanOrEqual(0);
    expect(welcomeIndex).toBeLessThan(separatorIndex);
    expect(separatorIndex).toBeLessThan(aboutIndex);
  });

  it('lança erro quando usado fora do ThemeProvider (consome tokens de cor)', () => {
    // Mesmo padrão de useNavigation()/useTheme(): o erro aparece no frame via
    // o ErrorBoundary interno do Ink, não escapa síncrono de render().
    const { lastFrame } = render(
      <Catch>
        <Breadcrumb stack={['welcome']} />
      </Catch>,
    );
    expect(lastFrame()).toContain('useTheme() usado fora de <ThemeProvider>.');
  });
});
