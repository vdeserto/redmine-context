/**
 * Teste de integração do fluxo completo de onboarding (M2-05.1, issue #27)
 * via `<App/>`: Início → (Enter) → URL → (https, Enter) → Modo → (Enter) →
 * Login, e o caminho de volta — Esc desempilha em qualquer tela do fluxo
 * (mesmo mecanismo global já testado em `../../app.test.tsx`, M2-04).
 * Escrito ANTES da implementação (TDD).
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
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TOOL_NAME } from '../../../../../src/index.js';
import { App } from '../../../../../src/surfaces/tui/app.js';
import { SCREENS } from '../../../../../src/surfaces/tui/screen.js';

// O useInput do Ink (re)subscreve num efeito pós-commit; escrever ENTER
// imediatamente após o waitFor pode cair na janela sem listener.
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Caractere ESC (0x1B) sozinho — tecla Esc (distinto de uma sequência CSI de seta). */
const ESC_KEY = String.fromCharCode(0x1b);
/** Enter (retorno de carro). */
const ENTER = '\r';

afterEach(() => {
  while (INSTANCES.length > 0) INSTANCES.pop()?.unmount();
});

describe('TUI: fluxo de onboarding (Início → URL → Modo → Login)', () => {
  it('Enter em Início abre a tela de URL do onboarding', async () => {
    const { lastFrame, stdin } = render(<App />);
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(SCREENS['onboarding-url'].title);
    });
  });

  it('percorre URL → Modo → Login e volta com Esc, tela a tela, até o Início', async () => {
    const { lastFrame, stdin } = render(<App />);

    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain(SCREENS['onboarding-url'].title));

    stdin.write('https://redmine.example');
    await vi.waitFor(() => expect(lastFrame()).toContain('https://redmine.example'));
    await tick();
    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain(SCREENS['onboarding-mode'].title));

    await tick();

    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain(SCREENS['onboarding-login'].title));

    stdin.write(ESC_KEY);
    await vi.waitFor(() => expect(lastFrame()).toContain(SCREENS['onboarding-mode'].title));

    stdin.write(ESC_KEY);
    await vi.waitFor(() => expect(lastFrame()).toContain(SCREENS['onboarding-url'].title));

    // Reenvio no polling: um Esc solto pode cair na janela de parsing/(re)subscribe;
    // na raiz da pilha Esc extra é no-op (pop guardado), então reenviar é seguro.
    await vi.waitFor(() => {
      stdin.write(ESC_KEY);
      expect(lastFrame()).toContain(TOOL_NAME);
    });
  });
});
