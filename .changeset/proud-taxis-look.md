---
'redmine-context': patch
---

Corrige o texto embaralhado na tela de detalhe e a busca sem como abrir a issue.

**Resultados da busca não eram navegáveis.** Achar o chamado e não conseguir
abri-lo é o mesmo que não ter achado: a navegação da lista fica desligada
enquanto a busca está aberta (as teclas pertencem ao campo) e os resultados não
tinham navegação própria. Agora `↑`/`↓` percorrem os resultados — setas não são
texto, então não disputam com a query — e `Enter` abre. O cursor volta ao topo
quando a consulta muda, senão o `Enter` abriria uma issue de uma busca anterior.

**Texto sobreposto no detalhe**, com o fim de um parágrafo colado no meio de
outro. Eram três causas somadas, todas quebrando a mesma invariante — o viewport
conta ITENS como linhas de tela:

- um journal detail de edição de descrição carrega o texto INTEIRO, com quebras
  de linha, nos dois lados da alteração: um único item virava dezenas de linhas.
  Um resumo de alteração é de uma linha por definição, então o valor é achatado
  (no bundle isso também tirava a fence do lugar) e cortado na exibição — o
  conteúdo completo segue na seção Descrição;
- a moldura da aplicação consome 2 linhas e as telas não sabiam disso. Em vez de
  cada tela carregar uma constante acoplada ao shell, o shell passou a entregar
  a altura já descontada (`TerminalHeightProvider`);
- qualquer linha mais larga que a tela era quebrada pelo Ink em duas. As linhas
  do viewport passam a truncar, garantindo a invariante mesmo se o cálculo de
  largura errar.
