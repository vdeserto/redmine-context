/**
 * Testes do `OnboardingContext` (M2-05.1, issue #27) — estado local do
 * fluxo de onboarding ({ url, mode }) e os callbacks de submissão
 * injetáveis, no-op por padrão (a validação real/chamada ao core é a #28).
 * Escrito ANTES da implementação (TDD).
 */
import { useRef } from 'react';
import { Text, useInput } from 'ink';
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
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OnboardingProvider,
  useOnboarding,
} from '../../../../../src/surfaces/tui/screens/onboarding/onboarding-context.js';

/** Componente de teste: chama o hook sem um `OnboardingProvider` acima. */
function ScreenWithoutProvider() {
  useOnboarding();
  return null;
}

/** Harness: expõe `url`/`mode` como texto e mapeia teclas para as operações do contexto. */
function Harness() {
  const { url, setUrl, mode, setMode, callbacks } = useOnboarding();
  // Ref evita closure obsoleta: o 's' pode chegar antes do resubscribe
  // pós-commit do useInput (mesma classe de bug corrigida no TextInput).
  const urlRef = useRef(url);
  urlRef.current = url;

  useInput((input) => {
    if (input === 'u') {
      setUrl('https://redmine.example');
    }
    if (input === 'p') {
      setMode('password');
    }
    if (input === 'k') {
      setMode('api-key');
    }
    if (input === 's') {
      callbacks.onUrlSubmit(urlRef.current);
    }
  });

  return <Text>{`${url}|${mode ?? 'none'}`}</Text>;
}

afterEach(() => {
  while (INSTANCES.length > 0) INSTANCES.pop()?.unmount();
});

describe('TUI: useOnboarding', () => {
  it('lança erro quando usado fora do OnboardingProvider', () => {
    // Ink envolve a árvore num ErrorBoundary interno: o erro não escapa
    // síncrono de render(), mas é exibido no frame (mesmo padrão de
    // useNavigation()/useTheme()).
    const { lastFrame } = render(<ScreenWithoutProvider />);
    expect(lastFrame()).toContain('useOnboarding() usado fora de <OnboardingProvider>.');
  });

  it('começa com url vazia e mode indefinido', () => {
    const { lastFrame } = render(
      <OnboardingProvider>
        <Harness />
      </OnboardingProvider>,
    );
    expect(lastFrame()).toBe('|none');
  });

  it('setUrl atualiza a url exposta pelo contexto', async () => {
    const { lastFrame, stdin } = render(
      <OnboardingProvider>
        <Harness />
      </OnboardingProvider>,
    );
    stdin.write('u');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('https://redmine.example');
    });
  });

  it('setMode atualiza o modo exposto pelo contexto', async () => {
    const { lastFrame, stdin } = render(
      <OnboardingProvider>
        <Harness />
      </OnboardingProvider>,
    );
    stdin.write('p');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('password');
    });
    stdin.write('k');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('api-key');
    });
  });

  it('callbacks default são no-op — chamar não lança nem quebra o app', () => {
    const { stdin } = render(
      <OnboardingProvider>
        <Harness />
      </OnboardingProvider>,
    );
    expect(() => stdin.write('s')).not.toThrow();
  });

  it('callbacks injetados via prop substituem o default no-op', async () => {
    const onUrlSubmit = vi.fn();
    const { stdin } = render(
      <OnboardingProvider
        callbacks={{
          onUrlSubmit,
          onModeSelect: () => undefined,
          onLoginSubmit: () => Promise.resolve({ kind: 'network-error', message: 'unused' }),
          onApiKeySubmit: () => Promise.resolve({ kind: 'network-error', message: 'unused' }),
        }}
      >
        <Harness />
      </OnboardingProvider>,
    );
    stdin.write('u');
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    stdin.write('s');
    await vi.waitFor(() => {
      expect(onUrlSubmit).toHaveBeenCalledWith('https://redmine.example');
    });
  });
});

describe('TUI: useOnboarding — pendingLogin/user (#28)', () => {
  /** Harness: expõe `pendingLogin`/`user` como texto e mapeia teclas para os setters. */
  function LoginStateHarness() {
    const { pendingLogin, setPendingLogin, user, setUser } = useOnboarding();
    useInput((input) => {
      if (input === 'p') {
        setPendingLogin(Promise.resolve({ kind: 'success', user: { id: 1, login: 'alice', name: 'Alice' } }));
      }
      if (input === 'u') {
        setUser({ id: 1, login: 'alice', name: 'Alice' });
      }
    });
    return (
      <Text>{`pending:${pendingLogin === undefined ? 'none' : 'set'}|user:${user?.login ?? 'none'}`}</Text>
    );
  }

  it('começa com pendingLogin e user indefinidos', () => {
    const { lastFrame } = render(
      <OnboardingProvider>
        <LoginStateHarness />
      </OnboardingProvider>,
    );
    expect(lastFrame()).toBe('pending:none|user:none');
  });

  it('setPendingLogin/setUser atualizam o contexto', async () => {
    const { lastFrame, stdin } = render(
      <OnboardingProvider>
        <LoginStateHarness />
      </OnboardingProvider>,
    );
    stdin.write('p');
    await vi.waitFor(() => expect(lastFrame()).toContain('pending:set'));
    stdin.write('u');
    await vi.waitFor(() => expect(lastFrame()).toContain('user:alice'));
  });
});

describe('TUI: useOnboarding — reAuth/beginReAuth/resolveReAuth (M2-13, #36)', () => {
  /** Harness: expõe `reAuth` como texto e mapeia teclas para begin/resolve. */
  function ReAuthHarness({ retry }: { retry: () => void }) {
    const { reAuth, beginReAuth, resolveReAuth } = useOnboarding();
    useInput((input) => {
      if (input === 'b') {
        beginReAuth({ origin: 'about', retry });
      }
      if (input === 'r') {
        resolveReAuth();
      }
    });
    return <Text>{reAuth === undefined ? 'none' : `origin:${reAuth.origin}`}</Text>;
  }

  it('começa com reAuth indefinido', () => {
    const { lastFrame } = render(
      <OnboardingProvider>
        <ReAuthHarness retry={vi.fn()} />
      </OnboardingProvider>,
    );
    expect(lastFrame()).toBe('none');
  });

  it('beginReAuth guarda a origem no contexto', async () => {
    const { lastFrame, stdin } = render(
      <OnboardingProvider>
        <ReAuthHarness retry={vi.fn()} />
      </OnboardingProvider>,
    );
    stdin.write('b');
    await vi.waitFor(() => expect(lastFrame()).toBe('origin:about'));
  });

  it('resolveReAuth dispara o retry guardado e limpa o reAuth', async () => {
    const retry = vi.fn();
    const { lastFrame, stdin } = render(
      <OnboardingProvider>
        <ReAuthHarness retry={retry} />
      </OnboardingProvider>,
    );
    stdin.write('b');
    await vi.waitFor(() => expect(lastFrame()).toBe('origin:about'));
    stdin.write('r');
    await vi.waitFor(() => expect(lastFrame()).toBe('none'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('resolveReAuth sem um reAuth em andamento é um no-op seguro', () => {
    const { stdin } = render(
      <OnboardingProvider>
        <ReAuthHarness retry={vi.fn()} />
      </OnboardingProvider>,
    );
    expect(() => stdin.write('r')).not.toThrow();
  });
});
