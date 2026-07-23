/**
 * Truncamento por largura, unificado (M2-16, #39) — fonte única para cortar
 * strings que podem estourar a largura do terminal (subject da issue, valor
 * de um `StatusRow` do doctor, caminho de destino/exportação etc.). Antes
 * duplicado como função local em `screens/home.tsx`.
 *
 * Por que isso é necessário mesmo o Ink já quebrando `<Text>` automaticamente
 * em várias linhas: dentro de um `<Box>` em linha (`flexDirection: 'row'`, o
 * padrão do componente), CADA `<Text>` IRMÃ tenta se auto-ajustar à largura
 * restante de forma independente — quando uma delas (ex.: o subject de uma
 * issue) é mais longa que o espaço sobrando, o resultado observado é
 * sobreposição ilegível entre o conteúdo dela e o das irmãs seguintes
 * (confirmado empiricamente antes desta mudança: um subject comprido "vazava"
 * por cima do badge de status da linha). Truncar explicitamente o campo
 * variável ANTES de renderizar evita esse caso — diferente de um bloco de
 * texto isolado (ex.: descrição/journals em `screens/issue-detail.tsx`), que
 * pode seguir confiando no wrap nativo do Ink sem risco de sobreposição.
 */

/** Marcador de corte — um único caractere (reticências), nunca `'...'` (3 colunas). */
const ELLIPSIS = '…';

/**
 * Trunca `text` em `max` caracteres a partir do FIM, terminando com
 * {@link ELLIPSIS} quando corta. Uso padrão — subjects, rótulos, qualquer
 * string onde o INÍCIO é a parte mais relevante.
 *
 * @param text - String candidata a corte.
 * @param max - Largura máxima permitida (colunas). `max <= 0` retorna vazio.
 * @returns `text` inalterado (couber) ou cortado com reticências ao final.
 *
 * @example
 * truncate('Refatorar o pipeline de exportação de anexos', 20); // 'Refatorar o pipel…'
 */
export function truncate(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max === 1) return ELLIPSIS;
  return `${text.slice(0, max - 1)}${ELLIPSIS}`;
}

/**
 * Trunca `text` em `max` caracteres a partir do INÍCIO, iniciando com
 * {@link ELLIPSIS} quando corta. Uso em caminhos/campos em edição — onde o
 * FIM é a parte mais relevante (nome do arquivo ao final de um path, ou o
 * cursor de digitação de um campo de texto ainda ativo).
 *
 * @param text - String candidata a corte.
 * @param max - Largura máxima permitida (colunas). `max <= 0` retorna vazio.
 * @returns `text` inalterado (couber) ou cortado com reticências no início.
 *
 * @example
 * truncateStart('/home/usuario/projetos/redmine-context/saida', 20); // '…text/redmine-context/saida'.slice — ver teste para o valor exato
 */
export function truncateStart(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max === 1) return ELLIPSIS;
  return `${ELLIPSIS}${text.slice(text.length - (max - 1))}`;
}
