/**
 * Ponto de entrada da TUI (M2-01).
 *
 * Renderiza o roteador (`app.tsx`) via Ink e resolve quando o usuário sai
 * (`q`, ver `app.tsx`). Consumido pelo CLI quando `redmine-context` roda sem
 * argumentos e o stdout é um TTY (`../cli/main.ts`).
 *
 * Arquivo `.ts` (não `.tsx`): usa `createElement` em vez de JSX porque o
 * `App` já traz seu próprio elemento — nada aqui precisa de sintaxe JSX.
 *
 * `exitOnCtrlC: false` (M2-04): o app implementa seu próprio padrão de saída
 * (duplo Ctrl+C, ver `hooks/use-exit-guard.ts`) — sem essa flag, o Ink sai do
 * processo na primeira pressão de Ctrl+C antes do handler global rodar.
 */
import { render } from 'ink';
import { createElement } from 'react';

import { App } from './app.js';

/**
 * Sobe a TUI e aguarda o app sair.
 *
 * @returns Exit code do processo — `0`, já que sair da TUI (`q` ou duplo
 *   Ctrl+C) é sempre um encerramento normal (não há hoje um caminho de erro
 *   fatal na TUI).
 */
export async function runTui(): Promise<number> {
  const { waitUntilExit } = render(createElement(App), { exitOnCtrlC: false });
  await waitUntilExit();
  return 0;
}
