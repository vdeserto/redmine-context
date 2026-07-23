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
import { resolveEscapeAction } from '../../../../src/surfaces/tui/app.js';
import { ReAuthAbortedError, useAuthGuard } from '../../../../src/surfaces/tui/hooks/use-auth-guard.js';
import {
  NavigationProvider,
  useNavigation,
  useNavigationStack,
  type NavigationValue,
} from '../../../../src/surfaces/tui/navigation.js';
import type { ScreenName } from '../../../../src/surfaces/tui/screen.js';
import { OnboardingProvider, useOnboarding } from '../../../../src/surfaces/tui/screens/onboarding/onboarding-context.js';

/** Caractere ESC (0x1B) sozinho — tecla Esc (mesma constante de `app.test.tsx`). */
const ESC_KEY = String.fromCharCode(0x1b);

/**
 * Representa uma tela de dados fictícia (#29+, ainda inexistente) — chama
 * `guard()` sob demanda. Em caso de rejeição, expõe o NOME do erro (e não só
 * "error" genérico) para os testes distinguirem um `ReAuthAbortedError` (Esc,
 * fix do review #119) de qualquer outra falha.
 */
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
        (cause: unknown) => {
          setStatus('error');
          setValue(cause instanceof Error ? cause.name : String(cause));
        },
      );
    }
  });

  return <Text>{`status:${status}${value === undefined ? '' : `:${value}`}`}</Text>;
}

/**
 * Simula o que `validating.tsx`/`api-key.tsx` fazem no sucesso do re-login:
 * expõe `reAuth` (com a contagem de pendências, fix do review #119) e uma
 * tecla que chama `resolveReAuth()`.
 */
function ReAuthObserver() {
  const { reAuth, resolveReAuth } = useOnboarding();
  useInput((input) => {
    if (input === 'r') {
      resolveReAuth();
    }
  });
  return (
    <Text>{`reAuth:${reAuth === undefined ? 'none' : `${reAuth.origin}|pending:${reAuth.pending.length}`}`}</Text>
  );
}

/**
 * Simula o atalho global de Esc de `../../../src/surfaces/tui/app.tsx`
 * (fix do review #119): reusa a mesma função pura exportada de lá
 * (`resolveEscapeAction`) para decidir entre abandonar o re-auth ou um
 * `pop()` normal — sem precisar montar a árvore completa do roteador (que
 * ainda não tem uma tela de dados real, #29+, para disparar `guard()`).
 */
function EscSimulator() {
  const { current, popTo } = useNavigation();
  const { reAuth, abortReAuth } = useOnboarding();
  useInput((_input, key) => {
    if (!key.escape) {
      return;
    }
    const action = resolveEscapeAction(current, reAuth);
    if (action.kind === 'abort-reauth') {
      abortReAuth(new ReAuthAbortedError());
      popTo(action.origin);
    }
  });
  return null;
}

function Harness({ initialScreen, operation }: { initialScreen: ScreenName; operation: () => Promise<string> }) {
  const navigation: NavigationValue = useNavigationStack(initialScreen);
  return (
    <NavigationProvider value={navigation}>
      <OnboardingProvider>
        <Text>{`stack:${navigation.stack.join('>')}`}</Text>
        <ReAuthObserver />
        <EscSimulator />
        <DataScreen operation={operation} />
      </OnboardingProvider>
    </NavigationProvider>
  );
}

/** Harness com DUAS telas de dados independentes, para exercitar 401 concorrentes (fix review #119). */
function ConcurrentHarness({
  initialScreen,
  operationA,
  operationB,
}: {
  initialScreen: ScreenName;
  operationA: () => Promise<string>;
  operationB: () => Promise<string>;
}) {
  const navigation: NavigationValue = useNavigationStack(initialScreen);
  return (
    <NavigationProvider value={navigation}>
      <OnboardingProvider>
        <Text>{`stack:${navigation.stack.join('>')}`}</Text>
        <ReAuthObserver />
        <EscSimulator />
        <TwoOperationsScreen operationA={operationA} operationB={operationB} />
      </OnboardingProvider>
    </NavigationProvider>
  );
}

/** Duas chamadas `guard()` independentes (teclas `a`/`b`), cada uma com seu próprio status. */
function TwoOperationsScreen({
  operationA,
  operationB,
}: {
  operationA: () => Promise<string>;
  operationB: () => Promise<string>;
}) {
  const { guard } = useAuthGuard();
  const [statusA, setStatusA] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [statusB, setStatusB] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [valueA, setValueA] = useState<string | undefined>(undefined);
  const [valueB, setValueB] = useState<string | undefined>(undefined);

  useInput((input) => {
    if (input === 'a') {
      setStatusA('pending');
      guard(operationA).then(
        (result) => {
          setStatusA('done');
          setValueA(result);
        },
        () => setStatusA('error'),
      );
    }
    if (input === 'b') {
      setStatusB('pending');
      guard(operationB).then(
        (result) => {
          setStatusB('done');
          setValueB(result);
        },
        () => setStatusB('error'),
      );
    }
  });

  return (
    <Text>{`a:${statusA}${valueA === undefined ? '' : `:${valueA}`}|b:${statusB}${
      valueB === undefined ? '' : `:${valueB}`
    }`}</Text>
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

describe('useAuthGuard: Esc abandona o re-login (fix do review #119)', () => {
  it('Esc durante o re-login rejeita guard() com ReAuthAbortedError e restaura a origem', async () => {
    const operation = vi.fn().mockRejectedValue(new RedmineAuthError('401', 401, 'https://redmine.example'));
    const { lastFrame, stdin } = render(<Harness initialScreen="about" operation={operation} />);

    stdin.write('g');
    await vi.waitFor(() => expect(lastFrame()).toContain('stack:about>onboarding-login'));
    expect(lastFrame()).toContain('reAuth:about|pending:1');

    stdin.write(ESC_KEY);

    // guard() rejeita — a tela de dados vê o cancelamento, não um crash.
    await vi.waitFor(() => expect(lastFrame()).toContain('status:error:ReAuthAbortedError'));
    // A navegação restaura a origem (não fica presa em onboarding-login).
    expect(lastFrame()).toContain('stack:about');
    expect(lastFrame()).not.toContain('onboarding-login');
    // O modo re-auth foi limpo — nenhuma pendência pendurada.
    expect(lastFrame()).toContain('reAuth:none');
  });
});

describe('useAuthGuard: 401 concorrentes (fix do review #119)', () => {
  it('duas chamadas guard() com 401 concorrentes: uma única passagem de re-login resolve AMBOS os retries', async () => {
    const operationA = vi
      .fn()
      .mockRejectedValueOnce(new RedmineAuthError('401', 401, 'https://redmine.example'))
      .mockResolvedValueOnce('a-ok');
    const operationB = vi
      .fn()
      .mockRejectedValueOnce(new RedmineAuthError('401', 401, 'https://redmine.example'))
      .mockResolvedValueOnce('b-ok');
    const { lastFrame, stdin } = render(
      <ConcurrentHarness initialScreen="about" operationA={operationA} operationB={operationB} />,
    );

    stdin.write('a');
    await vi.waitFor(() => expect(lastFrame()).toContain('stack:about>onboarding-login'));
    expect(lastFrame()).toContain('reAuth:about|pending:1');

    stdin.write('b');
    await vi.waitFor(() => expect(lastFrame()).toContain('reAuth:about|pending:2'));
    // O segundo 401 concorrente NÃO empilha onboarding-login de novo — antes
    // do fix, um segundo beginReAuth sobrescrevia o primeiro silenciosamente.
    expect(lastFrame()).toContain('stack:about>onboarding-login');
    expect(lastFrame()).not.toContain('onboarding-login>onboarding-login');

    stdin.write('r');
    await vi.waitFor(() => expect(lastFrame()).toContain('a:done:a-ok'));
    await vi.waitFor(() => expect(lastFrame()).toContain('b:done:b-ok'));
    expect(operationA).toHaveBeenCalledTimes(2);
    expect(operationB).toHaveBeenCalledTimes(2);
    expect(lastFrame()).toContain('reAuth:none');
  });

  it('abortReAuth (Esc) rejeita AMBOS os guard() pendentes, sem deixar nenhum pendurado', async () => {
    const operationA = vi.fn().mockRejectedValue(new RedmineAuthError('401', 401, 'https://redmine.example'));
    const operationB = vi.fn().mockRejectedValue(new RedmineAuthError('401', 401, 'https://redmine.example'));
    const { lastFrame, stdin } = render(
      <ConcurrentHarness initialScreen="about" operationA={operationA} operationB={operationB} />,
    );

    stdin.write('a');
    await vi.waitFor(() => expect(lastFrame()).toContain('reAuth:about|pending:1'));
    stdin.write('b');
    await vi.waitFor(() => expect(lastFrame()).toContain('reAuth:about|pending:2'));

    stdin.write(ESC_KEY);
    await vi.waitFor(() => expect(lastFrame()).toContain('a:error'));
    await vi.waitFor(() => expect(lastFrame()).toContain('b:error'));
    expect(lastFrame()).toContain('reAuth:none');
  });
});
