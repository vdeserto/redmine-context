---
'redmine-context': patch
---

Lista da home rola numa janela, em vez de estourar a tela.

A home renderizava TODAS as issues de uma vez. Com a lista curta (as abertas de
uma pessoa) isso passava despercebido; filtrando por um status com centenas de
itens — 288 fechadas, no caso real — a lista transbordava a altura do terminal,
empurrava o rodapé de atalhos para fora e levava junto o cursor, que começa no
topo: não dava para saber onde a seleção estava.

Agora só a fatia visível é renderizada, numa janela que ACOMPANHA o cursor (ele
fica ao meio sempre que possível, e a janela gruda nas pontas). Um contador
`1-28 de 288 ↓` mostra a posição na lista inteira.

A janela é função pura de `(total, selecionado, altura)` — sem offset guardado,
que precisaria ser sincronizado com a seleção, com a troca de filtro e com o
redimensionamento do terminal.
