/**
 * Teste de INTEGRAÇÃO da guarda de digitação (PR #198).
 *
 * A suíte existente cobre `useTypingGuard`/`isTyping` isoladamente
 * (`./hooks/use-typing-guard.test.tsx`) e o `TextInput` isoladamente, mas
 * NENHUM teste exercita o seam que o bug realmente atravessa: um `TextInput`
 * ativo dentro do `<App />` real + o `useInput` GLOBAL de `app.tsx` recebendo a
 * mesma tecla. O bug relatado (digitar `https://redmine.qualquer...` no
 * onboarding fechava a TUI) só é observável com os dois montados juntos — o
 * teste do hook sozinho passaria mesmo que `app.tsx` nunca chamasse
 * `isTyping()`.
 *
 * Caminho exercitado: welcome → Enter (sem `REDMINE_URL`) → tela de URL do
 * onboarding, que monta um `TextInput` real (`screens/onboarding/url.tsx`).
 *
 * Discriminante: se o `q` disparar o atalho global de sair, o Ink desmonta a
 * árvore e o frame PARA de refletir as teclas seguintes — o texto digitado
 * depois do `q` nunca aparece. Por isso cada caso digita ALGO APÓS o `q` e
 * exige que esse sufixo chegue ao campo.
 *
 * Uma tecla por vez + `waitFor` entre elas: o `useInput` do Ink re-subscreve
 * num efeito pós-commit, e um lote síncrono de `stdin.write` cai nessa janela e
 * perde caracteres (mesma razão documentada em `./app.test.tsx`). Além disso,
 * uma string escrita de uma vez chegaria como um ÚNICO `input` (colagem), que
 * não é o caso testado aqui — o bug é a tecla ISOLADA.
 */
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../../src/surfaces/tui/app.js';
import { isTyping, resetTypingGuard } from '../../../src/surfaces/tui/hooks/use-typing-guard.js';

afterEach(() => {
  cleanup();
  resetTypingGuard();
  vi.unstubAllEnvs();
});

/** Enter (CR) — o `key.return` da welcome. */
const ENTER = '\r';

/** Intervalo entre teclas, emulando digitação humana (ver `type`). */
const KEY_INTERVAL_MS = 60;

/** Leva o `<App />` real da welcome até a tela de URL do onboarding. */
async function renderOnboardingUrl() {
  vi.stubEnv('REDMINE_URL', '');
  const instance = render(<App />);
  instance.stdin.write(ENTER);
  await vi.waitFor(() => {
    expect(instance.lastFrame()).toContain('URL do Redmine');
  });
  return instance;
}

/**
 * Digita `text` tecla a tecla, exigindo que o valor acumulado apareça no frame
 * antes da próxima — se a TUI tiver saído, o `waitFor` estoura aqui.
 */
async function type(
  instance: { stdin: { write: (data: string) => void }; lastFrame: () => string | undefined },
  text: string,
): Promise<void> {
  for (const char of text) {
    instance.stdin.write(char);
    // Intervalo entre teclas: o `TextInput` só reconcilia o valor no render
    // seguinte (`valueRef.current = value` roda DURANTE o render), então um
    // lote de teclas no mesmo tick colapsa o campo na última — ver o achado
    // documentado no relatório de QA. Digitação humana tem esse intervalo.
    await new Promise((resolve) => setTimeout(resolve, KEY_INTERVAL_MS));
  }
}

describe('guarda de digitação: TextInput ativo ↔ atalho global de sair (#198)', () => {
  // Caso esperado — a reprodução do bug relatado no changeset: o "q" de
  // "qualquer" no meio da URL da instância.
  it('digitar "q" na URL do onboarding não encerra a TUI e o texto segue entrando', async () => {
    const instance = await renderOnboardingUrl();

    await type(instance, 'redmine.qualquer');

    expect(instance.lastFrame()).toContain('redmine.qualquer');
    // Continua na mesma tela: o atalho global não agiu.
    expect(instance.lastFrame()).toContain('URL do Redmine');
  });

  // Edge: a guarda é um efeito de montagem do `TextInput`. Confirma que ela
  // está ligada na árvore de PRODUÇÃO (não só nos testes do hook), comparando
  // uma tela sem campo de texto com uma que tem.
  it('a guarda só fica ligada na tela que monta um campo de texto', async () => {
    vi.stubEnv('REDMINE_URL', '');
    const { lastFrame, stdin } = render(<App />);

    // Welcome não tem campo de texto — `q` ali continua sendo atalho.
    expect(isTyping()).toBe(false);

    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain('URL do Redmine'));
    await vi.waitFor(() => expect(isTyping()).toBe(true));
  });

  // Failure case: teclas que são atalhos em OUTRAS telas (`q` sair, `b` voltar,
  // `d`/`c` na welcome, `t`/`f`/`r` na home, `j`/`k` de lista) têm que chegar
  // intactas ao campo — nenhuma pode ser interpretada como comando.
  it('teclas que são atalhos em outras telas são texto comum dentro do campo', async () => {
    const instance = await renderOnboardingUrl();

    await type(instance, 'qbdctrfjk');

    expect(instance.lastFrame()).toContain('qbdctrfjk');
    expect(instance.lastFrame()).toContain('URL do Redmine');
  });
});
