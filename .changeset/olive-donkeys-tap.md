---
'redmine-context': patch
---

Corrige campos de planejamento que nunca chegavam ao bundle.

`done_ratio`, `start_date` e `due_date` estavam declarados no contrato (`Issue`)
e eram renderizados pelo `renderHeader` do bundle Markdown — mas o
`normalizeIssue` nunca os extraía do payload. Resultado: "Progresso", "Início" e
"Prazo" jamais apareciam nos Metadados, mesmo quando o Redmine os devolvia, e o
bundle JSON saía sem as três chaves.

Datas nulas (o Redmine devolve `null` quando não preenchidas) continuam
resultando em campo **ausente**, não em string vazia — o padrão do resto do
normalize. `done_ratio: 0` é preservado como valor legítimo.

Elimina também a causa do `TOOL_VERSION` dessincronizado. O #195 já havia
sincronizado o valor para `1.0.0`, mas mantendo a constante literal — o bump do
changesets altera só o manifesto, então ela voltaria a divergir no próximo
release, reprovando de novo o gate de empacotamento
(`tests/packaging/smoke-pack.test.ts`). Agora a versão é **lida** do
`package.json` em tempo de execução: `../package.json` resolve tanto de `src/`
(dev/testes) quanto de `dist/` (pacote publicado, onde o npm sempre inclui o
manifesto), e não há mais número para manter em dois lugares.
