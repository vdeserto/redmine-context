/**
 * Testes do tema central da TUI (M2-02), escritos ANTES da implementação
 * (TDD): o `ThemeProvider` expõe os tokens semânticos via `useTheme()` e o
 * hook falha alto (mesmo padrão de `useNavigation()`) quando usado fora do
 * provider — evita telas estilizadas "no escuro", sem tema resolvido.
 */
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME, ThemeProvider, useTheme, type Theme } from '../../../src/surfaces/tui/theme.js';
import { Catch } from './catch-boundary.js';

/** Componente de teste: renderiza um token do tema para inspecionar o frame. */
function ThemeConsumer({ token }: { token: keyof Theme }) {
  const theme = useTheme();
  return <Text color={theme[token]}>{theme[token]}</Text>;
}

/** Componente de teste: chama o hook sem um `ThemeProvider` acima. */
function ConsumerWithoutProvider() {
  useTheme();
  return null;
}

describe('TUI: tema (ThemeProvider/useTheme)', () => {
  it('expõe os 7 tokens semânticos esperados com o tema padrão', () => {
    expect(Object.keys(DEFAULT_THEME).sort()).toEqual(
      ['accent', 'border', 'danger', 'muted', 'primary', 'success', 'warning'].sort(),
    );
  });

  it('cada token do tema padrão é uma string de cor não vazia', () => {
    for (const value of Object.values(DEFAULT_THEME)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('useTheme() dentro do ThemeProvider retorna o tema padrão por padrão', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <ThemeConsumer token="primary" />
      </ThemeProvider>,
    );
    expect(lastFrame()).toContain(DEFAULT_THEME.primary);
  });

  it('ThemeProvider aceita um tema customizado via prop', () => {
    const custom: Theme = {
      primary: 'blue',
      accent: 'yellow',
      muted: 'gray',
      success: 'green',
      warning: 'yellow',
      danger: 'red',
    };
    const { lastFrame } = render(
      <ThemeProvider theme={custom}>
        <ThemeConsumer token="primary" />
      </ThemeProvider>,
    );
    expect(lastFrame()).toContain('blue');
  });

  it('lança erro quando useTheme() é usado fora do ThemeProvider', () => {
    // Ink envolve a árvore num ErrorBoundary interno (componentDidCatch): o
    // erro não escapa síncrono de render(), mas é exibido no frame (mesmo
    // padrão adotado no teste de useNavigation()).
    const { lastFrame } = render(
      <Catch>
        <ConsumerWithoutProvider />
      </Catch>,
    );
    expect(lastFrame()).toContain('useTheme() usado fora de <ThemeProvider>.');
  });
});
