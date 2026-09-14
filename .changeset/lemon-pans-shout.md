---
'redmine-context': patch
---

Busca da TUI não mostra mais a marcação `<untrusted-content>`.

A tela renderizava o Markdown devolvido pelo core, que embrulha todo texto vindo
do Redmine em fences `<untrusted-content>`. Essa marcação existe para o LLM — é
a barreira anti prompt-injection do bundle — e não tem função nenhuma numa
interface: o usuário via as tags em volta de cada assunto de issue.

O resultado da busca passa a expor os itens ESTRUTURADOS (`items`) além do
Markdown, e a TUI renderiza a partir deles, com o mesmo layout da lista
principal (id, assunto truncado, status colorido, responsável). O `content`
continua disponível para quem precisa do Markdown — o MCP, que é justamente
quem deve receber as fences.

Corrige também o rodapé da busca, que ainda mandava apertar `f` para "ciclar o
filtro": `f` abre o seletor de status e só funciona com a busca FECHADA, porque
dentro do campo toda letra é texto.
