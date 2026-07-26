/**
 * Glyphs NÃO cobertos por `figures` — hardening do terminal LEGADO do Windows
 * (M5-09, #84): cmd.exe / PowerShell antigo, sem suporte a Unicode.
 *
 * `figures` (ver `./symbols.ts`) só degrada para ASCII os seus símbolos
 * ESPECIAIS (tick/cross/pointer/info/warning). Os glyphs da categoria "common"
 * dele — reticências `…`, setas `↑`/`↓`, `bullet`, etc. — permanecem Unicode
 * MESMO no conjunto `fallbackSymbols` (confira `node_modules/figures/index.js`:
 * `common` é espalhado tanto em `mainSymbols` quanto em `fallbackSymbols`).
 *
 * A TUI usa alguns desses glyphs "common" hardcoded fora do sistema de
 * `figures` (reticências de truncamento, setas de navegação, o separador `·`,
 * a máscara de senha `•` e os frames braille do spinner). Em um terminal
 * legado do Windows eles apareceriam como mojibake. Este módulo centraliza
 * ESSES glyphs com um fallback ASCII, decidido pelo MESMO sinal que `figures`
 * usa por baixo (`is-unicode-supported`), replicado aqui como função pura e
 * injetável (`env`/`platform`) — seguindo o padrão de `../cli/tty.ts`
 * (`shouldRenderTui`), que também mantém a decisão de degradação testável sem
 * ler `process` direto.
 */
import process from 'node:process';

/**
 * Espelha a heurística de `is-unicode-supported@2` (a mesma que `figures`
 * consome) como função pura e injetável.
 *
 * Reason: `figures` decide o fallback UMA vez, no import, a partir do ambiente
 * real — para orçarmos os glyphs "common" pelo MESMO critério (e testá-lo com
 * ambientes simulados) precisamos da decisão exposta como função. Manter a
 * lógica idêntica à da lib garante que os dois caminhos concordem.
 *
 * @param env - Ambiente do processo (ou um subconjunto controlado em testes).
 * @param platform - Plataforma (`process.platform`); injetável para testes.
 * @returns `true` quando o terminal deve renderizar glyphs Unicode.
 * @example
 * isUnicodeSupported({ WT_SESSION: '1' }, 'win32'); // true (Windows Terminal)
 * isUnicodeSupported({}, 'win32'); // false (cmd.exe/PowerShell legado)
 */
export function isUnicodeSupported(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const { TERM, TERM_PROGRAM } = env;

  if (platform !== 'win32') {
    return TERM !== 'linux'; // console do kernel Linux não renderiza Unicode
  }

  return (
    Boolean(env.WT_SESSION) || // Windows Terminal
    Boolean(env.TERMINUS_SUBLIME) || // Terminus (<0.2.27)
    env.ConEmuTask === '{cmd::Cmder}' || // ConEmu e cmder
    TERM_PROGRAM === 'Terminus-Sublime' ||
    TERM_PROGRAM === 'vscode' ||
    TERM === 'xterm-256color' ||
    TERM === 'alacritty' ||
    TERM === 'rxvt-unicode' ||
    TERM === 'rxvt-unicode-256color' ||
    env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  );
}

/** Conjunto de glyphs "common" que a TUI usa fora de `figures`. */
export interface Glyphs {
  /** Marcador de corte do truncamento (`../truncate.ts`). */
  readonly ellipsis: string;
  /** Separador entre campos de uma linha (ex.: `tamanho · tipo`). */
  readonly middleDot: string;
  /** Placeholder para campos ausentes (assignee, datas, old/new value). */
  readonly emptyPlaceholder: string;
  /** Seta "para cima" das dicas de navegação. */
  readonly arrowUp: string;
  /** Seta "para baixo" das dicas de navegação. */
  readonly arrowDown: string;
  /** Caractere da máscara de senha/api_key (`components/text-input.tsx`). */
  readonly maskBullet: string;
  /** Frames do spinner (`components/spinner.tsx`). */
  readonly spinnerFrames: readonly string[];
}

/** Glyphs Unicode — terminais modernos (Windows Terminal, iTerm, etc.). */
export const UNICODE_GLYPHS: Glyphs = {
  ellipsis: '…',
  middleDot: '·',
  emptyPlaceholder: '—',
  arrowUp: '↑',
  arrowDown: '↓',
  maskBullet: '•',
  spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

/** Fallback ASCII puro — terminal legado do Windows (sem mojibake). */
export const ASCII_GLYPHS: Glyphs = {
  ellipsis: '...',
  middleDot: '|',
  emptyPlaceholder: '-',
  arrowUp: '^',
  arrowDown: 'v',
  maskBullet: '*',
  spinnerFrames: ['|', '/', '-', '\\'],
};

/**
 * Escolhe o conjunto de glyphs conforme o suporte a Unicode.
 *
 * @param unicode - `true` para glyphs Unicode, `false` para o fallback ASCII.
 * @returns O conjunto de glyphs correspondente.
 */
export function resolveGlyphs(unicode: boolean): Glyphs {
  return unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;
}

/** Glyphs resolvidos para o ambiente atual — importado pelas telas/utilitários. */
export const glyphs: Glyphs = resolveGlyphs(isUnicodeSupported());
