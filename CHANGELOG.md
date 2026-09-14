# redmine-context

## 1.1.0

### Minor Changes

- 0c5a9a1: Pacote estético da TUI: banner ASCII, barra de progresso e moldura.

  **Banner na tela de abertura.** O nome do produto passa a ser desenhado em arte
  ASCII com o gradiente da paleta ativa. A arte é constante (`src/surfaces/tui/banner.ts`)
  em vez de gerada em runtime: o texto é sempre o mesmo, então uma dependência de
  fontes custaria peso no pacote e tempo de boot sem entregar nada.

  Três variantes, escolhidas pela largura do terminal e pelo suporte a Unicode:
  `wide` (121 colunas, uma linha) → `stacked` (61 colunas, duas linhas) → `ascii`
  (63 colunas, ASCII puro) → `plain` (sem arte). O sinal de Unicode é o mesmo que
  já degrada os frames braille do spinner no terminal legado do Windows — sem ele,
  os blocos do ANSI Shadow virariam mojibake.

  O nome continua presente em TEXTO junto da versão: a arte é decorativa e
  ilegível para leitor de tela.

  **Barra de progresso nos jobs.** O `Job` já carregava `progress`, mas a tela só
  mostrava o status textual — a extração de mídia (OCR, ffmpeg, whisper) roda em
  background sem dar noção de quanto falta. As células da barra entram no conjunto
  central de glyphs, com fallback `#`/`-`.

  **Moldura da aplicação.** Borda arredondada na cor do tema, no shell comum — as
  telas não sabem que existe uma.

  Contraste: todas as cores vêm da paleta ativa. As quatro paletas claras usam
  gradientes saturados e permanecem legíveis mesmo sobre fundo escuro (o pior
  caso, quando a paleta não casa com o terminal).

- f19efbd: Novo `get_last`: contexto das issues mais recentes sem precisar do id.

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

- 7dbcef5: Histórico legível na TUI, ids resolvidos pelos dois lados e descrição sem texto comido.

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

  | Antes                      | Depois                                                            |
  | -------------------------- | ----------------------------------------------------------------- |
  | `status_id: 12 → 7`        | `Status: Estimativa (#12) → Atribuída (#7)`                       |
  | `assigned_to_id: 11 → 157` | `Responsável: David Alves da Silva (#11) → Victor Deserto (#157)` |
  | `tracker_id: 3 → 2`        | `Tracker: Não Classificado (#3) → Manutenção Evolutiva (#2)`      |

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

- f19efbd: Histórico do bundle: fim dos ids soltos nas alterações de journal.

  O Redmine grava em `journal.details` o nome CRU da coluna e os valores como ids,
  então o bundle saía com números sem contexto — `status_id: 1 → 2`,
  `assigned_to_id: ∅ → 4` — e custom fields identificados pelo id (`1: Baixa → Alta`).
  Nem humano nem LLM conseguem interpretar isso.

  Agora, resolvido **sem nenhuma chamada extra à API**:

  | Antes                   | Depois                            |
  | ----------------------- | --------------------------------- |
  | `status_id: 1 → 2`      | `Status: #1 → Em andamento (#2)`  |
  | `assigned_to_id: ∅ → 4` | `Responsável: ∅ → Victor (#4)`    |
  | `done_ratio: 0 → 40`    | `Progresso: 0% → 40%`             |
  | `1: Baixa → Alta`       | `Severidade: Baixa → Alta`        |
  | `relates: ∅ → 2`        | `Relação (relates): ∅ → issue #2` |
  | `child_id: ∅ → 3`       | `Sub-issue: ∅ → issue #3`         |

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

### Patch Changes

- 73fea1a: Moldura da TUI degrada para ASCII no terminal legado.

  A borda `round` do shell usa box-drawing Unicode (`╭ ─ │ ╯`), que vira mojibake
  no cmd.exe/PowerShell antigo — o mesmo problema que o projeto já tratava nos
  frames braille do spinner, nas setas de navegação e no banner. A moldura era a
  única peça que não acompanhava a política de glyphs.

  Agora o estilo é decidido pelo MESMO sinal (`isUnicodeSupported`): `round` onde
  há Unicode, `classic` (`+ - |`) onde não há.

- f19efbd: Corrige campos de planejamento que nunca chegavam ao bundle.

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

## 1.0.0

Primeiro release público estável.

### Minor Changes

- 1b6349b: Release inicial do redmine-context: consumidor de Redmine que entrega contexto
  completo de issues (texto + mídia extraída 100% localmente) para qualquer LLM,
  via MCP, CLI e TUI (Ink). Inclui distribuição por npx nos 3 SOs, CI em matriz
  (typecheck/lint/testes + E2E Linux + smoke npx macOS/Windows) e pipeline de
  release com Changesets (versionamento automático, CHANGELOG e publish npm com
  provenance).
- 3846362: Extração de texto de documentos Office (OOXML) — `.docx`, `.pptx`, `.xlsx` — 100% local e **sem binário externo** (não entra no `doctor`, funciona nos 3 SOs sem instalar nada). Antes esses anexos saíam como `unsupported`. Leitor ZIP zero-dependência (via `node:zlib`) + extração de texto por dialeto, com scanner linear (sem ReDoS), orçamento anti-zip-bomb e degradação graciosa.
- f5911d0: Persistência da URL da instância (#187): o `login` agora salva a instância autenticada e a CLI/TUI/MCP a usam como fallback quando `--url`/`REDMINE_URL` estão ausentes. Precedência: `--url` → `REDMINE_URL` → URL persistida. Resolve o atrito de a TUI falhar com "Instância não configurada" mesmo com credencial salva. O `config`/`doctor` mostram a origem da instância e o `logout` limpa a URL persistida.
- 38ce3ea: TUI mais bonita (#190): **full-screen** (alt-screen buffer, como vim/htop, restaurado ao sair) e **kits de paletas de cores** em truecolor — Catppuccin Mocha (default), Dracula, Nord, Tokyo Night, Gruvbox Dark, Rosé Pine, Solarized Dark e One Dark. Nova tela **Aparência** (`a` no Início) com preview ao vivo (`↑`/`↓`), salvar (`Enter`, persistido em `settings.json`) e cancelar (`Esc`). Títulos com gradiente. Degradação preservada: `NO_COLOR`/CI/não-TTY seguem em texto puro.

### Patch Changes

- b762740: Completa os metadados de publicação do `package.json`: `repository`, `homepage`,
  `bugs`, `keywords`, `author` e `publishConfig` (`access: public`, `provenance:
true`). O `repository.url` é exigido pela validação de proveniência (SLSA/OIDC) do
  `npm publish`; os demais melhoram a página e a descoberta do pacote no npm.
- 8fd8cb6: Polish de legibilidade da TUI full-screen (#190): as cores da paleta agora são
  aplicadas ao terminal via **OSC 10/11** (fg/bg), então o texto fica legível tanto
  em terminal **claro** quanto **escuro**; **12 paletas** (8 escuras + 4 claras) com
  tokens `text`/`background`. Removido o atributo **negrito** de toda a interface —
  em alguns terminais (ex.: Terminal.app) o negrito ignorava a cor e virava preto
  ilegível; o destaque agora vem só da cor + a setinha de seleção. Atalhos
  **ancorados no rodapé** (estilo nano/nvim/tmux) e descrição que **cresce para
  preencher a tela**. Anexos extraíveis (imagem/PDF/áudio/vídeo/OOXML) passam a
  exibir **"pendente"** em vez de "não suportado".
