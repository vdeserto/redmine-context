/**
 * Ponto de entrada da TUI (M2-01).
 *
 * Renderiza o roteador (`app.tsx`) via Ink e resolve quando o usuário sai
 * (`q`, ver `app.tsx`). Consumido pelo CLI quando `redmine-context` roda sem
 * argumentos e o stdout é um TTY (`../cli/main.ts`).
 *
 * `exitOnCtrlC: false` (M2-04): o app implementa seu próprio padrão de saída
 * (duplo Ctrl+C, ver `hooks/use-exit-guard.ts`) — sem essa flag, o Ink sai do
 * processo na primeira pressão de Ctrl+C antes do handler global rodar.
 *
 * Full-screen + paletas (#190): entra no buffer de tela alternativo (alt-screen)
 * em TTY e passa a paleta persistida + o flag full-screen ao `App`.
 */
import { render } from 'ink';

import { defaultSettingsStore, type SettingsStore } from '../../index.js';
import { App } from './app.js';
import { InstanceProvider, type InstanceInfo, type InstanceOrigin } from './instance.js';
import { DEFAULT_PALETTE_ID } from './palettes.js';

/** Dependências injetáveis do `runTui` (default: processo real). */
export interface RunTuiDeps {
  /** Ambiente (para `REDMINE_URL`); default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Store da URL persistida + paleta; default {@link defaultSettingsStore}. */
  settings?: SettingsStore;
  /** Stream de saída (para o alt-screen); default `process.stdout`. Injetável em testes. */
  stdout?: NodeJS.WriteStream;
}

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

/**
 * Sobe a TUI e aguarda o app sair.
 *
 * @param deps - Ver {@link RunTuiDeps} (env/settings/stdout); default: processo real.
 * @returns Exit code `0` (sair da TUI é sempre encerramento normal).
 */
export async function runTui(deps: RunTuiDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const settings = deps.settings ?? defaultSettingsStore();
  const instance = await resolveTuiInstance(env, settings);

  // Paleta persistida (#190) — default (Catppuccin Mocha) se nenhuma escolhida.
  const paletteId = (await settings.getPaletteId().catch(() => undefined)) ?? DEFAULT_PALETTE_ID;

  // Full-screen (#190): alt-screen buffer (como vim/htop) só em TTY real — a TUI
  // ocupa a tela toda e o conteúdo anterior do terminal é restaurado ao sair.
  // Fora de TTY o `shouldRenderTui` (M2-03) já nem chega aqui.
  const out = deps.stdout ?? process.stdout;
  const fullScreen = out.isTTY === true;
  if (fullScreen) enterAltScreen(out);

  try {
    const { waitUntilExit } = render(
      <InstanceProvider value={instance}>
        <App initialPaletteId={paletteId} settings={settings} fullScreen={fullScreen} />
      </InstanceProvider>,
      { exitOnCtrlC: false },
    );
    await waitUntilExit();
  } finally {
    if (fullScreen) leaveAltScreen(out);
  }
  return 0;
}

/** Sequência ANSI para entrar no buffer de tela alternativo + limpar + esconder cursor. */
function enterAltScreen(out: NodeJS.WriteStream): void {
  out.write('\x1b[?1049h\x1b[H\x1b[2J\x1b[?25l');
}

/** Restaura o buffer principal do terminal + mostra o cursor (ao sair). */
function leaveAltScreen(out: NodeJS.WriteStream): void {
  out.write('\x1b[?25h\x1b[?1049l');
}

/** Retorna a string aparada se não-vazia, senão `undefined`. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}
