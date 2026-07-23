/**
 * Testes da tela de onboarding "Colar api_key" (#28) — campo único mascarado
 * (nunca ecoa a key em texto); ao confirmar, valida via `callbacks.onApiKeySubmit`
 * ANTES de navegar para a splash. Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { render as inkRender } from 'ink-testing-library';
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
  type OnboardingLoginOutcome,
} from '../../../../../src/surfaces/tui/screens/onboarding/onboarding-context.js';
import { OnboardingApiKeyScreen } from '../../../../../src/surfaces/tui/screens/onboarding/api-key.js';
import { ThemeProvider } from '../../../../../src/surfaces/tui/theme.js';

/** Enter (retorno de carro). */
const ENTER = '\r';
const PASTED_KEY = 'pasted-super-secret-key';

/** Harness: pilha real (para observar `replace`) + contexto de onboarding com `onApiKeySubmit` espionável. */
function ApiKeyHarness({
  onApiKeySubmit,
}: {
  onApiKeySubmit: (apiKey: string) => Promise<OnboardingLoginOutcome>;
}) {
  const navigation = useNavigationStack('onboarding-api-key');
  return (
    <ThemeProvider>
      <NavigationProvider value={navigation}>
        <OnboardingProvider
          callbacks={{
            onUrlSubmit: () => undefined,
            onModeSelect: () => undefined,
            onLoginSubmit: () => Promise.resolve({ kind: 'network-error', message: 'unused' }),
            onApiKeySubmit,
          }}
        >
          <Text>stack:{navigation.stack.join('>')}</Text>
          <OnboardingApiKeyScreen />
        </OnboardingProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}

afterEach(() => {
  while (INSTANCES.length > 0) INSTANCES.pop()?.unmount();
});

describe('TUI: OnboardingApiKeyScreen', () => {
  it('a api_key digitada NUNCA aparece no frame — só o caractere de máscara', async () => {
    const { lastFrame, stdin } = render(
      <ApiKeyHarness onApiKeySubmit={() => new Promise(() => {})} />,
    );
    stdin.write(PASTED_KEY);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('•'.repeat(PASTED_KEY.length));
    });
    expect(lastFrame()).not.toContain(PASTED_KEY);
  });

  it('Enter chama onApiKeySubmit com a key digitada e mostra o spinner de validação', async () => {
    const onApiKeySubmit = vi.fn(() => new Promise<OnboardingLoginOutcome>(() => {}));
    const { lastFrame, stdin } = render(<ApiKeyHarness onApiKeySubmit={onApiKeySubmit} />);
    stdin.write(PASTED_KEY);
    await vi.waitFor(() => expect(lastFrame()).toContain('•'.repeat(PASTED_KEY.length)));
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(onApiKeySubmit).toHaveBeenCalledWith(PASTED_KEY);
    });
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Validando');
    });
  });

  it('sucesso: navega para a splash (replace)', async () => {
    const onApiKeySubmit = vi.fn(() =>
      Promise.resolve<OnboardingLoginOutcome>({
        kind: 'success',
        user: { id: 1, login: 'alice', name: 'Alice' },
      }),
    );
    const { lastFrame, stdin } = render(<ApiKeyHarness onApiKeySubmit={onApiKeySubmit} />);
    stdin.write(PASTED_KEY);
    await vi.waitFor(() => expect(lastFrame()).toContain('•'.repeat(PASTED_KEY.length)));
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:onboarding-success');
    });
  });

  it('key inválida: mostra a mensagem de erro sem navegar, key nunca aparece no frame', async () => {
    const onApiKeySubmit = vi.fn(() =>
      Promise.resolve<OnboardingLoginOutcome>({
        kind: 'auth-error',
        message: 'Autenticação falhou (401): api_key inválida ou expirada.',
      }),
    );
    const { lastFrame, stdin } = render(<ApiKeyHarness onApiKeySubmit={onApiKeySubmit} />);
    stdin.write(PASTED_KEY);
    await vi.waitFor(() => expect(lastFrame()).toContain('•'.repeat(PASTED_KEY.length)));
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('inválida ou expirada');
    });
    expect(lastFrame()).toContain('stack:onboarding-api-key');
    expect(lastFrame()).not.toContain(PASTED_KEY);
  });
});
