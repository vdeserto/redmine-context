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

import { defaultSettingsStore, type SettingsStore } from '../../index.js';
import { App } from './app.js';
import { InstanceProvider, type InstanceInfo, type InstanceOrigin } from './instance.js';

/** Dependências injetáveis do `runTui` (default: processo real). */
export interface RunTuiDeps {
  /** Ambiente (para `REDMINE_URL`); default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Store da URL persistida; default {@link defaultSettingsStore}. */
  settings?: SettingsStore;
}

/**
 * Sobe a TUI e aguarda o app sair. Resolve a instância no boot (#187):
 * `REDMINE_URL` (env) vence; sem ela, usa a URL persistida no `login`.
 *
 * @param deps - Ver {@link RunTuiDeps} (env/settings); default: processo real.
 * @returns Exit code do processo — `0`, já que sair da TUI (`q` ou duplo
 *   Ctrl+C) é sempre um encerramento normal (não há hoje um caminho de erro
 *   fatal na TUI).
 */
/**
 * Resolve a instância da TUI no boot (#187) e POPULA `env.REDMINE_URL` para os
 * hooks de dados (que leem o ambiente) — `REDMINE_URL` vence; sem ela, usa a URL
 * persistida no `login`. Extraída para teste (o `runTui` bloqueia em `waitUntilExit`).
 *
 * @param env - Ambiente a consultar/popular (o `runTui` passa `process.env`).
 * @param settings - Store da URL persistida.
 * @returns Metadados da instância + ação de limpar a persistida, para o contexto.
 */
export async function resolveTuiInstance(
  env: NodeJS.ProcessEnv,
  settings: SettingsStore,
): Promise<InstanceInfo> {
  let url = nonEmpty(env.REDMINE_URL);
  let origin: InstanceOrigin = url !== undefined ? 'env' : 'none';
  if (url === undefined) {
    const persisted = await settings.getInstanceUrl().catch(() => undefined);
    if (persisted !== undefined && persisted.length > 0) {
      env.REDMINE_URL = persisted;
      url = persisted;
      origin = 'config';
    }
  }
  return {
    ...(url !== undefined ? { url } : {}),
    origin,
    clearPersisted: async () => {
      await settings.clearInstanceUrl();
      // Se a instância desta sessão veio da persistida, ela foi escrita em
      // `env.REDMINE_URL` no boot — limpa também, senão os hooks de dados
      // continuariam vendo a instância "logada" após o logout (só um restart
      // corrigiria). Não toca `env` quando a origem foi a própria env real.
      if (origin === 'config') {
        delete env.REDMINE_URL;
      }
    },
  };
}

export async function runTui(deps: RunTuiDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const settings = deps.settings ?? defaultSettingsStore();
  const instance = await resolveTuiInstance(env, settings);

  const { waitUntilExit } = render(
    createElement(InstanceProvider, { value: instance, children: createElement(App) }),
    { exitOnCtrlC: false },
  );
  await waitUntilExit();
  return 0;
}

/** Retorna a string aparada se não-vazia, senão `undefined`. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}
