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

**Badge do filtro colorido.** `[Abertas]`/`[Fechadas]` puxam cor do tema (sinal
de filtro ativo); `[Todas]` fica discreto, por ser a ausência de filtro. As cores
concordam com a heurística de status já usada nas listas — "fechado" é `success`
nos dois lugares — e saem sempre de tokens da paleta, calibrados para contraste
tanto nas claras quanto nas escuras.
