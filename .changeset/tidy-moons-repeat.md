---
'redmine-context': minor
---

Histórico do bundle: fim dos ids soltos nas alterações de journal.

O Redmine grava em `journal.details` o nome CRU da coluna e os valores como ids,
então o bundle saía com números sem contexto — `status_id: 1 → 2`,
`assigned_to_id: ∅ → 4` — e custom fields identificados pelo id (`1: Baixa → Alta`).
Nem humano nem LLM conseguem interpretar isso.

Agora, resolvido **sem nenhuma chamada extra à API**:

| Antes | Depois |
|---|---|
| `status_id: 1 → 2` | `Status: #1 → Em andamento (#2)` |
| `assigned_to_id: ∅ → 4` | `Responsável: ∅ → Victor (#4)` |
| `done_ratio: 0 → 40` | `Progresso: 0% → 40%` |
| `1: Baixa → Alta` | `Severidade: Baixa → Alta` |
| `relates: ∅ → 2` | `Relação (relates): ∅ → issue #2` |
| `child_id: ∅ → 3` | `Sub-issue: ∅ → issue #3` |

- **Rótulos**: nomes de coluna padrão viram rótulos legíveis (`status_id` → `Status`).
- **Custom fields**: o id do campo é resolvido para o nome pelos `custom_fields`
  da própria issue.
- **Ids**: quando o valor bate com o estado ATUAL da issue, ganha o nome junto;
  caso contrário sai como `#id`, para nunca parecer um número solto. A comparação
  é segura — só o último journal que alterou um campo tem `new_value` igual ao
  valor corrente, então nenhum valor histórico é nomeado incorretamente.

Fences preservadas: rótulos de campo padrão são vocabulário do Redmine e ficam
fora, como já acontece nos Metadados; nomes de custom field, valores de texto
(`subject`/`description`) e atributos desconhecidos seguem dentro de
`<untrusted-content>`. Valores só saem da fence quando são id inteiro — string
livre da API volta para dentro dela.

O bundle Markdown muda byte-a-byte — quem compara snapshots precisa regravá-los.
