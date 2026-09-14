/**
 * Janela visível de uma lista longa, seguindo o cursor.
 *
 * A home renderizava TODAS as issues de uma vez. Enquanto a lista era curta
 * (as abertas de uma pessoa) isso passava; filtrando por um status com centenas
 * de itens, a lista estoura a altura do terminal, o rodapé é empurrado para fora
 * e o cursor — que começa no topo — some da tela: "cadê meu cursor".
 *
 * Esta é a contraparte de `./components/scroll-view.tsx` para listas
 * SELECIONÁVEIS: lá o deslocamento é dirigido pelo teclado sobre conteúdo
 * estático; aqui ele acompanha o índice selecionado, que é quem manda.
 *
 * Sem estado próprio de propósito: a janela é função do (total, selecionado,
 * altura). Guardar um offset exigiria sincronizá-lo com a seleção, com a troca
 * de filtro e com o redimensionamento do terminal — três fontes de divergência.
 */

/** Intervalo `[start, end)` de itens a renderizar. */
export interface ListWindow {
  /** Índice do primeiro item visível. */
  readonly start: number;
  /** Índice logo APÓS o último visível (exclusivo, pronto para `slice`). */
  readonly end: number;
}

/**
 * Calcula a fatia visível mantendo o item selecionado dentro dela.
 *
 * O cursor é mantido ao MEIO da janela sempre que possível; nas pontas a janela
 * gruda no início ou no fim, para não sobrar espaço vazio.
 *
 * @param total - Quantidade de itens da lista.
 * @param selected - Índice selecionado (fora da faixa é fixado nela).
 * @param height - Linhas disponíveis; `<= 0` devolve uma janela vazia.
 * @returns O intervalo `[start, end)` para `slice`.
 * @example
 * listWindow(347, 0, 20);   // { start: 0, end: 20 }
 * listWindow(347, 200, 20); // { start: 190, end: 210 } — cursor centrado
 * listWindow(347, 346, 20); // { start: 327, end: 347 } — grudado no fim
 */
export function listWindow(total: number, selected: number, height: number): ListWindow {
  if (height <= 0 || total <= 0) return { start: 0, end: 0 };
  if (total <= height) return { start: 0, end: total };

  const cursor = Math.min(Math.max(selected, 0), total - 1);
  const half = Math.floor(height / 2);
  const start = Math.min(Math.max(0, cursor - half), total - height);
  return { start, end: start + height };
}
