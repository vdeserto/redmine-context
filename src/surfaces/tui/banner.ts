/**
 * Arte ASCII do banner da tela de abertura (#190 — pacote estético).
 *
 * As três variantes são CONSTANTES, não geradas em runtime: o texto é sempre
 * `redmine-context`, então trazer uma dependência de fontes (figlet/cfonts) para
 * recalcular a mesma string a cada boot não se paga — custaria peso no pacote e
 * tempo de start. Para regenerar (fonte `ANSI Shadow` / `Small` do figlet):
 *
 *   npx figlet -f "ANSI Shadow" redmine-context
 *   npx figlet -f "ANSI Shadow" redmine ; npx figlet -f "ANSI Shadow" context
 *   npx figlet -f Small redmine-context
 *
 * A seleção é PURA ({@link selectBanner}) e depende de dois sinais que a TUI já
 * possui: a largura do terminal (`../hooks/use-terminal-width.js`) e o suporte a
 * Unicode (`../glyphs.js`) — o mesmo sinal que degrada os frames braille do
 * spinner no terminal legado do Windows (M5-09, #84). Sem essa degradação, os
 * blocos `█`/`╗` do ANSI Shadow virariam mojibake.
 */

const WIDE_LINES = [
  '██████╗ ███████╗██████╗ ███╗   ███╗██╗███╗   ██╗███████╗     ██████╗ ██████╗ ███╗   ██╗████████╗███████╗██╗  ██╗████████╗',
  '██╔══██╗██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔════╝    ██╔════╝██╔═══██╗████╗  ██║╚══██╔══╝██╔════╝╚██╗██╔╝╚══██╔══╝',
  '██████╔╝█████╗  ██║  ██║██╔████╔██║██║██╔██╗ ██║█████╗█████╗██║     ██║   ██║██╔██╗ ██║   ██║   █████╗   ╚███╔╝    ██║   ',
  '██╔══██╗██╔══╝  ██║  ██║██║╚██╔╝██║██║██║╚██╗██║██╔══╝╚════╝██║     ██║   ██║██║╚██╗██║   ██║   ██╔══╝   ██╔██╗    ██║   ',
  '██║  ██║███████╗██████╔╝██║ ╚═╝ ██║██║██║ ╚████║███████╗    ╚██████╗╚██████╔╝██║ ╚████║   ██║   ███████╗██╔╝ ██╗   ██║   ',
  '╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝     ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝   ╚═╝   ',
];
const STACKED_LINES = [
  '██████╗ ███████╗██████╗ ███╗   ███╗██╗███╗   ██╗███████╗',
  '██╔══██╗██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔════╝',
  '██████╔╝█████╗  ██║  ██║██╔████╔██║██║██╔██╗ ██║█████╗  ',
  '██╔══██╗██╔══╝  ██║  ██║██║╚██╔╝██║██║██║╚██╗██║██╔══╝  ',
  '██║  ██║███████╗██████╔╝██║ ╚═╝ ██║██║██║ ╚████║███████╗',
  '╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝',
  ' ██████╗ ██████╗ ███╗   ██╗████████╗███████╗██╗  ██╗████████╗',
  '██╔════╝██╔═══██╗████╗  ██║╚══██╔══╝██╔════╝╚██╗██╔╝╚══██╔══╝',
  '██║     ██║   ██║██╔██╗ ██║   ██║   █████╗   ╚███╔╝    ██║   ',
  '██║     ██║   ██║██║╚██╗██║   ██║   ██╔══╝   ██╔██╗    ██║   ',
  '╚██████╗╚██████╔╝██║ ╚████║   ██║   ███████╗██╔╝ ██╗   ██║   ',
  ' ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝   ╚═╝   ',
];
const ASCII_LINES = [
  '             _       _                         _           _   ',
  '  _ _ ___ __| |_ __ (_)_ _  ___ ___ __ ___ _ _| |_ _____ _| |_ ',
  ' | \'_/ -_) _` | \'  \\| | \' \\/ -_)___/ _/ _ \\ \' \\  _/ -_) \\ /  _|',
  ' |_| \\___\\__,_|_|_|_|_|_||_\\___|   \\__\\___/_||_\\__\\___/_\\_\\\\__|',
];
/** Variante escolhida por {@link selectBanner}. */
export type BannerVariant = 'wide' | 'stacked' | 'ascii' | 'plain';

/** Largura mínima (colunas) exigida por cada variante. */
const MIN_WIDTH: Record<Exclude<BannerVariant, 'plain'>, number> = {
  wide: 121,
  stacked: 61,
  ascii: 63,
};

/** Linhas de cada variante, na ordem de renderização. */
const LINES: Record<Exclude<BannerVariant, 'plain'>, readonly string[]> = {
  wide: WIDE_LINES,
  stacked: STACKED_LINES,
  ascii: ASCII_LINES,
};

/**
 * Escolhe a variante do banner para o terminal atual.
 *
 * Ordem de preferência, sempre respeitando a largura disponível:
 * `wide` (uma linha, Unicode) → `stacked` (duas linhas, Unicode) → `ascii`
 * (ASCII puro) → `plain` (sem arte; a tela cai no nome em texto).
 *
 * @param width - Colunas disponíveis (ver `useTerminalWidth`).
 * @param unicode - `true` quando o terminal renderiza os blocos do ANSI Shadow.
 * @returns A variante a renderizar.
 * @example
 * selectBanner(140, true) // 'wide'
 * selectBanner(80, true)  // 'stacked' (não cabe a wide)
 * selectBanner(80, false) // 'ascii'  (sem Unicode)
 */
export function selectBanner(width: number, unicode: boolean): BannerVariant {
  if (unicode) {
    if (width >= MIN_WIDTH.wide) return 'wide';
    if (width >= MIN_WIDTH.stacked) return 'stacked';
  }
  if (width >= MIN_WIDTH.ascii) return 'ascii';
  return 'plain';
}

/**
 * Linhas da variante escolhida.
 *
 * @param variant - Variante de {@link selectBanner}.
 * @returns As linhas da arte; vazio para `plain`.
 */
export function bannerLines(variant: BannerVariant): readonly string[] {
  return variant === 'plain' ? [] : LINES[variant];
}
