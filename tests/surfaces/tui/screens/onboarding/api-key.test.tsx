/**
 * Testes da tela de onboarding "Colar api_key" (#28) — campo único mascarado
 * (nunca ecoa a key em texto); ao confirmar, valida via `callbacks.onApiKeySubmit`
 * ANTES de navegar para a splash. Escrito ANTES da implementação (TDD).
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
import type { ScreenName } from '../../../../../src/surfaces/tui/screen.js';
import {
  OnboardingProvider,
  useOnboarding,
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

/** Dispara `beginReAuth` assim que monta — simula o que `use-auth-guard.ts` já fez antes desta tela existir. */
function BeginReAuth({ origin, retry }: { origin: ScreenName; retry: () => void }) {
  const { beginReAuth } = useOnboarding();
  useEffect(() => {
    beginReAuth(origin, { retry, reject: () => undefined });
  }, []);
  return null;
}

/**
 * Harness M2-13 (#36): pilha com uma tela de origem + `onboarding-api-key`
 * empilhada por cima (o fallback de 2FA de um re-auth, ver `validating.tsx`),
 * e um `reAuth` já em andamento.
 */
function ReAuthApiKeyHarness({
  onApiKeySubmit,
  retry,
}: {
  onApiKeySubmit: (apiKey: string) => Promise<OnboardingLoginOutcome>;
  retry: () => void;
}) {
  const navigation = useNavigationStack('about');
  useEffect(() => {
    navigation.push('onboarding-api-key');
    // Reason: simula a pilha já empilhada por `useAuthGuard`/`validating.tsx`
    // antes desta tela montar — roda uma única vez, na montagem do harness.
  }, []);
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
          <BeginReAuth origin="about" retry={retry} />
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

  it('re-auth (M2-13, #36): sucesso volta à tela de origem e retoma a operação (retry), sem passar pela splash', async () => {
    const retry = vi.fn();
    const onApiKeySubmit = vi.fn(() =>
      Promise.resolve<OnboardingLoginOutcome>({
        kind: 'success',
        user: { id: 1, login: 'alice', name: 'Alice' },
      }),
    );
    const { lastFrame, stdin } = render(<ReAuthApiKeyHarness onApiKeySubmit={onApiKeySubmit} retry={retry} />);
    stdin.write(PASTED_KEY);
    await vi.waitFor(() => expect(lastFrame()).toContain('•'.repeat(PASTED_KEY.length)));
    stdin.write(ENTER);
    // Reason: "stack:about" também é PREFIXO de "stack:about>onboarding-api-key"
    // — casa a linha inteira (fim de linha) para não passar antes do popTo.
    await vi.waitFor(() => {
      expect(lastFrame()).toMatch(/stack:about$/m);
    });
    expect(lastFrame()).not.toContain('onboarding-success');
    // Reason: `resolveReAuth()` limpa o estado num updater funcional do
    // React — o `retry()` guardado só dispara quando esse updater roda,
    // numa passagem de commit LOGO APÓS a mudança de pilha observada acima
    // (não na mesma volta síncrona do `.then()`).
    await vi.waitFor(() => {
      expect(retry).toHaveBeenCalledTimes(1);
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
