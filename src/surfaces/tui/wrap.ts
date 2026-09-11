/**
 * Quebra de linha por LARGURA para as viewports roláveis da TUI.
 *
 * `../components/scroll-view.tsx` mostra `height` ITENS do array `lines` e
 * assume que cada item ocupa UMA linha na tela. Texto vindo do Redmine não
 * respeita isso: a descrição de um chamado costuma ter parágrafos de centenas
 * de caracteres, o Ink os quebra sozinho em várias linhas visuais, e a conta do
 * viewport passa a errar — o conteúdo escapa da janela, o começo das frases
 * some e a moldura da aplicação aparece em pedaços no meio do texto.
 *
 * Quebrando ANTES de montar as linhas, cada item volta a ser uma linha visual e
 * o ScrollView fica correto sem precisar saber medir texto.
 *
 * A medida é em code points (`[...text]`), a mesma convenção de `./truncate.ts`:
 * suficiente para o conteúdo latino dos chamados e sem trazer dependência de
 * largura de glifo (CJK/emoji contariam 2 colunas).
 */

/**
 * Quebra um parágrafo em linhas de no máximo `width` colunas, sem cortar
 * palavras (exceto quando a palavra sozinha excede a largura).
 *
 * @param text - Uma linha lógica (sem `\n`).
 * @param width - Largura disponível em colunas; `<= 0` devolve o texto inteiro
 *   numa linha só (não há o que quebrar de forma útil).
 * @returns As linhas resultantes; nunca vazio — texto vazio devolve `['']` para
 *   preservar a linha em branco do original.
 * @example
 * wrapLine('uma frase bem comprida', 10); // ['uma frase', 'bem', 'comprida']
 */
export function wrapLine(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const chars = [...text];
  if (chars.length <= width) return [text];

  const lines: string[] = [];
  let current = '';

  const pushCurrent = (): void => {
    if (current.length > 0) {
      lines.push(current);
      current = '';
    }
  };

  for (const word of text.split(' ')) {
    const wordLength = [...word].length;
    const currentLength = [...current].length;

    // Palavra maior que a largura (URL, hash, caminho): quebra à força, em
    // pedaços do tamanho da linha — melhor que estourar o viewport.
    if (wordLength > width) {
      pushCurrent();
      let rest = [...word];
      while (rest.length > width) {
        lines.push(rest.slice(0, width).join(''));
        rest = rest.slice(width);
      }
      current = rest.join('');
      continue;
    }

    if (currentLength === 0) {
      current = word;
    } else if (currentLength + 1 + wordLength <= width) {
      current = `${current} ${word}`;
    } else {
      pushCurrent();
      current = word;
    }
  }

  pushCurrent();
  return lines.length > 0 ? lines : [''];
}

/**
 * Quebra um texto multi-linha, preservando as linhas em branco do original.
 *
 * @param text - Texto com `\n` (descrição de issue, nota de journal).
 * @param width - Largura disponível em colunas.
 * @returns Todas as linhas já ajustadas à largura.
 */
export function wrapText(text: string, width: number): string[] {
  return text.split('\n').flatMap((line) => wrapLine(line, width));
}
