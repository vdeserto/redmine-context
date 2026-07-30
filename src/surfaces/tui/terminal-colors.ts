/**
 * Aplica as cores da paleta como DEFAULT do terminal via OSC (#190).
 *
 * Em vez de pintar um Box de fundo (que deixava emenda e não cobria a tela toda),
 * setamos o fundo (OSC 11) e o texto (OSC 10) DEFAULT do terminal para os da
 * paleta. Efeito: o buffer inteiro (inclusive áreas vazias) ganha o fundo temático,
 * e todo texto SEM cor explícita usa a cor de texto da paleta — legível em qualquer
 * terminal (claro ou escuro). Ao sair, {@link resetTerminalColors} restaura o padrão.
 *
 * OSC = "Operating System Command": `ESC ] <n> ; <valor> BEL`. Suportado pelos
 * emuladores modernos (iTerm2, Terminal.app, etc.); onde não houver suporte, os
 * códigos são ignorados — as paletas CLARAS ainda ficam legíveis sobre o fundo
 * claro do terminal (degradação graciosa).
 */

import type { Theme } from './theme.js';

const BEL = '\x07';

/**
 * Escreve OSC 11 (fundo) e OSC 10 (texto) com as cores da paleta, quando definidas.
 *
 * @param out - Stream do terminal.
 * @param theme - Tema/paleta ativa (usa `background`/`text`).
 */
export function applyTerminalColors(out: NodeJS.WriteStream, theme: Theme): void {
  let seq = '';
  if (theme.background !== undefined) seq += `\x1b]11;${theme.background}${BEL}`;
  if (theme.text !== undefined) seq += `\x1b]10;${theme.text}${BEL}`;
  if (seq.length > 0) out.write(seq);
}

/**
 * Restaura o fundo (OSC 111) e o texto (OSC 110) DEFAULT do terminal ao valor
 * original — chamado ao sair do full-screen (inclusive em sinal, via alt-screen).
 *
 * @param out - Stream do terminal.
 */
export function resetTerminalColors(out: NodeJS.WriteStream): void {
  out.write(`\x1b]110${BEL}\x1b]111${BEL}`);
}
