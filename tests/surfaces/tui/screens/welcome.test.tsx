/**
 * Testes da tela de boas-vindas isolada (`welcome.tsx`) — cobre a evolução
 * do M2-05.1 (issue #27): Enter abre o onboarding (`onboarding-url`), além
 * do atalho já existente para os atalhos (`?`, coberto em `../app.test.tsx`).
 * Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { NavigationProvider, useNavigationStack } from '../../../../src/surfaces/tui/navigation.js';
import { WelcomeScreen } from '../../../../src/surfaces/tui/screens/welcome.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Enter (retorno de carro). */
const ENTER = '\r';

/** Harness: monta a pilha real para observar `push('onboarding-url')`. */
function Harness() {
  const navigation = useNavigationStack('welcome');
  return (
    <ThemeProvider>
      <NavigationProvider value={navigation}>
        <Text>stack:{navigation.stack.join('>')}</Text>
        <WelcomeScreen />
      </NavigationProvider>
    </ThemeProvider>
  );
}

describe('TUI: WelcomeScreen', () => {
  it('mostra a dica para iniciar o onboarding com Enter', () => {
    const { lastFrame } = render(<Harness />);
    expect(lastFrame()).toContain('Enter');
  });

  it('Enter empilha a tela de URL do onboarding', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:welcome>onboarding-url');
    });
  });
});
