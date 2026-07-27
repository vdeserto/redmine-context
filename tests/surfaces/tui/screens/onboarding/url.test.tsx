/**
 * Testes da tela de onboarding "URL" (M2-05.1, issue #27) — valida só o
 * esquema ao confirmar (https:// obrigatório; http:// recusado com mensagem
 * acionável em `theme.danger`, salvo `REDMINE_INSECURE` já definida no
 * ambiente do processo, que aceita com aviso em `theme.warning`). A
 * validação real contra o core (URL bem formada, instância alcançável) é a
 * #28. Escrito ANTES da implementação (TDD).
 */
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
import { OnboardingUrlScreen } from '../../../../../src/surfaces/tui/screens/onboarding/url.js';
import { ThemeProvider } from '../../../../../src/surfaces/tui/theme.js';

/** Enter (retorno de carro). */
const ENTER = '\r';

/**
 * Confirma com Enter de forma DETERMINÍSTICA: o `useInput()` do Ink resubscreve
 * seu listener num efeito passivo, um tick DEPOIS do commit que renderiza o
 * campo — então um único Enter enviado logo após a digitação pode cair numa
 * janela sem listener e se perder (flake real observado no `windows-latest`,
 * issue #186). Aqui reenviamos Enter a CADA poll até `done(frame)` valer.
 *
 * É seguro reenviar: a tela de URL é idempotente sob Enter — revalida a MESMA
 * URL (mesma transição no caso válido; mesma mensagem de erro no inválido), e
 * paramos de enviar assim que a condição-alvo aparece.
 *
 * @param stdin - Stdin do harness de teste (ink-testing-library).
 * @param lastFrame - Leitor do último frame renderizado.
 * @param done - Predicado sobre o frame que sinaliza a condição-alvo.
 */
async function submitEnterUntil(
  stdin: { write(data: string): void },
  lastFrame: () => string | undefined,
  done: (frame: string) => boolean,
): Promise<void> {
  await vi.waitFor(
    () => {
      const frame = lastFrame() ?? '';
      if (done(frame)) return;
      stdin.write(ENTER);
      throw new Error(`condição não atingida ainda: ${frame.slice(0, 60)}`);
    },
    { timeout: 3000, interval: 40 },
  );
}

/** Harness: monta a pilha real (para observar `push`) + contexto de onboarding com callback espionável. */
function UrlHarness({ onUrlSubmit }: { onUrlSubmit?: (url: string) => void }) {
  const navigation = useNavigationStack('onboarding-url');
  return (
    <ThemeProvider>
      <NavigationProvider value={navigation}>
        <OnboardingProvider
          callbacks={{
            onUrlSubmit: onUrlSubmit ?? (() => undefined),
            onModeSelect: () => undefined,
            onLoginSubmit: () => undefined,
          }}
        >
          <Text>stack:{navigation.stack.join('>')}</Text>
          <OnboardingUrlScreen />
        </OnboardingProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}

afterEach(() => {
  while (INSTANCES.length > 0) INSTANCES.pop()?.unmount();
});

describe('TUI: OnboardingUrlScreen', () => {
  // Mesma convenção de restauração de `tests/surfaces/mcp/server.test.ts`.
  const prevInsecure = process.env.REDMINE_INSECURE;
  afterEach(() => {
    if (prevInsecure === undefined) {
      delete process.env.REDMINE_INSECURE;
    } else {
      process.env.REDMINE_INSECURE = prevInsecure;
    }
  });

  it('digitar aparece no campo (eco normal, sem máscara)', async () => {
    const { lastFrame, stdin } = render(<UrlHarness />);
    stdin.write('https://redmine.example');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('https://redmine.example');
    });
  });

  it('https:// confirmado com Enter avança para a tela de modo e chama o callback', async () => {
    const onUrlSubmit = vi.fn();
    const { lastFrame, stdin } = render(<UrlHarness onUrlSubmit={onUrlSubmit} />);
    stdin.write('https://redmine.example');
    await vi.waitFor(() => expect(lastFrame()).toContain('https://redmine.example'));
    await submitEnterUntil(stdin, lastFrame, (f) => f.includes('stack:onboarding-url>onboarding-mode'));
    expect(onUrlSubmit).toHaveBeenCalledWith('https://redmine.example');
  });

  it('http:// é recusado com mensagem acionável quando REDMINE_INSECURE não está definida', async () => {
    delete process.env.REDMINE_INSECURE;
    const { lastFrame, stdin } = render(<UrlHarness />);
    stdin.write('http://redmine.example');
    await vi.waitFor(() => expect(lastFrame()).toContain('http://redmine.example'));
    await submitEnterUntil(stdin, lastFrame, (f) => f.includes('TLS é obrigatório'));
    expect(lastFrame()).toContain('stack:onboarding-url');
    expect(lastFrame()).not.toContain('onboarding-mode');
  });

  it('http:// é aceito com aviso quando REDMINE_INSECURE=1 no ambiente do processo', async () => {
    process.env.REDMINE_INSECURE = '1';
    const { lastFrame, stdin } = render(<UrlHarness />);
    stdin.write('http://redmine.example');
    await vi.waitFor(() => expect(lastFrame()).toContain('http://redmine.example'));
    await submitEnterUntil(stdin, lastFrame, (f) => f.includes('stack:onboarding-url>onboarding-mode'));
    expect(lastFrame()).toContain('AVISO');
  });

  it('URL sem esquema é recusada com mensagem acionável (não avança)', async () => {
    const { lastFrame, stdin } = render(<UrlHarness />);
    stdin.write('redmine.example');
    await vi.waitFor(() => expect(lastFrame()).toContain('redmine.example'));
    await submitEnterUntil(stdin, lastFrame, (f) => f.includes('https://'));
    expect(lastFrame()).toContain('stack:onboarding-url');
    expect(lastFrame()).not.toContain('onboarding-mode');
  });
});
