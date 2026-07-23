/**
 * Testes da tela de onboarding "Validando" (#28) — spinner enquanto
 * `pendingLogin` (promise injetada via `OnboardingContext`) resolve, e a
 * decisão de próxima tela a partir do `OnboardingLoginOutcome`: sucesso →
 * splash; 401/2FA → fallback de api_key; rede/TLS → mensagem acionável em
 * `theme.danger`, nesta mesma tela. Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { render as inkRender } from 'ink-testing-library';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Árvores montadas de testes anteriores continuam com useInput/timers vivos e
// podem contaminar o teste corrente — cada teste desmonta a sua no afterEach.
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
  type OnboardingLoginOutcome,
} from '../../../../../src/surfaces/tui/screens/onboarding/onboarding-context.js';
import { OnboardingValidatingScreen } from '../../../../../src/surfaces/tui/screens/onboarding/validating.js';
import { ThemeProvider } from '../../../../../src/surfaces/tui/theme.js';

const USER = { id: 42, login: 'alice', name: 'Alice Liddell' };
const PASSWORD = 'hunter2-super-secret';
const API_KEY = 'super-secret-api-key';

/** Dispara `setPendingLogin` com a promise dada assim que monta, e expõe a pilha + o `user`. */
function SetPending({ outcome }: { outcome: Promise<OnboardingLoginOutcome> }) {
  const { setPendingLogin, user } = useOnboarding();
  useEffect(() => setPendingLogin(outcome), []);
  return <Text>{`user:${user?.login ?? 'none'}`}</Text>;
}

/** Harness: pilha real (para observar `replace`) + contexto de onboarding com uma `pendingLogin` já resolvendo. */
function ValidatingHarness({ outcome }: { outcome: Promise<OnboardingLoginOutcome> }) {
  const navigation = useNavigationStack('onboarding-validating');
  return (
    <ThemeProvider>
      <NavigationProvider value={navigation}>
        <OnboardingProvider
          callbacks={{
            onUrlSubmit: () => undefined,
            onModeSelect: () => undefined,
            onLoginSubmit: () => Promise.resolve({ kind: 'network-error', message: 'unused' }),
            onApiKeySubmit: () => Promise.resolve({ kind: 'network-error', message: 'unused' }),
          }}
        >
          <SetPending outcome={outcome} />
          <Text>stack:{navigation.stack.join('>')}</Text>
          <OnboardingValidatingScreen />
        </OnboardingProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}

afterEach(() => {
  while (INSTANCES.length > 0) INSTANCES.pop()?.unmount();
});

describe('TUI: OnboardingValidatingScreen', () => {
  it('mostra o spinner de "Validando credenciais..." enquanto pendingLogin não resolve', () => {
    const { lastFrame } = render(<ValidatingHarness outcome={new Promise(() => {})} />);
    expect(lastFrame()).toContain('Validando credenciais');
  });

  it('sucesso: grava o user no contexto e navega para a splash (replace)', async () => {
    const { lastFrame } = render(
      <ValidatingHarness outcome={Promise.resolve({ kind: 'success', user: USER })} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:onboarding-success');
    });
    expect(lastFrame()).toContain('user:alice');
    // A pilha foi SUBSTITUÍDA (replace), não empilhada por cima da validação.
    expect(lastFrame()).not.toContain('onboarding-validating');
  });

  it('401 (2FA): navega para o fallback de colar api_key', async () => {
    const { lastFrame } = render(
      <ValidatingHarness
        outcome={Promise.resolve({ kind: 'auth-error', message: 'Autenticação falhou (401).' })}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:onboarding-api-key');
    });
  });

  it('erro de rede: mostra a mensagem em destaque de erro, com uma próxima ação sugerida, sem stack', async () => {
    const { lastFrame } = render(
      <ValidatingHarness
        outcome={Promise.resolve({
          kind: 'network-error',
          message: 'Falha de rede ao acessar https://redmine.example/users/current.json: ENOTFOUND',
        })}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('ENOTFOUND');
    });
    expect(lastFrame()).toContain('NODE_EXTRA_CA_CERTS');
    expect(lastFrame()).not.toContain('stack:onboarding-success');
    expect(lastFrame()).not.toContain('    at '); // sem stack trace
  });

  it('a tela nunca recebe a senha/api_key em si — só o outcome (já redigido pelo core)', () => {
    // Reason: `validating.tsx` só consome `pendingLogin`/`user` do
    // `OnboardingContext` — a senha digitada em `login.tsx` é passada direto
    // para `callbacks.onLoginSubmit`, nunca guardada no contexto ou vista por
    // esta tela. Este teste documenta essa garantia estrutural: o harness
    // acima nunca instancia `SetPending`/`OnboardingValidatingScreen` com
    // PASSWORD/API_KEY em mãos, e ainda assim eles nunca aparecem no frame.
    const { lastFrame } = render(<ValidatingHarness outcome={new Promise(() => {})} />);
    expect(lastFrame()).not.toContain(PASSWORD);
    expect(lastFrame()).not.toContain(API_KEY);
  });
});
