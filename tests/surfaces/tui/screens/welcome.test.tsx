/**
 * Testes da tela de boas-vindas isolada (`welcome.tsx`) — cobre a evolução
 * do M2-05.1 (issue #27): Enter abre o onboarding quando não há credencial,
 * além do atalho já existente para os atalhos (`?`, coberto em
 * `../app.test.tsx`). Evoluído na M2-06 (#29): Enter checa a cascata de
 * credenciais (`resolveApiKey`) e pula direto para `home` quando já há uma
 * salva. Escrito ANTES da implementação (TDD). O core é mockado só em
 * `resolveApiKey` (`TOOL_NAME`/`TOOL_VERSION` seguem reais) — nenhuma
 * chamada real de keychain/rede acontece aqui.
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/index.js')>();
  return { ...actual, resolveApiKey: vi.fn() };
});

import * as core from '../../../../src/index.js';
import { NavigationProvider, useNavigationStack } from '../../../../src/surfaces/tui/navigation.js';
import { WelcomeScreen } from '../../../../src/surfaces/tui/screens/welcome.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Enter (retorno de carro). */
const ENTER = '\r';

/** Harness: monta a pilha real para observar `push('onboarding-url' | 'home')`. */
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

afterEach(() => {
  vi.mocked(core.resolveApiKey).mockReset();
  vi.unstubAllEnvs();
});

describe('TUI: WelcomeScreen', () => {
  it('mostra a dica para continuar com Enter', () => {
    vi.stubEnv('REDMINE_URL', '');
    const { lastFrame } = render(<Harness />);
    expect(lastFrame()).toContain('Enter');
  });

  it('sem REDMINE_URL configurada: Enter empilha a tela de URL do onboarding sem checar a cascata', async () => {
    vi.stubEnv('REDMINE_URL', '');
    const { lastFrame, stdin } = render(<Harness />);
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:welcome>onboarding-url');
    });
    expect(core.resolveApiKey).not.toHaveBeenCalled();
  });

  it('com REDMINE_URL mas sem credencial na cascata: Enter empilha a tela de URL do onboarding', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.resolveApiKey).mockResolvedValue(undefined);
    const { lastFrame, stdin } = render(<Harness />);
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:welcome>onboarding-url');
    });
    expect(core.resolveApiKey).toHaveBeenCalledWith(
      'https://redmine.example',
      expect.objectContaining({ env: expect.anything() }),
    );
  });

  it('com credencial já resolvida pela cascata: Enter empilha "home" (pula o onboarding)', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.resolveApiKey).mockResolvedValue('resolved-api-key');
    const { lastFrame, stdin } = render(<Harness />);
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:welcome>home');
    });
  });

  it('se a cascata rejeitar (ex.: erro de permissão do keychain): degrada para o onboarding', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.resolveApiKey).mockRejectedValue(new Error('boom'));
    const { lastFrame, stdin } = render(<Harness />);
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:welcome>onboarding-url');
    });
  });
});
