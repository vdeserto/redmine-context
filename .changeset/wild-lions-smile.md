---
'redmine-context': minor
---

Filtro por status REAL da instância, com seletor visível.

O filtro da home ciclava entre `todas → abertas → fechadas`. Numa instância real
isso não filtra nada: todos os status de trabalho (Nova, Fila, Estimativa,
Atribuída, Em Andamento, Aguardando, Validação…) são ABERTOS, então alternar
entre "todas" e "abertas" devolvia exatamente a mesma lista — e o filtro parecia
quebrado.

Agora `f` abre um **seletor** com os status da própria instância
(`/issue_statuses.json`, já memoizado), cada um na cor que a lista usa para ele,
com o atual marcado e os agregados (`Todas`/`Abertas`/`Fechadas`) separados dos
status concretos. Navega com `↑/↓`, aplica com `Enter`, cancela com `Esc` — o
mesmo padrão da tela de Aparência.

Três decisões de UX vieram de ver a tela com dados reais:

- **Ciclo → lista.** Ciclar às cegas não diz quais opções existem; com uma dezena
  de status, o usuário não tem como adivinhar o que vem a seguir.
- **Contagem no cabeçalho** (`[Em Andamento] · 4 issues`). Sem ela, aplicar um
  filtro que devolve o mesmo conjunto parece não fazer nada — foi o que levou o
  filtro a ser reportado como quebrado.
- **Default `Abertas`, não `Todas`.** Com `all`, o Redmine devolve o histórico
  inteiro (centenas de fechadas), que estoura a tela e enterra o trabalho atual.

Corrige também o `Enter` do seletor, que aplicava o filtro **e** abria a issue
selecionada por baixo: o Ink entrega a tecla a todos os handlers, então a
navegação da lista precisa ficar inativa enquanto o seletor está aberto.
