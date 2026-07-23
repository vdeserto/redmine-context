/**
 * Testes da tela de onboarding "Login" (M2-05.1, issue #27) — usuário (eco
 * normal) e senha (mascarada com `•`, NUNCA ecoada em texto). Escrito ANTES
 * da implementação (TDD).
 */
import { render as inkRender } from 'ink-testing-library';

// Árvores montadas de testes anteriores continuam com useInput vivo e podem
// capturar teclas do teste corrente (flakiness em execução agrupada) — cada
// teste desmonta a sua no afterEach.
const INSTANCES: Array<{ unmount(): void }> = [];
function render(tree: Parameters<typeof inkRender>[0]): ReturnType<typeof inkRender> {
  const instance = inkRender(tree);
  INSTANCES.push(instance);
  return instance;
}
import { Text } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavigationProvider, useNavigationStack } from '../../../../../src/surfaces/tui/navigation.js';
import { OnboardingProvider } from '../../../../../src/surfaces/tui/screens/onboarding/onboarding-context.js';
import { OnboardingLoginScreen } from '../../../../../src/surfaces/tui/screens/onboarding/login.js';
import { ThemeProvider } from '../../../../../src/surfaces/tui/theme.js';

/** Enter (retorno de carro). */
const ENTER = '\r';
/** Tab — alterna o campo focado (usuário <-> senha). */
const TAB = '\t';
/** Um tick de microtask — dá tempo do `useInput()` resubscrever com o estado mais recente. */
async function tick(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Harness: monta a pilha real (para observar `push`) + contexto de onboarding com callback de login espionável. */
function LoginHarness({
  onLoginSubmit,
}: {
  onLoginSubmit?: (credentials: {
    username: string;
    password: string;
  }) => Promise<{ kind: 'network-error'; message: string }>;
}) {
  const navigation = useNavigationStack('onboarding-login');
  return (
    <ThemeProvider>
      <NavigationProvider value={navigation}>
        <OnboardingProvider
          callbacks={{
            onUrlSubmit: () => undefined,
            onModeSelect: () => undefined,
            onLoginSubmit:
              onLoginSubmit ?? (() => Promise.resolve({ kind: 'network-error', message: 'unused' })),
            onApiKeySubmit: () => Promise.resolve({ kind: 'network-error', message: 'unused' }),
          }}
        >
          <Text>stack:{navigation.stack.join('>')}</Text>
          <OnboardingLoginScreen />
        </OnboardingProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}

afterEach(() => {
  while (INSTANCES.length > 0) INSTANCES.pop()?.unmount();
});

describe('TUI: OnboardingLoginScreen', () => {
  it('usuário: eco normal — o valor digitado aparece no frame', async () => {
    const { lastFrame, stdin } = render(<LoginHarness />);
    stdin.write('alice');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('alice');
    });
  });

  it('senha: mascarada — o valor digitado NUNCA aparece no frame, só o caractere de máscara', async () => {
    const { lastFrame, stdin } = render(<LoginHarness />);
    stdin.write('alice');
    await vi.waitFor(() => expect(lastFrame()).toContain('alice'));
    stdin.write(TAB);
    // O useInput do Ink resubscreve num efeito pós-commit; espere o foco
    // visual chegar ao campo de senha antes de digitar.
    await vi.waitFor(() => expect(lastFrame()).toMatch(/[❯>] Senha/));
    stdin.write('hunter2');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('•'.repeat('hunter2'.length));
    });
    expect(lastFrame()).not.toContain('hunter2');
  });

  it('Enter no campo de usuário move o foco para a senha, sem submeter o formulário', async () => {
    const onLoginSubmit = vi.fn();
    const { stdin } = render(<LoginHarness onLoginSubmit={onLoginSubmit} />);
    stdin.write('alice');
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(onLoginSubmit).not.toHaveBeenCalled();
  });

  it('Enter no campo de senha chama onLoginSubmit e navega para a validação (#28)', async () => {
    const onLoginSubmit = vi.fn(() => Promise.resolve({ kind: 'network-error' as const, message: 'unused' }));
    const { lastFrame, stdin } = render(<LoginHarness onLoginSubmit={onLoginSubmit} />);
    stdin.write('alice');
    await vi.waitFor(() => expect(lastFrame()).toContain('alice'));
    stdin.write(TAB);
    // O useInput do Ink resubscreve num efeito pós-commit; espere o foco
    // visual chegar ao campo de senha antes de digitar.
    await vi.waitFor(() => expect(lastFrame()).toMatch(/[❯>] Senha/));
    stdin.write('hunter2');
    await vi.waitFor(() => expect(lastFrame()).toContain('•'.repeat('hunter2'.length)));
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(onLoginSubmit).toHaveBeenCalledWith({ username: 'alice', password: 'hunter2' });
    });
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:onboarding-login>onboarding-validating');
    });
  });
});
