/**
 * Teste do contexto de navegação isolado do roteador: garante que
 * `useNavigation()` falha alto (erro claro) se usado fora do `Provider` —
 * evita telas "soltas" renderizadas sem passar pelo roteador.
 */
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { useNavigation } from '../../../src/surfaces/tui/navigation.js';

/** Componente de teste: chama o hook sem um `NavigationProvider` acima. */
function ScreenWithoutRouter() {
  useNavigation();
  return null;
}

describe('TUI: useNavigation', () => {
  it('lança erro quando usado fora do NavigationProvider', () => {
    // Ink envolve a árvore num ErrorBoundary interno (componentDidCatch): o
    // erro não escapa síncrono de render(), mas é exibido no frame.
    const { lastFrame } = render(<ScreenWithoutRouter />);
    expect(lastFrame()).toContain('useNavigation() usado fora de <NavigationProvider>.');
  });
});
