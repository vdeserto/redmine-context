---
'redmine-context': minor
---

Histórico legível na TUI, ids resolvidos pelos dois lados e descrição sem texto comido.

**A TUI mostrava os ids crus.** A tradução dos `journal.details` vivia dentro do
bundle Markdown, então CLI e MCP liam `Status: #12 → Atribuída (#7)` enquanto a
tela de detalhe ainda mostrava `status_id: 12 → 7` e custom fields pelo id
(`85: — → 0`). A semântica passa a viver em `src/bundle/journal-detail.ts`,
consumida pelas duas superfícies: cada uma aplica sua política sobre as partes
devolvidas — o bundle envolve o não confiável na fence anti prompt-injection, a
TUI apenas exibe (é interface, não prompt).

**Metade de cada alteração continuava ilegível.** Só o valor que coincidia com o
estado ATUAL da issue ganhava nome; o histórico ficava `#12` ("não sei o que é
status 12"). Agora os ids são resolvidos pelas enumerações da instância —
`/issue_statuses.json`, `/trackers.json` e `/enumerations/issue_priorities.json`,
que qualquer usuário autenticado lê (não exigem admin):

| Antes | Depois |
|---|---|
| `status_id: 12 → 7` | `Status: Estimativa (#12) → Atribuída (#7)` |
| `assigned_to_id: 11 → 157` | `Responsável: David Alves da Silva (#11) → Victor Deserto (#157)` |
| `tracker_id: 3 → 2` | `Tracker: Não Classificado (#3) → Manutenção Evolutiva (#2)` |

A busca é memoizada por instância (uma vez por processo), só acontece quando a
issue tem histórico para traduzir, e cada endpoint degrada de forma independente
e silenciosa — sem nenhum deles, volta a exibir `#id`. Os NOMES DE USUÁRIO saem
do próprio payload (autor, responsável, autor de cada journal/anexo, watchers),
sem rede: `/users.json` exigiria admin.

**Descrição com o começo dos parágrafos comido.** O Redmine grava CRLF, e o `\r`
isolado é ativo no terminal: devolve o cursor ao início da linha, fazendo o texto
seguinte sobrescrever o anterior ("Solicita-se que a área..." aparecia como
"que a área..."). O `normalizeIssue` passa a converter `\r\n` e `\r` em `\n`, o
que também tira ruído do Markdown e do JSON.

**Parágrafo longo estourava o viewport.** O `ScrollView` conta ITENS do array
como linhas de tela; um parágrafo maior que a largura era requebrado pelo Ink e
desalinhava a janela, deixando a moldura aparecer em pedaços no meio do texto. O
novo `wrapText` quebra na largura disponível antes de montar as linhas.
