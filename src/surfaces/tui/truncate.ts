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
  *
 * LIMITAÇÃO ACEITA (review #126): mede em unidades UTF-16 (`.length`), não em
 * largura visual de terminal — acentos PT-BR ocupam 1 coluna e funcionam;
 * CJK/emoji (largura dupla) podem estourar o orçamento. Suporte real de
 * largura visual (ex.: string-width) fica para quando houver demanda — ver
 * issue de follow-up da responsividade.
 *
 * HARDENING WINDOWS LEGADO (M5-09, #84): o marcador de corte deixou de ser um
 * literal fixo `'…'` e passa a vir de `./glyphs.ts`, que degrada para `'...'`
 * no terminal legado do Windows (evitando o mojibake da reticência Unicode).
 * Como o fallback ASCII tem LARGURA 3 (vs. 1 do `'…'`), a matemática de corte
 * agora desconta `ellipsis.length` em vez de assumir 1 — do contrário o
 * resultado ASCII estouraria a largura orçada. O marcador é um parâmetro com
 * default (`glyphs.ellipsis`) para manter as funções puras e testáveis com
 * qualquer largura de reticência.
 */
import { glyphs } from './glyphs.js';

/**
 * Trunca `text` em `max` caracteres a partir do FIM, terminando com o marcador
 * de corte quando corta. Uso padrão — subjects, rótulos, qualquer string onde
 * o INÍCIO é a parte mais relevante.
 *
 * @param text - String candidata a corte.
 * @param max - Largura máxima permitida (colunas). `max <= 0` retorna vazio.
 * @param ellipsis - Marcador de corte (default: `glyphs.ellipsis`, ASCII no
 *   terminal legado do Windows). Seu comprimento é descontado do orçamento.
 * @returns `text` inalterado (couber) ou cortado com reticências ao final.
 *
 * @example
 * truncate('Refatorar o pipeline de exportação de anexos', 20); // 'Refatorar o pipel…'
 */
export function truncate(text: string, max: number, ellipsis: string = glyphs.ellipsis): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max <= ellipsis.length) return ellipsis.slice(0, max);
  return `${text.slice(0, max - ellipsis.length)}${ellipsis}`;
}

/**
 * Trunca `text` em `max` caracteres a partir do INÍCIO, iniciando com o
 * marcador de corte quando corta. Uso em caminhos/campos em edição — onde o
 * FIM é a parte mais relevante (nome do arquivo ao final de um path, ou o
 * cursor de digitação de um campo de texto ainda ativo).
 *
 * @param text - String candidata a corte.
 * @param max - Largura máxima permitida (colunas). `max <= 0` retorna vazio.
 * @param ellipsis - Marcador de corte (default: `glyphs.ellipsis`, ASCII no
 *   terminal legado do Windows). Seu comprimento é descontado do orçamento.
 * @returns `text` inalterado (couber) ou cortado com reticências no início.
 *
 * @example
 * truncateStart('/home/usuario/projetos/redmine-context/saida', 20); // '…text/redmine-context/saida'.slice — ver teste para o valor exato
 */
export function truncateStart(text: string, max: number, ellipsis: string = glyphs.ellipsis): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max <= ellipsis.length) return ellipsis.slice(0, max);
  return `${ellipsis}${text.slice(text.length - (max - ellipsis.length))}`;
}
