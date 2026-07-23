/**
 * Testes de `useOnboardingCallbacks` (#28) — único ponto de wiring entre as
 * telas de onboarding e o core (`loginWithPassword`, `validateApiKey`,
 * `createCredentialCascade`). O core é mockado (`vi.mock`, preservando as
 * classes de erro reais para o `instanceof` da classificação de outcome,
 * mesmo padrão de `tests/surfaces/mcp/server.test.ts`) — nenhuma chamada de
 * rede/keychain real acontece aqui. Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/index.js')>();
  return {
    ...actual,
    loginWithPassword: vi.fn(),
    validateApiKey: vi.fn(),
    createCredentialCascade: vi.fn(),
  };
});

import * as core from '../../../../src/index.js';
import { RedmineAuthError } from '../../../../src/index.js';
import { useOnboardingCallbacks } from '../../../../src/surfaces/tui/hooks/use-onboarding-callbacks.js';
import type { OnboardingLoginOutcome } from '../../../../src/surfaces/tui/screens/onboarding/onboarding-context.js';

const BASE_URL = 'https://redmine.example';
const USERNAME = 'alice';
const PASSWORD = 'hunter2-super-secret';
const PASTED_KEY = 'pasted-api-key-secret';
const RESOLVED_API_KEY = 'resolved-api-key-secret';
const USER = { id: 42, login: USERNAME, name: 'Alice Liddell' };

/** Espiona o `.set` gravável de `createCredentialCascade()` — nunca a api_key em si nos frames. */
function mockCascade(): { set: ReturnType<typeof vi.fn> } {
  const set = vi.fn().mockResolvedValue(undefined);
  vi.mocked(core.createCredentialCascade).mockReturnValue({ set } as unknown as ReturnType<
    typeof core.createCredentialCascade
  >);
  return { set };
}

/** Harness: dispara `onUrlSubmit` + `onLoginSubmit`/`onApiKeySubmit` e mostra o outcome resolvido como JSON. */
function Harness({
  trigger,
  password,
  apiKey,
}: {
  trigger: 'login' | 'api-key';
  password?: string;
  apiKey?: string;
}) {
  const callbacks = useOnboardingCallbacks();
  const [outcome, setOutcome] = useState<OnboardingLoginOutcome | undefined>(undefined);

  useEffect(() => {
    callbacks.onUrlSubmit(BASE_URL);
    const promise =
      trigger === 'login'
        ? callbacks.onLoginSubmit({ username: USERNAME, password: password ?? PASSWORD })
        : callbacks.onApiKeySubmit(apiKey ?? PASTED_KEY);
    promise.then(setOutcome);
    // Reason: dispara uma única vez na montagem — o harness existe só para
    // observar a resolução de UMA chamada por teste.
  }, []);

  return <Text>{outcome === undefined ? 'pending' : JSON.stringify(outcome)}</Text>;
}

afterEach(() => {
  vi.mocked(core.loginWithPassword).mockReset();
  vi.mocked(core.validateApiKey).mockReset();
  vi.mocked(core.createCredentialCascade).mockReset();
});

describe('useOnboardingCallbacks: login por senha — sucesso', () => {
  it('chama loginWithPassword com a URL/credenciais e salva a api_key via a cascata', async () => {
    vi.mocked(core.loginWithPassword).mockResolvedValue({ apiKey: RESOLVED_API_KEY, user: USER });
    const { set } = mockCascade();

    const { lastFrame } = render(<Harness trigger="login" />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('"kind":"success"');
    });
    expect(core.loginWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD }),
    );
    expect(set).toHaveBeenCalledWith(BASE_URL, RESOLVED_API_KEY);
    expect(JSON.parse(lastFrame() ?? '{}')).toEqual({ kind: 'success', user: USER });
  });

  it('nunca inclui a senha ou a api_key no outcome (frame)', async () => {
    vi.mocked(core.loginWithPassword).mockResolvedValue({ apiKey: RESOLVED_API_KEY, user: USER });
    mockCascade();

    const { lastFrame } = render(<Harness trigger="login" />);

    await vi.waitFor(() => expect(lastFrame()).toContain('"kind":"success"'));
    expect(lastFrame()).not.toContain(PASSWORD);
    expect(lastFrame()).not.toContain(RESOLVED_API_KEY);
  });
});

describe('useOnboardingCallbacks: login por senha — 401 (2FA)', () => {
  it("classifica RedmineAuthError como outcome 'auth-error'", async () => {
    vi.mocked(core.loginWithPassword).mockRejectedValue(
      new RedmineAuthError('Autenticação falhou (401): usuário ou senha inválidos.', 401, `${BASE_URL}/users/current.json`),
    );

    const { lastFrame } = render(<Harness trigger="login" />);

    await vi.waitFor(() => expect(lastFrame()).toContain('"kind":"auth-error"'));
    expect(lastFrame()).not.toContain(PASSWORD);
  });
});

describe('useOnboardingCallbacks: login por senha — erro de rede/TLS', () => {
  it("classifica um erro genérico como outcome 'network-error' com mensagem acionável", async () => {
    vi.mocked(core.loginWithPassword).mockRejectedValue(
      new Error('Falha de rede ao acessar https://redmine.example/users/current.json: getaddrinfo ENOTFOUND'),
    );

    const { lastFrame } = render(<Harness trigger="login" />);

    await vi.waitFor(() => expect(lastFrame()).toContain('"kind":"network-error"'));
    expect(lastFrame()).toContain('ENOTFOUND');
    expect(lastFrame()).not.toContain(PASSWORD);
  });
});

describe('useOnboardingCallbacks: colar api_key — sucesso', () => {
  it('chama validateApiKey com a URL/key e salva a própria key colada via a cascata', async () => {
    vi.mocked(core.validateApiKey).mockResolvedValue({ apiKey: PASTED_KEY, user: USER });
    const { set } = mockCascade();

    const { lastFrame } = render(<Harness trigger="api-key" />);

    await vi.waitFor(() => expect(lastFrame()).toContain('"kind":"success"'));
    expect(core.validateApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: BASE_URL, apiKey: PASTED_KEY }),
    );
    expect(set).toHaveBeenCalledWith(BASE_URL, PASTED_KEY);
  });
});

describe('useOnboardingCallbacks: colar api_key — key inválida', () => {
  it("classifica um 401 na validação como outcome 'auth-error', sem vazar a key", async () => {
    vi.mocked(core.validateApiKey).mockRejectedValue(
      new RedmineAuthError('Autenticação falhou (401): api_key inválida ou expirada.', 401, `${BASE_URL}/users/current.json`),
    );

    const { lastFrame } = render(<Harness trigger="api-key" />);

    await vi.waitFor(() => expect(lastFrame()).toContain('"kind":"auth-error"'));
    expect(lastFrame()).not.toContain(PASTED_KEY);
  });
});
