/**
 * Testes da tela de onboarding "Modo" (M2-05.1, issue #27) — seleção entre
 * login por usuário/senha e colar api_key via `useListNavigation` (M2-04):
 * setas/`j`/`k` navegam, Enter confirma. Escrito ANTES da implementação
 * (TDD).
 */
// Um tick de macrotask: o useInput do Ink resubscreve num efeito pós-commit;
// escrever ENTER antes disso perde o evento.
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
import { Text } from 'ink';
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

import { NavigationProvider, useNavigationStack } from '../../../../../src/surfaces/tui/navigation.js';
import { OnboardingProvider } from '../../../../../src/surfaces/tui/screens/onboarding/onboarding-context.js';
import { OnboardingModeScreen } from '../../../../../src/surfaces/tui/screens/onboarding/mode.js';
import { ThemeProvider } from '../../../../../src/surfaces/tui/theme.js';

/** Caractere ESC (0x1B) — prefixo da sequência CSI da seta abaixo. */
const ESC = String.fromCharCode(0x1b);
/** Sequência CSI da seta para baixo (mesma decodificada pelo `parse-keypress` do Ink). */
const ARROW_DOWN = `${ESC}[B`;
/** Enter (retorno de carro). */
const ENTER = '\r';

/** Harness: monta a pilha real (para observar `push`) + contexto de onboarding com callback espionável. */
function ModeHarness({ onModeSelect }: { onModeSelect?: (mode: string) => void }) {
  const navigation = useNavigationStack('onboarding-mode');
  return (
    <ThemeProvider>
      <NavigationProvider value={navigation}>
        <OnboardingProvider
          callbacks={{
            onUrlSubmit: () => undefined,
            onModeSelect: onModeSelect ?? (() => undefined),
            onLoginSubmit: () => undefined,
          }}
        >
          <Text>stack:{navigation.stack.join('>')}</Text>
          <OnboardingModeScreen />
        </OnboardingProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}

afterEach(() => {
  while (INSTANCES.length > 0) INSTANCES.pop()?.unmount();
});

describe('TUI: OnboardingModeScreen', () => {
  it('mostra as duas opções de autenticação', () => {
    const { lastFrame } = render(<ModeHarness />);
    expect(lastFrame()).toContain('usuário e senha');
    expect(lastFrame()).toContain('api_key');
  });

  it('seta para baixo move a seleção (frame muda)', async () => {
    const { lastFrame, stdin } = render(<ModeHarness />);
    const before = lastFrame() ?? '';
    stdin.write(ARROW_DOWN);
    await vi.waitFor(() => {
      expect(lastFrame()).not.toBe(before);
    });
  });

  it('Enter em "usuário e senha" (item inicial) avança para a tela de login e chama o callback', async () => {
    const onModeSelect = vi.fn();
    const { lastFrame, stdin } = render(<ModeHarness onModeSelect={onModeSelect} />);
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('stack:onboarding-mode>onboarding-login');
    });
    expect(onModeSelect).toHaveBeenCalledWith('password');
  });

  it('Enter em "colar api_key" grava o modo e chama o callback, mas não navega (tela ainda não existe)', async () => {
    const onModeSelect = vi.fn();
    const { lastFrame, stdin } = render(<ModeHarness onModeSelect={onModeSelect} />);
    stdin.write(ARROW_DOWN);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    await tick();
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(onModeSelect).toHaveBeenCalledWith('api-key');
    });
    expect(lastFrame()).toContain('stack:onboarding-mode');
    expect(lastFrame()).not.toContain('onboarding-login');
  });
});
