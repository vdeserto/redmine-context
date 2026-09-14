---
'redmine-context': minor
---

Paginação na lista: `←`/`→` saltam uma tela por vez.

Navegar item a item não escala — uma lista filtrada por status pode ter centenas
de entradas, e chegar ao fim exigia segurar a seta para baixo. As setas
HORIZONTAIS não tinham uso na lista e passam a paginar (junto de `PageUp`/
`PageDown`, para quem tem as teclas).

Uma página equivale à ALTURA da janela visível, então cada salto troca a tela
inteira. Ao contrário de `↑`/`↓`, a paginação NÃO dá a volta: para nas bordas,
como em qualquer paginador — pular do topo direto para o fim da lista desorienta.
