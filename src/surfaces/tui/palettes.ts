/**
 * Kits de PALETAS de cores da TUI (#190).
 *
 * Cada paleta é um {@link Theme} COMPLETO em truecolor (hex), curado a partir de
 * esquemas de cor consagrados. Trocar de paleta é escolher um `id` aqui — o
 * `ThemeProvider` (`./theme.tsx`) recebe o `Theme` resolvido. Este arquivo é a
 * ÚNICA fonte de literais hex (junto de `theme.tsx`); as telas nunca declaram cor
 * literal (varredura `no-hardcoded-colors.test.ts`), sempre via `useTheme()`.
 *
 * Os valores hex são bem conhecidos dos respectivos projetos de tema. A
 * degradação para texto puro (NO_COLOR/CI/não-TTY) é decidida ANTES de a TUI
 * subir (`shouldRenderTui`), então aqui só existem terminais com cor.
 */

import type { Theme } from './theme.js';

/** Uma paleta nomeada: metadados + o {@link Theme} completo. */
export interface Palette {
  /** Identificador estável (persistido em settings.json). */
  readonly id: string;
  /** Rótulo legível exibido no seletor. */
  readonly label: string;
  /** Tema completo (truecolor) desta paleta. */
  readonly theme: Theme;
}

/**
 * Lista ORDENADA de paletas (a ordem é a do seletor). A primeira é o default
 * quando não há escolha persistida ({@link DEFAULT_PALETTE_ID}).
 */
export const PALETTES: readonly Palette[] = [
  // ── Paletas ESCURAS (texto claro sobre fundo escuro) ─────────────────────────
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha (escura)',
    theme: {
      primary: '#89b4fa', // blue
      secondary: '#cba6f7', // mauve
      accent: '#f5c2e7', // pink
      muted: '#9399b2', // overlay2
      success: '#a6e3a1', // green
      warning: '#f9e2af', // yellow
      danger: '#f38ba8', // red
      border: '#585b70', // surface2
      background: '#1e1e2e', // base
      text: '#cdd6f4', // text
      gradient: ['#89b4fa', '#cba6f7', '#f5c2e7', '#f38ba8'],
    },
  },
  {
    id: 'dracula',
    label: 'Dracula (escura)',
    theme: {
      primary: '#bd93f9', // purple
      secondary: '#8be9fd', // cyan
      accent: '#ff79c6', // pink
      muted: '#6272a4', // comment
      success: '#50fa7b', // green
      warning: '#f1fa8c', // yellow
      danger: '#ff5555', // red
      border: '#44475a', // current line
      background: '#282a36', // background
      text: '#f8f8f2', // foreground
      gradient: ['#8be9fd', '#bd93f9', '#ff79c6', '#ff5555'],
    },
  },
  {
    id: 'nord',
    label: 'Nord (escura)',
    theme: {
      primary: '#88c0d0', // frost cyan
      secondary: '#81a1c1', // frost blue
      accent: '#b48ead', // aurora purple
      muted: '#7b88a1', // dim
      success: '#a3be8c', // aurora green
      warning: '#ebcb8b', // aurora yellow
      danger: '#bf616a', // aurora red
      border: '#434c5e', // polar night 2
      background: '#2e3440', // polar night 0
      text: '#e5e9f0', // snow storm
      gradient: ['#8fbcbb', '#88c0d0', '#81a1c1', '#5e81ac'],
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night (escura)',
    theme: {
      primary: '#7aa2f7', // blue
      secondary: '#7dcfff', // cyan
      accent: '#bb9af7', // purple
      muted: '#737aa2', // comment
      success: '#9ece6a', // green
      warning: '#e0af68', // yellow
      danger: '#f7768e', // red
      border: '#3b4261', // fg gutter
      background: '#1a1b26', // bg
      text: '#c0caf5', // fg
      gradient: ['#7dcfff', '#7aa2f7', '#bb9af7', '#f7768e'],
    },
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark (escura)',
    theme: {
      primary: '#83a598', // blue
      secondary: '#8ec07c', // aqua
      accent: '#d3869b', // purple
      muted: '#a89984', // gray
      success: '#b8bb26', // green
      warning: '#fabd2f', // yellow
      danger: '#fb4934', // red
      border: '#504945', // bg2
      background: '#282828', // bg0
      text: '#ebdbb2', // fg1
      gradient: ['#8ec07c', '#83a598', '#d3869b', '#fb4934'],
    },
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine (escura)',
    theme: {
      primary: '#c4a7e7', // iris
      secondary: '#9ccfd8', // foam
      accent: '#ebbcba', // rose
      muted: '#908caa', // subtle
      success: '#31748f', // pine
      warning: '#f6c177', // gold
      danger: '#eb6f92', // love
      border: '#403d52', // highlight med
      background: '#191724', // base
      text: '#e0def4', // text
      gradient: ['#9ccfd8', '#c4a7e7', '#ebbcba', '#eb6f92'],
    },
  },
  {
    id: 'tokyo-storm',
    label: 'Tokyo Storm (escura)',
    theme: {
      primary: '#7aa2f7',
      secondary: '#7dcfff',
      accent: '#bb9af7',
      muted: '#7982a9',
      success: '#9ece6a',
      warning: '#e0af68',
      danger: '#f7768e',
      border: '#3b4261',
      background: '#24283b', // storm bg
      text: '#c0caf5',
      gradient: ['#7dcfff', '#7aa2f7', '#bb9af7', '#f7768e'],
    },
  },
  {
    id: 'one-dark',
    label: 'One Dark (escura)',
    theme: {
      primary: '#61afef', // blue
      secondary: '#56b6c2', // cyan
      accent: '#c678dd', // purple
      muted: '#828997', // comment gray
      success: '#98c379', // green
      warning: '#e5c07b', // yellow
      danger: '#e06c75', // red
      border: '#3e4451', // gutter
      background: '#282c34', // bg
      text: '#abb2bf', // fg
      gradient: ['#56b6c2', '#61afef', '#c678dd', '#e06c75'],
    },
  },
  // ── Paletas CLARAS (texto escuro sobre fundo claro) ──────────────────────────
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte (clara)',
    theme: {
      primary: '#1e66f5', // blue
      secondary: '#8839ef', // mauve
      accent: '#ea76cb', // pink
      muted: '#6c6f85', // subtext0
      success: '#40a02b', // green
      warning: '#df8e1d', // yellow
      danger: '#d20f39', // red
      border: '#bcc0cc', // surface1
      background: '#eff1f5', // base
      text: '#4c4f69', // text
      gradient: ['#1e66f5', '#8839ef', '#ea76cb', '#d20f39'],
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light (clara)',
    theme: {
      primary: '#268bd2', // blue
      secondary: '#2aa198', // cyan
      accent: '#d33682', // magenta
      muted: '#93a1a1', // base1
      success: '#859900', // green
      warning: '#b58900', // yellow
      danger: '#dc322f', // red
      border: '#eee8d5', // base2
      background: '#fdf6e3', // base3
      text: '#586e75', // base01
      gradient: ['#2aa198', '#268bd2', '#6c71c4', '#d33682'],
    },
  },
  {
    id: 'github-light',
    label: 'GitHub Light (clara)',
    theme: {
      primary: '#0969da', // accent blue
      secondary: '#1a7f37', // green
      accent: '#8250df', // purple
      muted: '#57606a', // fg muted
      success: '#1a7f37', // green
      warning: '#9a6700', // attention
      danger: '#cf222e', // danger red
      border: '#d0d7de', // border
      background: '#ffffff', // canvas
      text: '#1f2328', // fg default
      gradient: ['#0969da', '#8250df', '#bf3989', '#cf222e'],
    },
  },
  {
    id: 'one-light',
    label: 'One Light (clara)',
    theme: {
      primary: '#4078f2', // blue
      secondary: '#0184bc', // cyan
      accent: '#a626a4', // purple
      muted: '#696c77', // gray
      success: '#50a14f', // green
      warning: '#c18401', // yellow
      danger: '#e45649', // red
      border: '#dcdfe4', // gutter
      background: '#fafafa', // bg
      text: '#383a42', // fg
      gradient: ['#0184bc', '#4078f2', '#a626a4', '#e45649'],
    },
  },
];

/** Id da paleta default (a primeira da lista) — usada sem escolha persistida. */
export const DEFAULT_PALETTE_ID = PALETTES[0]!.id;

/** Índice `id → Palette` para resolução O(1). */
const BY_ID: ReadonlyMap<string, Palette> = new Map(PALETTES.map((p) => [p.id, p]));

/**
 * Resolve uma paleta por `id`, com fallback para a default se o `id` for
 * desconhecido (ex.: settings.json com uma paleta removida numa versão futura).
 *
 * @param id - Id persistido (ou `undefined`).
 * @returns A paleta correspondente, ou a default.
 */
export function resolvePalette(id: string | undefined): Palette {
  if (id !== undefined) {
    const found = BY_ID.get(id);
    if (found !== undefined) return found;
  }
  return BY_ID.get(DEFAULT_PALETTE_ID)!;
}
