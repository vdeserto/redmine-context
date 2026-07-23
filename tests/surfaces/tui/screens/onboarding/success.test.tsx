/**
 * Testes da tela de onboarding "Sucesso" (#28) — splash comemorativa com o
 * usuário autenticado; Enter segue para o início com a pilha resetada via
 * `replace`. Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { render as inkRender } from 'ink-testing-library';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Árvores montadas de testes anteriores continuam com useInput vivo e podem
// capturar teclas do teste corrente (flakiness em execução agrupada) — cada
// teste desmonta a sua no afterEach.
const INSTANCES: Array<{ unmount(): void }> = [];
function render(tree: Parameters<typeof inkRender>[0]): ReturnType<typeof inkRender> {
  const instance = inkRender(tree);
  INSTANCES.push(instance);
  return instance;
}

import { NavigationProvider, useNavigationStack } from '../../../../../src/surfaces/tui/navigation.js';
import {
  OnboardingProvider,
  useOnboarding,
  type OnboardingUser,
} from '../../../../../src/surfaces/tui/screens/onboarding/onboarding-context.js';
import { OnboardingSuccessScreen } from '../../../../../src/surfaces/tui/screens/onboarding/success.js';
import { ThemeProvider } from '../../../../../src/surfaces/tui/theme.js';

/** Enter (retorno de carro). */
const ENTER = '\r';

const USER: OnboardingUser = { id: 42, login: 'alice', name: 'Alice Liddell' };

/** Grava `user` no contexto assim que monta (via `setUser`), sem depender de um login real. */
function SetUser({ user }: { user: OnboardingUser | undefined }) {
  const { setUser } = useOnboarding();
  useEffect(() => {
    if (user !== undefined) {
      setUser(user);
    }
  }, []);
  return null;
}

/** Harness: pilha real (para observar `replace`) + `user` pré-carregado no contexto. */
function SuccessHarness({ user }: { user?: OnboardingUser }) {
  const navigation = useNavigationStack('onboarding-success');
  return (
    <ThemeProvider>
      <NavigationProvider value={navigation}>
        <OnboardingProvider>
          <SetUser user={user} />
          <Text>stack:{navigation.stack.join('>')}</Text>
          <OnboardingSuccessScreen />
        </OnboardingProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}

afterEach(() => {
  while (INSTANCES.length > 0) INSTANCES.pop()?.unmount();
});

describe('TUI: OnboardingSuccessScreen', () => {
  it('mostra o nome e o login do usuário autenticado', async () => {
    const { lastFrame } = render(<SuccessHarness user={USER} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Alice Liddell');
    });
    expect(lastFrame()).toContain('alice');
    expect(lastFrame()).toContain('sucesso');
  });

  it('não quebra quando não há user (defensivo)', () => {
    const { lastFrame } = render(<SuccessHarness />);
    expect(lastFrame()).toContain('Bem-vindo');
  });

  it('Enter segue para o início com a pilha resetada via replace (topo trocado)', async () => {
    const { lastFrame, stdin } = render(<SuccessHarness user={USER} />);
    expect(lastFrame()).toContain('stack:onboarding-success');

    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:welcome');
    });
    expect(lastFrame()).not.toContain('onboarding-success');
  });
});
