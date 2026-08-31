---
'redmine-context': minor
---

Novo `get_last`: contexto das issues mais recentes sem precisar do id.

Adiciona a tool MCP read-only `get_last` e o comando CLI `last`, que devolvem o
**bundle completo** das issues mais recentes — o atalho de um passo para "me dá a
última issue", sem exigir que o chamador descubra o id antes.

A ordem é um parâmetro com default:

- `updated` (**default**) — a mexida mais recente
- `created` — a entrada mais recente (triagem de backlog)
- `priority` — a mais urgente, desempatando pela mais recente

`count` empacota até 5 issues (default 1); cada item é um bundle completo, então
o teto é baixo de propósito — para visões amplas, `search_issues` continua sendo
a superfície certa (lista compacta + filtros). `get_last` considera apenas issues
**abertas** (default do Redmine em `/issues.json`).

No formato `json`, a saída é **sempre um array** — `get_last` devolve uma coleção,
diferente de `get_issue_context`, que devolve o bundle de uma issue.
