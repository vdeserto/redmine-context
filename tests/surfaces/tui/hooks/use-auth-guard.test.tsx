/**
 * Testes de `useAuthGuard` (M2-13, issue #36) — o mecanismo central que
 * qualquer tela de dados (#29+) usa para tratar `RedmineAuthError` (401):
 * guarda a tela de origem + a operação como retry, empilha `onboarding-login`
 * em modo re-auth, e só resolve depois que o re-login é concluído com
 * sucesso (`OnboardingContext.resolveReAuth()`, o que `validating.tsx`/
 * `api-key.tsx` chamam no sucesso do login). Escrito ANTES da implementação
 * (TDD).
 */
import { Text, useInput } from 'ink';
import { render as inkRender } from 'ink-testing-library';
import { useState } from 'react';
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

import { RedmineAuthError } from '../../../../src/index.js';
import { useAuthGuard } from '../../../../src/surfaces/tui/hooks/use-auth-guard.js';
import {
  NavigationProvider,
  useNavigationStack,
  type NavigationValue,
} from '../../../../src/surfaces/tui/navigation.js';
import type { ScreenName } from '../../../../src/surfaces/tui/screen.js';
import { OnboardingProvider, useOnboarding } from '../../../../src/surfaces/tui/screens/onboarding/onboarding-context.js';

/** Representa uma tela de dados fictícia (#29+, ainda inexistente) — chama `guard()` sob demanda. */
function DataScreen({ operation }: { operation: () => Promise<string> }) {
  const { guard } = useAuthGuard();
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [value, setValue] = useState<string | undefined>(undefined);

  useInput((input) => {
    if (input === 'g') {
      setStatus('pending');
      guard(operation).then(
        (result) => {
          setStatus('done');
          setValue(result);
        },
        () => setStatus('error'),
      );
    }
  });

  return <Text>{`status:${status}${value === undefined ? '' : `:${value}`}`}</Text>;
}

/**
 * Simula o que `validating.tsx`/`api-key.tsx` fazem no sucesso do re-login:
 * expõe `reAuth` e uma tecla que chama `resolveReAuth()`.
 */
function ReAuthObserver() {
  const { reAuth, resolveReAuth } = useOnboarding();
  useInput((input) => {
    if (input === 'r') {
      resolveReAuth();
    }
  });
  return <Text>{`reAuth:${reAuth === undefined ? 'none' : reAuth.origin}`}</Text>;
}

function Harness({ initialScreen, operation }: { initialScreen: ScreenName; operation: () => Promise<string> }) {
  const navigation: NavigationValue = useNavigationStack(initialScreen);
  return (
    <NavigationProvider value={navigation}>
      <OnboardingProvider>
        <Text>{`stack:${navigation.stack.join('>')}`}</Text>
        <ReAuthObserver />
        <DataScreen operation={operation} />
      </OnboardingProvider>
    </NavigationProvider>
  );
}

afterEach(() => {
  while (INSTANCES.length > 0) INSTANCES.pop()?.unmount();
});

describe('useAuthGuard: operação sem 401', () => {
  it('resolve normalmente, sem tocar navegação/onboarding', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    const { lastFrame, stdin } = render(<Harness initialScreen="about" operation={operation} />);

    stdin.write('g');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:done:ok'));

    expect(lastFrame()).toContain('stack:about');
    expect(lastFrame()).not.toContain('onboarding-login');
    expect(lastFrame()).toContain('reAuth:none');
  });

  it('erro que não é RedmineAuthError propaga normalmente, sem disparar re-auth', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('falha genérica'));
    const { lastFrame, stdin } = render(<Harness initialScreen="about" operation={operation} />);

    stdin.write('g');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:error'));

    expect(lastFrame()).toContain('reAuth:none');
    expect(lastFrame()).not.toContain('onboarding-login');
  });
});

describe('useAuthGuard: RedmineAuthError (401) dispara o re-auth', () => {
  it('guarda a tela de origem e empilha onboarding-login', async () => {
    const operation = vi.fn().mockRejectedValue(new RedmineAuthError('401', 401, 'https://redmine.example'));
    const { lastFrame, stdin } = render(<Harness initialScreen="about" operation={operation} />);

    stdin.write('g');
    await vi.waitFor(() => expect(lastFrame()).toContain('stack:about>onboarding-login'));

    expect(lastFrame()).toContain('reAuth:about');
    // A operação original ainda não retomou — guard() só resolve após o retry.
    expect(lastFrame()).toContain('status:pending');
  });

  it('sucesso do re-login retoma a operação automaticamente (retry) e resolve guard()', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new RedmineAuthError('401', 401, 'https://redmine.example'))
      .mockResolvedValueOnce('retried-ok');
    const { lastFrame, stdin } = render(<Harness initialScreen="about" operation={operation} />);

    stdin.write('g');
    await vi.waitFor(() => expect(lastFrame()).toContain('reAuth:about'));

    // Simula o sucesso do re-login (o que validating.tsx/api-key.tsx fazem).
    stdin.write('r');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:done:retried-ok'));

    expect(operation).toHaveBeenCalledTimes(2);
    expect(lastFrame()).toContain('reAuth:none');
  });

  it('falha do re-login não perde a origem — reAuth é reaberto com a MESMA origem', async () => {
    const operation = vi.fn().mockRejectedValue(new RedmineAuthError('401', 401, 'https://redmine.example'));
    const { lastFrame, stdin } = render(<Harness initialScreen="about" operation={operation} />);

    stdin.write('g');
    await vi.waitFor(() => expect(lastFrame()).toContain('reAuth:about'));

    // Simula uma tentativa de re-login que falha de novo com 401.
    stdin.write('r');
    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(lastFrame()).toContain('reAuth:about'));

    expect(lastFrame()).toContain('status:pending');
  });
});
