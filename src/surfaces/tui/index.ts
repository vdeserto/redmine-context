/**
 * Ponto de entrada da TUI (M2-01).
 *
 * Renderiza o roteador (`app.tsx`) via Ink e resolve quando o usuário sai
 * (`q`, ver `app.tsx`). Consumido pelo CLI quando `redmine-context` roda sem
 * argumentos e o stdout é um TTY (`../cli/main.ts`).
 *
 * Arquivo `.ts` (não `.tsx`): usa `createElement` em vez de JSX porque o
 * `App` já traz seu próprio elemento — nada aqui precisa de sintaxe JSX.
 */
import { render } from 'ink';
import { createElement } from 'react';

import { App } from './app.js';

/**
 * Sobe a TUI e aguarda o app sair.
 *
 * @returns Exit code do processo — `0`, já que sair da TUI (`q`) é sempre um
 *   encerramento normal (não há hoje um caminho de erro fatal na TUI).
 */
export async function runTui(): Promise<number> {
  const { waitUntilExit } = render(createElement(App));
  await waitUntilExit();
  return 0;
}
