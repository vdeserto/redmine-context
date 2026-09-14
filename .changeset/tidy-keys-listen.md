---
'redmine-context': patch
---

Corrige dois bugs de teclado/filtro na TUI.

**`q` fechava a TUI no meio da digitação.** O Ink entrega cada tecla a TODOS os
`useInput` registrados — um campo de texto ativo não consome a tecla. O atalho
global de sair não tinha guarda, então digitar uma URL com "q" no onboarding
(`https://redmine.qualquer...`), ou uma senha que contivesse a letra, encerrava
o aplicativo. Agora qualquer `TextInput` ativo suspende os atalhos de LETRA
(`src/surfaces/tui/hooks/use-typing-guard.ts`), no mesmo desenho do interceptor
de `Esc` que já existia. Atalhos com modificador (`Ctrl+C`) seguem livres, pois
não colidem com texto.

**Trocar o filtro de status não mudava nada na tela.** O `f` alimentava apenas a
busca, cujos resultados só são renderizados com a busca ABERTA — com ela fechada,
o rótulo `[Abertas]` mudava no cabeçalho mas a lista continuava idêntica. Agora o
filtro chega à lista de "Minhas issues" (`status_id` na query), usando a MESMA
tradução da busca para as duas não divergirem.

A dica na tela também estava errada: "pressione f para ciclar o filtro" aparecia
dentro da busca aberta, exatamente onde `f` é texto e não atalho.

**O mesmo bug existia no `b` da tela de exportação.** O campo "Destino" e o
atalho de voltar convivem na mesma tela, então digitar um caminho como
`~/backup/` ou `bundle.json` fechava a tela no meio da digitação. A guarda foi
construída como mecanismo geral mas estava ligada em um único ponto — agora a
tela de exportação também a consulta.

**Teclas perdidas ao digitar rápido.** A ref do valor do `TextInput` era
sincronizada apenas no render, então duas teclas chegadas antes do commit do
React partiam do mesmo valor antigo e a última vencia: digitar uma URL em
velocidade normal corrompia o campo (`abcdefgh` virava `h`). A ref passa a
avançar junto com a emissão, na escrita e no backspace.

**Fechar a busca não apaga mais o filtro.** Com o filtro governando a LISTA,
resetá-lo ao fechar a busca desfazia uma escolha feita ANTES de abri-la — `f`,
`/`, `Esc` devolvia [Todas].

**Um request a menos por `f`.** Com a busca fechada, o filtro ia também para o
hook de busca, que fazia uma chamada de rede cujo resultado nunca era
renderizado. Agora o filtro só chega à busca quando ela está aberta.

**Badge do filtro colorido.** `[Abertas]`/`[Fechadas]` puxam cor do tema (sinal
de filtro ativo); `[Todas]` fica discreto, por ser a ausência de filtro. As cores
concordam com a heurística de status já usada nas listas — "fechado" é `success`
nos dois lugares — e saem sempre de tokens da paleta, calibrados para contraste
tanto nas claras quanto nas escuras.
