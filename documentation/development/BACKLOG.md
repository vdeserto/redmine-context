# Breakdown — redmine-context (/plan:breakdown, 2026-07-21)

## Context

Quebra do plano v2 (aprovado no /plan:refine) em milestones → issues → sub-issues, prontos para o /plan:publish criar no GitHub (issues, milestones, Projects, sub-issues via create_subissue). Regras aplicadas: EAT ≤ 30min por item executável (epics são contêineres), AC testáveis, DoD com TDD (testes antes, cobertura ≥ 80%), docs path por issue, gap analysis fechando cada milestone. Produzido pelos agentes fft-project-manager (2x), fft-github, validado por fft-po.

**Referências**: ADRs `documentation/adr/ADR-001..005`, PRD `documentation/prd/PRD-redmine-context.md`, plano compacto `documentation/development/PLAN.md`.

**Totais**: M1=21 · M2=19 · M3=16 · M4=17 · M5=14 → **87 itens** (6 epics, 15 sub-issues, 5 gap analysis). EAT executável somado ≈ 28h.

**Validação fft-po aplicada (2026-07-21)**: 9 ajustes — cobertura de `get_attachment_text` (novo M3-13 + extensão no M4-11), dogfood do M1 desbloqueado de `search_issues` (M1-14 depende só de M1-12; M1-13 vira pós-dogfood priority:low), splits de EAT irrealista (M1-02.2→.2/.3, M1-04.2→.2/.3), AC estético do M2-16 tornado testável, compose do M1-02.1 CI-ready (reuso no M5-05.1), métrica <30s do PRD com gate em M1-14 e M4-11.

---

## Convenções GitHub (para /plan:publish e dev flow)

**Bootstrap (pré-publish)**: `git init -b main` → .gitignore Node → primeiro commit → `gh repo create <owner>/redmine-context --private --source=. --remote=origin` (privado até M5; público no release) → LICENSE MIT → proteção de main (PR obrigatório, CI verde, sem force-push; sem review humano obrigatório — solo dev).

**Labels**: `type:{feature,chore,bug,docs,test,refactor}` · `size:XS` (≤15min) / `size:S` (≤30min) · `status:{ready,in-progress,blocked,review}` · `priority:{high,medium,low}` · `sub-issue` · `gap-analysis` · `epic`.

**Milestones GitHub**: `M1 — Core + CLI + MCP fino` (+3 sem) · `M2 — TUI + keychain` (+6 sem) · `M3 — Anexos + OCR` (+9 sem) · `M4 — Áudio/vídeo` (+12 sem) · `M5 — Distribuição` (+14 sem).

**Corpo da issue** (template): seções `## Contexto`, `## EAT`, `## Critérios de Aceitação` (checklist), `## Definition of Done` (checklist), `## Docs path`, `## Deps` (Depende de/Bloqueia), `## Parent` (só sub-issues). Sub-issues: label `sub-issue` + `Parent: #N` no corpo; publish usa create_subissue do GitHub Projects MCP E popula task-list `## Sub-issues` no corpo do pai (fallback/redundância).

**Branches/PRs**: `type/M<n>-<seq>-<slug>` (ex. `feat/M1-04-rest-client`); Conventional Commits com `(#N)`; 1 issue = 1 branch = 1 PR = squash merge; `Closes #N` no PR; branch deletada pós-merge.

**Projects**: campos Status (Ready/In Progress/Blocked/Review/Done), Milestone, EAT (number, min), Prioridade; views: board por Status, tabela por Milestone com soma de EAT.

---

## M1 — Core + CLI + MCP fino (texto-only)

### M1-01: Inicializar repositório e toolchain TypeScript
EAT: 30min | Deps: — | Labels: type:chore, size:S
AC: • git init + .gitignore Node + primeiro commit da estrutura src/ (client, normalize, bundle, config, cache stubs) conforme os 6 módulos • tsconfig strict, ESM, target Node ≥ 20; typecheck e lint verdes • vitest com threshold 80% e teste smoke rodando
DoD: • teste smoke escrito antes da config final (TDD) • typecheck/lint/test verdes em máquina limpa • scripts documentados no README stub
Docs: documentation/adr/ADR-001-stack-typescript-ink-mcp.md

### M1-02: Ambiente Redmine de teste (docker compose + seed) [epic]
EAT: — | Deps: — | Labels: type:chore, epic
AC: • concluída quando M1-02.1 e M1-02.2 fecharem • `docker compose up` + seed deixam instância pronta para E2E em 1 comando
DoD: • sub-issues com DoD cumprido • fluxo documentado no README
Docs: documentation/development/PLAN.md

### M1-02.1: Subir Redmine+Postgres via docker compose com healthcheck
Parent: M1-02 | EAT: 25min | Deps: — | Labels: type:chore, size:XS, sub-issue
AC: • compose sobe Redmine+Postgres com volumes e healthcheck • REST API habilitada em porta fixa documentada • `down -v && up` reproduz instância limpa • compose parametrizável (porta/env) e CI-ready — o MESMO compose será reutilizado pelo M5-05.1 (sem fork)
DoD: • script wait-for-healthy testado antes • instruções no README • sem credenciais hardcoded fora do compose de teste
Docs: documentation/development/PLAN.md

### M1-02.2: Criar seed base via REST (projeto + 3 issues simples)
Parent: M1-02 | EAT: 25min | Deps: M1-02.1 | Labels: type:chore, size:XS, sub-issue
AC: • seed cria 1 projeto e ≥ 3 issues com descrição via API REST • idempotente (re-execução não duplica) • asserções GET verificam contagens
DoD: • asserções escritas antes • logger, nunca console.log • README com `npm run seed`
Docs: documentation/development/PLAN.md

### M1-02.3: Enriquecer seed com fixtures ricas (journals, custom fields, relations, anexo)
Parent: M1-02 | EAT: 30min | Deps: M1-02.2 | Labels: type:chore, size:S, sub-issue
AC: • issues do seed ganham journals, custom fields, relations, parent/child e ≥ 1 anexo de texto • idempotência preservada • fixtures documentadas (quais issues têm o quê) para uso nos testes
DoD: • asserções GET escritas antes • reutilizável pelo CI Linux do M5 sem alteração
Docs: documentation/development/PLAN.md

### M1-03: Definir contrato do core (tipos + AsyncIterable<ProgressEvent | Result>)
EAT: 25min | Deps: M1-01 | Labels: type:feature, size:XS
AC: • tipos Issue/Journal/Attachment/CustomField {id,name,value,raw_value,field_format?} em módulo único • ProgressEvent/Result tipados; função exemplo retorna AsyncIterable • boundary: nenhuma superfície importa módulo interno (lint rule)
DoD: • testes de consumo do iterable antes • cobertura ≥ 80% • typecheck ok
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M1-04: REST client Redmine [epic]
EAT: — | Deps: M1-03 | Labels: type:feature, epic
AC: • concluída quando M1-04.1, M1-04.2 e M1-04.3 fecharem • client cobre auth, TLS, issue completa, paginação e resiliência
DoD: • sub-issues com DoD cumprido
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M1-04.1: Implementar HTTP base com auth e TLS obrigatório
Parent: M1-04 | EAT: 30min | Deps: M1-03 | Labels: type:feature, size:S, sub-issue
AC: • fetch com header X-Redmine-API-Key e fallback ?key= configurável • http:// recusado por default; --ca-file/NODE_EXTRA_CA_CERTS aceitos; --insecure só com aviso ruidoso • 401/403/404 mapeados para erros tipados
DoD: • testes (nock) antes: header, fallback, recusa http • cobertura ≥ 80% • segredos redigidos nos logs
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M1-04.2: Implementar getIssue/listIssues com paginação
Parent: M1-04 | EAT: 30min | Deps: M1-04.1 | Labels: type:feature, size:S, sub-issue
AC: • getIssue com include=journals,attachments,relations,children • listIssues pagina offset/limit até esgotar ou limite configurável • fixtures de paginação (1 página, N páginas, vazio)
DoD: • fixtures de paginação antes • cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M1-04.3: Implementar retry/backoff exponencial no client
Parent: M1-04 | EAT: 25min | Deps: M1-04.2 | Labels: type:feature, size:XS, sub-issue
AC: • retry com backoff exponencial + jitter para 429/5xx/erros de rede • sem retry em 4xx (exceto 429); máximo de tentativas configurável • fixtures de falha transiente (falha→sucesso) e falha permanente
DoD: • fixtures de falha antes • cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M1-05: Normalizar Issue/Journal/Attachment (modelo base)
EAT: 30min | Deps: M1-04.3 | Labels: type:feature, size:S
AC: • JSON bruto → modelo estável com journals contendo details[] brutos • attachments com id/filename/filesize/content_type/digest quando presente • campos ausentes viram opcionais explícitos, nunca crash
DoD: • fixtures reais do seed como testes antes • cobertura ≥ 80% • sem coerção de tipo não confirmada
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M1-06: Normalizar custom fields, relations, parent/children e watchers
EAT: 30min | Deps: M1-05 | Labels: type:feature, size:S
AC: • custom fields {id,name,value,raw_value,field_format?} — field_format só se /custom_fields.json acessível • relations com relation_type+delay; parent/children • watchers opcionais: 403 degrada com flag, sem erro
DoD: • teste de degradação 403 antes • cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md, documentation/prd/PRD-redmine-context.md

### M1-07: Implementar login interativo (usuário/senha → api_key)
EAT: 30min | Deps: M1-04.1 | Labels: type:feature, size:S
AC: • `login` pede URL/usuário/senha mascarada → Basic auth → GET /users/current.json → api_key • senha nunca persistida/logada (teste verifica) • falha Basic auth (2FA) instrui colar api_key de /my/account
DoD: • testes sucesso/401/2FA-fallback antes • cobertura ≥ 80% • redação de segredos validada
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M1-08: Credential store em arquivo 0600 + cascata de resolução
EAT: 25min | Deps: M1-07 | Labels: type:feature, size:XS
AC: • api_key em arquivo 0600 / dir 0700 (env-paths), por instância • permissões verificadas no boot com erro acionável • cascata M1: arquivo → env REDMINE_API_KEY (CI/MCP headless)
DoD: • testes de permissões e cascata antes • cobertura ≥ 80% • interface pronta para keychain M2
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M1-09: Gerar bundle JSON determinístico
EAT: 30min | Deps: M1-06 | Labels: type:feature, size:S
AC: • schema_version "1.0", source {base_url, issue_id, issue_updated_on}, tool_version • ordenação estável (journals created_on,id; attachments id); generated_at fora do corpo canônico • conteúdo derivado untrusted: true
DoD: • snapshot byte-idêntico em 2 execuções antes • cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M1-10: Gerar bundle Markdown com fences untrusted
EAT: 30min | Deps: M1-09 | Labels: type:feature, size:S
AC: • MD com descrição/journals/custom fields/relations e anexos referenciados por URL (texto-only) • conteúdo derivado em <untrusted-content> • mesma ordenação do JSON; snapshots byte-idênticos
DoD: • snapshots com fixtures das ≥ 3 issues do seed antes • cobertura ≥ 80% • formato no README
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md, documentation/prd/PRD-redmine-context.md

### M1-11: CLI `redmine-context issue <id>`
EAT: 30min | Deps: M1-08, M1-10 | Labels: type:feature, size:S
AC: • consome core via AsyncIterable; ProgressEvent em stderr; bundle (MD default, --json) em stdout ou --out • credencial pela cascata sem prompt quando logado • exit codes distintos auth/rede/issue inexistente
DoD: • testes unitários do comando (core mockado) antes; E2E real fica no M1-14 • cobertura ≥ 80% • help text limpo
Docs: documentation/prd/PRD-redmine-context.md, documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M1-12: MCP server (stdio) com tool get_issue_context
EAT: 30min | Deps: M1-11 | Labels: type:feature, size:S
AC: • `mcp` sobe server stdio via @modelcontextprotocol/sdk • get_issue_context(issue_id) read-only retorna bundle texto-only; nenhuma tool aceita URL/host arbitrário • 403/404 com erro claro sem cache indevido; credencial via cascata
DoD: • testes de handler antes • cobertura ≥ 80% • registro documentado (claude mcp add)
Docs: documentation/prd/PRD-redmine-context.md, documentation/adr/ADR-001-stack-typescript-ink-mcp.md

### M1-13: MCP tool search_issues (pós-dogfood, não bloqueia M1-14)
EAT: 30min | Deps: M1-12 | Labels: type:feature, size:S, priority:low
AC: • filtros estruturados /issues.json (project, status, assigned_to, updated_on) • query full-text /search.json best-effort com degradação • paginação com limite default documentado
DoD: • testes filtros+degradação antes • cobertura ≥ 80% • schema da tool descrito
Docs: documentation/prd/PRD-redmine-context.md

### M1-14: Validar E2E dogfood (CLI + MCP no Claude Code) e quickstart
EAT: 25min | Deps: M1-02.3, M1-12 | Labels: type:test, size:XS
AC: • Redmine seedado → `issue 1` gera bundle válido • get_issue_context via MCP = mesmo conteúdo da CLI • outcome do PRD com ≥ 3 issues reais registrado na issue • tempo issue→bundle < 30 s (texto, cache quente) medido no roteiro E2E
DoD: • roteiro E2E automatizado antes da validação manual • README quickstart • cenários de segurança (http recusado)
Docs: documentation/prd/PRD-redmine-context.md, documentation/development/PLAN.md

### M1-15: Gap Analysis M1
EAT: 30min | Deps: M1-01..M1-14 | Labels: type:chore, size:S, gap-analysis
- [ ] Documentation References: verificar docs atualizados e corretamente referenciados
- [ ] Acceptance Criteria: verificar que cada issue do milestone atende seus AC
- [ ] Definition of Done: verificar que cada issue passou seus gates de DoD
- [ ] Recommended FFT Agent: fft-qa — rodar QA automatizado contra o milestone
- [ ] Quality Seal: comparar implementado vs. planejado; o selo marca a qualidade ANTES desta análise; todos os achados DEVEM ser resolvidos dentro desta issue
DoD: • milestone só fecha com checklist completo • zero issues do M1 abertas ou sem labels
Docs: documentation/prd/PRD-redmine-context.md, documentation/adr/ADR-005-arquitetura-core-6-modulos.md

## M2 — TUI completa + keychain

### M2-01: Scaffolding da TUI (Ink + @inkjs/ui + roteador de telas)
EAT: 30min | Deps: M1-15 | Labels: type:feature, size:S
AC: • app Ink com roteador (state machine) e tela placeholder • deps Ink/@inkjs/ui/ink-task-list/figures sem dep nativa obrigatória • TUI consome core só via AsyncIterable
DoD: • teste de render (ink-testing-library) antes • cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-001-stack-typescript-ink-mcp.md

### M2-02: theme.ts central com tokens via Context
EAT: 25min | Deps: M2-01 | Labels: type:feature, size:XS
AC: • 5-6 tokens semânticos via Context • nenhuma cor hardcoded (lint/grep no CI) • componentes @inkjs/ui consomem o tema
DoD: • teste provider/consumo antes • cobertura ≥ 80% • guideline no próprio theme.ts
Docs: documentation/adr/ADR-001-stack-typescript-ink-mcp.md

### M2-03: Degradação NO_COLOR / não-TTY / CI
EAT: 30min | Deps: M2-01 | Labels: type:feature, size:S
AC: • NO_COLOR, !isTTY ou CI=true → texto puro reutilizando caminho da CLI • figures com fallback ASCII no Windows • saída não-TTY parseável (sem ANSI)
DoD: • testes das 3 condições antes • cobertura ≥ 80% • README
Docs: documentation/prd/PRD-redmine-context.md

### M2-04: Navegação global e breadcrumb
EAT: 30min | Deps: M2-01, M2-02 | Labels: type:feature, size:S
AC: • setas + j/k opcionais, Enter, Esc volta, / busca • breadcrumb fixo refletindo pilha de telas • Ctrl+C cancela operação; 2º Ctrl+C sai
DoD: • testes de keybindings antes • cobertura ≥ 80% • hook reutilizável
Docs: documentation/prd/PRD-redmine-context.md

### M2-05: Onboarding completo [epic]
EAT: — | Deps: M2-04 | Labels: type:feature, epic
AC: • concluída quando M2-05.1 e M2-05.2 fecharem • URL → auth → sucesso sem config manual
DoD: • sub-issues com DoD cumprido
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M2-05.1: Telas URL → modo auth → login mascarado
Parent: M2-05 | EAT: 30min | Deps: M2-04 | Labels: type:feature, size:S, sub-issue
AC: • URL valida https:// (http recusado com mensagem acionável) • Select para modo (login vs. colar api_key) • senha mascarada, nunca ecoada/logada
DoD: • testes render+validação antes • cobertura ≥ 80% • reusa login do core (zero lógica de auth na TUI)
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M2-05.2: Validação, estados sucesso/erro e fallback 2FA
Parent: M2-05 | EAT: 30min | Deps: M2-05.1 | Labels: type:feature, size:S, sub-issue
AC: • Spinner durante validação; sucesso com splash (gradiente/big-text SÓ aqui) • erro Basic auth (2FA/SSO) → tela de colar api_key • erro rede/TLS com próxima ação (--ca-file)
DoD: • testes de cada estado antes • cobertura ≥ 80% • persistência via cascata do core
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M2-06: Tela home (minhas issues) com estados
EAT: 30min | Deps: M2-04, M2-05.2 | Labels: type:feature, size:S
AC: • lista assigned_to=me via core, seleção por teclado • estados loading/vazio/erro/403 distintos • Enter abre detalhe
DoD: • testes dos 4 estados antes • cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/prd/PRD-redmine-context.md

### M2-07: Busca e filtros na home
EAT: 30min | Deps: M2-06 | Labels: type:feature, size:S
AC: • / abre busca via search_issues (estruturado + full-text best-effort) • filtros rápidos status/projeto • limpar busca restaura sem refetch desnecessário
DoD: • testes busca/filtro/degradação antes • cobertura ≥ 80% • debounce documentado
Docs: documentation/prd/PRD-redmine-context.md

### M2-08: Tela de detalhe da issue (descrição + journals roláveis)
EAT: 30min | Deps: M2-06 | Labels: type:feature, size:S
AC: • viewport rolável (j/k/setas/PgUp-PgDn) sem quebrar layout • metadados no topo • Esc volta preservando posição da lista
DoD: • testes de scroll e journals longos antes • cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/prd/PRD-redmine-context.md, documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M2-09: Anexos no detalhe com status de extração
EAT: 20min | Deps: M2-08 | Labels: type:feature, size:XS
AC: • anexos com nome/tamanho/tipo e Badge de status (text/pending/unsupported no M2) • navegação nunca bloqueia • layout pronto para processing/done/failed do M3/M4
DoD: • testes de render por status antes • cobertura ≥ 80% • status vindos do contrato do core
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M2-10: Tela de exportação do bundle
EAT: 30min | Deps: M2-08 | Labels: type:feature, size:S
AC: • exporta MD e/ou JSON com destino (default cwd) • ProgressBar; sucesso mostra caminho absoluto • erro de escrita com ação corretiva
DoD: • testes fluxo+erro antes • cobertura ≥ 80% • reusa gerador do core
Docs: documentation/prd/PRD-redmine-context.md, documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M2-11: Painel de jobs
EAT: 25min | Deps: M2-10 | Labels: type:feature, size:XS
AC: • lista operações consumindo ProgressEvent via ink-task-list • estados com ícones (fallback ASCII) • Ctrl+C cancela job selecionado sem sair
DoD: • testes de transição antes • cobertura ≥ 80% • pronto para jobs M3/M4 sem refactor
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M2-12: Telas doctor e config/logout
EAT: 30min | Deps: M2-04 | Labels: type:feature, size:S
AC: • doctor: Node, instância, método de credencial, conectividade • config: instância/limites + logout (limpa cascata inteira) • logout retorna ao onboarding
DoD: • testes doctor/logout antes • cobertura ≥ 80% • sem vazamento de segredos
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md, documentation/prd/PRD-redmine-context.md

### M2-13: Sessão expirada (401 → re-login)
EAT: 25min | Deps: M2-05.2, M2-06 | Labels: type:feature, size:XS
AC: • 401 em qualquer tela → re-login preservando origem • operação original retomada após sucesso • credencial antiga substituída
DoD: • teste interceptação 401 + retomada antes • cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M2-14: Keychain nativo (@napi-rs/keyring)
EAT: 30min | Deps: M1-08 | Labels: type:feature, size:S
AC: • set/get/delete atrás da interface do M1 • prebuilds via optionalDependencies (4 plataformas); node-gyp nunca aciona • ausência de prebuild (musl) detectada sem crash
DoD: • testes com mock do keyring antes • cobertura ≥ 80% • package.json validado
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M2-15: Cascata completa de credencial + migração para keychain
EAT: 25min | Deps: M2-14 | Labels: type:feature, size:XS
AC: • keychain → arquivo 0600 → env (ordem ADR-003) • primeira execução com keychain migra do arquivo e o remove • falha do keychain degrada com aviso único
DoD: • testes cascata+migração antes • cobertura ≥ 80% • README/doctor refletem método em uso
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M2-16: Layout responsivo em 80 e 60 colunas
EAT: 25min | Deps: M2-06, M2-08 | Labels: type:refactor, size:XS
AC: • snapshots de render em 80 e 60 colunas sem overflow de linha (asserção de largura máxima) • truncamento com reticências verificado por asserção em strings longas • redimensionamento em runtime re-renderiza sem crash nem sobreposição
DoD: • testes de render 60/80 antes • cobertura ≥ 80% nos componentes • avaliação estética subjetiva fica no Quality Seal do M2-17
Docs: documentation/prd/PRD-redmine-context.md

### M2-17: Gap Analysis M2
EAT: 30min | Deps: M2-01..M2-16 | Labels: type:chore, size:S, gap-analysis
- [ ] Documentation References: verificar docs atualizados e corretamente referenciados
- [ ] Acceptance Criteria: verificar que cada issue do milestone atende seus AC
- [ ] Definition of Done: verificar que cada issue passou seus gates de DoD
- [ ] Recommended FFT Agent: fft-qa — rodar QA automatizado contra o milestone
- [ ] Quality Seal: comparar implementado vs. planejado; o selo marca a qualidade ANTES desta análise; todos os achados DEVEM ser resolvidos dentro desta issue
DoD: • outcome do PRD M2 validado ponta a ponta (login→navegar→exportar; NO_COLOR; 80/60 col) • zero issues do M2 abertas ou sem labels
Docs: documentation/prd/PRD-redmine-context.md, documentation/adr/ADR-003-auth-login-apikey-keychain.md

## M3 — Anexos + imagens/OCR

### M3-01: Contrato do módulo Cache (get/put/invalidate/lock/gc)
EAT: 20min | Deps: M1 | Labels: type:feature, size:XS
AC: • interface tipada get/put/invalidate + lock por chave + hook GC • chaves attachment-level (instance_hash, attachment_id, digest, extractor_version+model+params) e issue-level (issue_id, updated_on) do ADR-004 • implementação em memória passa suíte de contrato
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok • logger, nunca console.*
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M3-02: instance_hash e layout de diretórios (env-paths)
EAT: 25min | Deps: M3-01 | Labels: type:feature, size:XS
AC: • SHA-256 truncado da URL normalizada; testes de normalização (trailing slash, case, porta default) • layout `<cache_dir>/<instance_hash>/attachments/<id>-<digest8>/` sob demanda • cache_dir por SO via env-paths com override
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M3-03: Chave attachment-level com fallback de digest
EAT: 25min | Deps: M3-02 | Labels: type:feature, size:XS
AC: • chave inclui extractor_version+model+params; qualquer componente alterado → chave distinta • fallback (id, filesize, created_on) para Redmine < 4.x • novo updated_on da issue NÃO altera chave attachment-level (teste)
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M3-04: Lock por chave do cache
EAT: 25min | Deps: M3-02 | Labels: type:feature, size:XS
AC: • concorrência na mesma chave: um extrai, outro aguarda e reutiliza (teste) • lock liberado em erro; stale lock expira por TTL pós-crash • chaves diferentes não se bloqueiam
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M3-05: GC do cache com LRU e limite 2 GB [epic]
EAT: — | Deps: M3-02 | Labels: type:feature, epic
AC: • cache nunca ultrapassa limite (default 2 GB) após GC • originais removidos antes de extrações (quotas separadas)
DoD: • sub-issues com gates cumpridos
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M3-05.1: Índice JSON por instância com last_accessed_at
Parent: M3-05 | EAT: 25min | Deps: M3-02 | Labels: type:feature, size:XS, sub-issue
AC: • index.json com tamanho, tipo (original/extração), last_accessed_at • get/put atualizam atomicamente (temp + rename) • índice corrompido reconstruído do disco sem crash
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M3-05.2: Política LRU com quotas separadas + remoção segura
Parent: M3-05 | EAT: 25min | Deps: M3-05.1 | Labels: type:feature, size:XS, sub-issue
AC: • LRU por last_accessed_at; quota agressiva originais / conservadora extrações • remoção só dentro de `<cache_dir>/<instance_hash>/` (guard testado) • índice consistente pós-GC
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M3-06: Download de anexo com nome derivado de id+digest
EAT: 25min | Deps: M3-03, M3-04 | Labels: type:feature, size:XS
AC: • salvo como `<id>-<digest8>/original.<ext>`; filename do Redmine NUNCA no path • teste anti path-traversal (filename `../../../evil.sh`) • download autenticado reusa REST client; .part + rename
DoD: • TDD, cobertura ≥ 80% • cenário de segurança documentado no teste
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M3-07: Limite de anexo (100 MB) com pular-com-aviso
EAT: 25min | Deps: M3-06 | Labels: type:feature, size:XS
AC: • Content-Length > limite → nem inicia • stream que excede → abortado e parcial removido • pulado aparece no bundle com metadados+motivo; limite em config
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M3-08: Dispatcher de extratores por magic bytes
EAT: 25min | Deps: M3-06 | Labels: type:feature, size:XS
AC: • MIME real por magic bytes (nunca extensão/Content-Type) • mismatch logado; magic byte vence • tipo sem extrator → status unsupported + metadados, sem erro fatal
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M3-09: Extrator tesseract (execFile, por+eng)
EAT: 30min | Deps: M3-08 | Labels: type:feature, size:S
AC: • execFile sem shell, timeout e kill • por+eng default, configurável • fixture conhecida → texto esperado em ExtractionResult; extractor_version+params na chave de cache
DoD: • TDD com fixture determinística, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M3-10: Degradação graciosa + untrusted do OCR no bundle
EAT: 25min | Deps: M3-09 | Labels: type:feature, size:XS
AC: • tesseract ausente → bundle sai com aviso + instrução (teste com PATH vazio) • OCR em <untrusted-content> / untrusted: true • falha em um anexo não impede os demais nem o bundle
DoD: • TDD, cobertura ≥ 80% • snapshot do bundle atualizado
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M3-11: doctor — detecção do tesseract e instruções por SO
EAT: 25min | Deps: M3-09 | Labels: type:feature, size:XS
AC: • detecta PATH + locais convencionais (incl. C:\Program Files\Tesseract-OCR) • instrução por SO (brew/apt/winget) quando ausente; exit 0/1 • degrada em não-TTY/NO_COLOR
DoD: • TDD, cobertura ≥ 80% • referenciado nos docs de instalação (M5)
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M3-12: Integração — comentário novo não reprocessa extração
EAT: 25min | Deps: M3-10 | Labels: type:test, size:XS
AC: • novo journal → bundle regenerado reutilizando extraction.json, extrator NÃO invocado (spy) • mesmo attachment_id em 2 instâncias não colide • troca de extractor_version reprocessa
DoD: • teste verde e determinístico no CI • typecheck/lint ok
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M3-13: MCP tool get_attachment_text
EAT: 25min | Deps: M3-10 | Labels: type:feature, size:XS
AC: • tool read-only get_attachment_text(attachment_id) retorna texto extraído do cache (OCR no M3; áudio/vídeo passam a funcionar automaticamente no M4 via mesmo caminho) • anexo não processado → status/motivo (pending/unsupported/failed), nunca erro genérico • 403/404 do Redmine propagados com clareza; texto marcado untrusted
DoD: • testes de handler (cache hit, pending, 403) antes • cobertura ≥ 80% • schema da tool descrito
Docs: documentation/prd/PRD-redmine-context.md, documentation/adr/ADR-004-cache-duas-camadas.md

### M3-14: Gap Analysis M3
EAT: 30min | Deps: M3-01..M3-13 | Labels: type:chore, size:S, gap-analysis
- [ ] Documentation References: verificar docs atualizados e corretamente referenciados
- [ ] Acceptance Criteria: verificar que cada issue do milestone atende seus AC
- [ ] Definition of Done: verificar que cada issue passou seus gates de DoD
- [ ] Recommended FFT Agent: fft-qa — rodar QA automatizado contra o milestone
- [ ] Quality Seal: comparar implementado vs. planejado; o selo marca a qualidade ANTES desta análise; todos os achados DEVEM ser resolvidos dentro desta issue
DoD: • milestone fechável sem pendências • relatório de QA anexado
Docs: documentation/prd/PRD-redmine-context.md

## M4 — Áudio e vídeo

### M4-01: Estender doctor — ffmpeg e whisper.cpp
EAT: 20min | Deps: M3-11 | Labels: type:feature, size:XS
AC: • detecta ffmpeg/whisper.cpp com versão • ausente → instrução por SO + menção ao opt-in --download-binaries onde elegível • status do modelo GGUF no relatório
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M4-02: Download GGUF com SHA-256 pinado e URL oficial fixa
EAT: 25min | Deps: M1 | Labels: type:feature, size:XS
AC: • URL de release + SHA-256 pinados no código (constantes) • só HTTPS; checksum divergente → descarta com erro claro (fixture corrompida) • nunca em MCP headless (guard testado)
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M4-03: Retomada HTTP Range + .part/rename atômico no GGUF
EAT: 25min | Deps: M4-02 | Labels: type:feature, size:XS
AC: • retoma do byte correto via Range (servidor mock) • .part; rename SÓ após checksum válido • destino no cache por SO via env-paths
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M4-04: Áudio → WAV 16 kHz via ffmpeg com -protocol_whitelist file
EAT: 25min | Deps: M4-01, M3-08 | Labels: type:feature, size:XS
AC: • execFile sempre com -protocol_whitelist file (asserção nos args) • fixture → WAV 16 kHz mono em dir temp do cache • falha → status failed + motivo, sem quebrar bundle
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M4-05: Extrator whisper.cpp — execFile e parse para ExtractionResult
EAT: 25min | Deps: M4-02, M4-04 | Labels: type:feature, size:XS
AC: • execFile sem shell com modelo GGUF do cache • saída parseada em {text, confidence, status} • fixture curta → transcrição confere; texto untrusted no bundle
DoD: • TDD com fixture determinística, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M4-06: Idioma auto-detect com override; modelo/params na chave de cache
EAT: 20min | Deps: M4-05, M3-03 | Labels: type:feature, size:XS
AC: • default auto-detect; language: pt força idioma (asserção nos args) • trocar modelo/idioma → chave attachment-level distinta • modelo/params em extraction.json
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M4-07: Vídeo — extração da faixa de áudio via ffmpeg
EAT: 25min | Deps: M4-04 | Labels: type:feature, size:XS
AC: • fixture de vídeo → WAV 16 kHz pronto para whisper • pipeline vídeo→áudio→transcrição em um job com -protocol_whitelist file • vídeo sem áudio → status com motivo, sem crash
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M4-08: Keyframe representativo (1 frame) com referência no bundle
EAT: 25min | Deps: M4-07 | Labels: type:feature, size:XS
AC: • 1 keyframe salvo no dir do attachment • bundle referencia keyframe (cache path + URL Redmine); MCP nunca embute binário • falha no frame não afeta transcrição
DoD: • TDD, cobertura ≥ 80% • snapshot do bundle atualizado
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M4-09: Limite 20 min de vídeo (ffprobe) com pular-com-aviso
EAT: 25min | Deps: M4-07 | Labels: type:feature, size:XS
AC: • duração via ffprobe antes de processar; > limite → transcrição pulada com aviso+metadados • limite configurável respeitado em teste • keyframe extraído mesmo com transcrição pulada
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M4-10: Fila de jobs de extração [epic]
EAT: — | Deps: M3-08 | Labels: type:feature, epic
AC: • extrações longas não bloqueiam TUI/CLI/MCP • estados pending/processing/done/failed observáveis pelo contrato de progresso
DoD: • sub-issues com gates cumpridos
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M4-10.1: Núcleo da fila — concorrência núcleos−1 e estados
Parent: M4-10 | EAT: 30min | Deps: M3-08 | Labels: type:feature, size:S, sub-issue
AC: • máx os.cpus().length−1 simultâneos (jobs fake) • transições corretas e observáveis • job falho não derruba a fila
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M4-10.2: Timeout + kill de subprocesso e env sanitizado
Parent: M4-10 | EAT: 25min | Deps: M4-10.1 | Labels: type:feature, size:XS, sub-issue
AC: • timeout → SIGKILL após grace, status failed + motivo • env de ffmpeg/whisper/tesseract SEM api_key/segredos (asserção no spawn) • sem zumbis pós-timeout (teste)
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M4-10.3: Cancelamento via AbortSignal + eventos no AsyncIterable
Parent: M4-10 | EAT: 25min | Deps: M4-10.1 | Labels: type:feature, size:XS, sub-issue
AC: • cancelamento propaga AbortSignal, mata subprocesso, marca cancelado • ProgressEvent por transição no AsyncIterable • TUI/CLI consomem sem código específico da fila
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M4-11: MCP cache-first — resposta imediata com status processing
EAT: 25min | Deps: M4-10, M3-12 | Labels: type:feature, size:XS
AC: • get_issue_context E get_attachment_text retornam texto+extrações prontas imediatamente • anexos pesados com status processing + metadados • nenhuma chamada MCP bloqueia aguardando mídia: resposta < 5 s mesmo com vídeo pendente (asserção com timer)
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M4-12: Continuação em background — 2ª chamada retorna completo
EAT: 25min | Deps: M4-11 | Labels: type:feature, size:XS
AC: • processing dispara/mantém job em background no processo MCP • chamada pós-conclusão retorna do cache sem reprocessar • falha → failed + motivo, nunca processing eterno
DoD: • TDD, cobertura ≥ 80% • typecheck/lint ok
Docs: documentation/adr/ADR-005-arquitetura-core-6-modulos.md

### M4-13: Integração — comentário novo não reprocessa vídeo
EAT: 25min | Deps: M4-12 | Labels: type:test, size:XS
AC: • vídeo transcrito 1x; novo journal → whisper/ffmpeg NÃO invocados (spies) • troca de modelo GGUF reprocessa • roda no CI com fixtures locais
DoD: • teste verde e determinístico no CI • typecheck/lint ok
Docs: documentation/adr/ADR-004-cache-duas-camadas.md

### M4-14: Gap Analysis M4
EAT: 30min | Deps: M4-01..M4-13 | Labels: type:chore, size:S, gap-analysis
- [ ] Documentation References: verificar docs atualizados e corretamente referenciados
- [ ] Acceptance Criteria: verificar que cada issue do milestone atende seus AC
- [ ] Definition of Done: verificar que cada issue passou seus gates de DoD
- [ ] Recommended FFT Agent: fft-qa — rodar QA automatizado contra o milestone
- [ ] Quality Seal: comparar implementado vs. planejado; o selo marca a qualidade ANTES desta análise; todos os achados DEVEM ser resolvidos dentro desta issue
DoD: • milestone fechável sem pendências • relatório de QA anexado
Docs: documentation/prd/PRD-redmine-context.md

## M5 — Distribuição multi-OS

### M5-01: Prebuilds do keyring via optionalDependencies
EAT: 25min | Deps: M2 | Labels: type:chore, size:XS
AC: • optionalDependencies para darwin-arm64/x64, linux-x64-gnu, win32-x64-msvc • musl/sem prebuild → fallback arquivo 0600 sem erro de instalação • nunca aciona node-gyp
DoD: • TDD (resolução do fallback), cobertura ≥ 80% no módulo de credenciais • fallback documentado
Docs: documentation/adr/ADR-003-auth-login-apikey-keychain.md

### M5-02: Teste de instalação limpa sem toolchain
EAT: 25min | Deps: M5-01 | Labels: type:test, size:XS
AC: • instala em env SEM compilador e roda --help • install nunca invoca node-gyp (asserção no log) • falha bloqueia release
DoD: • teste verde no CI • typecheck/lint ok
Docs: documentation/development/PLAN.md

### M5-03: Empacotamento npm/npx (bin, files, exports, engines)
EAT: 25min | Deps: M1 | Labels: type:chore, size:XS
AC: • bin expõe redmine-context; npx do tarball (npm pack) funciona • files/exports sem vazamento de testes/fixtures; engines node ≥ 20 • sem binários de mídia embutidos (OUT do PRD)
DoD: • smoke script (TDD) • docs de uso atualizados
Docs: documentation/prd/PRD-redmine-context.md

### M5-04: CI base — matriz 3 SOs (typecheck/lint/unit)
EAT: 25min | Deps: M5-03 | Labels: type:chore, size:XS
AC: • Actions com ubuntu/macos/windows rodando typecheck+lint+unit • cache de deps por SO; falha bloqueia merge • status obrigatório no PR
DoD: • CI verde nos 3 SOs • typecheck/lint ok
Docs: documentation/development/PLAN.md

### M5-05: CI Linux — E2E real contra Redmine [epic]
EAT: — | Deps: M5-04 | Labels: type:test, epic
AC: • E2E Linux valida CLI e MCP contra Redmine real seedado no CI
DoD: • sub-issues com gates cumpridos
Docs: documentation/development/PLAN.md

### M5-05.1: docker compose Redmine+Postgres com seed via REST (CI)
Parent: M5-05 | EAT: 30min | Deps: M5-04 | Labels: type:test, size:S, sub-issue
AC: • compose com healthcheck no CI • seed cria projeto+issues com journals/anexos via REST (reusa scripts do M1-02) • idempotente
DoD: • testado local e no CI • sem segredos hardcoded
Docs: documentation/development/PLAN.md

### M5-05.2: Job E2E — CLI e MCP contra Redmine seedado
Parent: M5-05 | EAT: 25min | Deps: M5-05.1 | Labels: type:test, size:XS, sub-issue
AC: • job ubuntu roda `issue <id>` e valida bundle contra o seed • tool MCP validada no mesmo job (cliente stdio de teste) • cenários de segurança: http recusado, anexo > limite pulado
DoD: • E2E verde no CI • typecheck/lint ok
Docs: documentation/development/PLAN.md

### M5-06: Fixtures nock gravadas com replay em macOS/Windows
EAT: 25min | Deps: M5-05 | Labels: type:test, size:XS
AC: • fixtures gravadas do Redmine seedado, versionadas com segredos redigidos • replay offline passa em macOS e Windows no CI • script de regravação documentado
DoD: • CI verde nos 2 SOs • typecheck/lint ok
Docs: documentation/development/PLAN.md

### M5-07: Smoke npx (--help, doctor) em macOS/Windows
EAT: 20min | Deps: M5-03, M5-04 | Labels: type:test, size:XS
AC: • empacota (npm pack) e roda npx do tarball: --help e doctor com exit codes corretos • doctor degrada com instruções corretas nos runners • falha bloqueia release
DoD: • CI verde • typecheck/lint ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M5-08: Hardening Windows — execFile sem shell e paths portáveis
EAT: 25min | Deps: M4 | Labels: type:refactor, size:XS
AC: • auditoria: todo spawn via execFile sem shell:true (lint rule/varredura) • nenhum path POSIX hardcoded; path.join/env-paths em todo acesso a disco • suíte cache/config passa no runner Windows
DoD: • TDD, cobertura ≥ 80% nos módulos tocados • typecheck/lint ok
Docs: documentation/development/PLAN.md

### M5-09: Hardening Windows — terminal legado (ASCII, NO_COLOR)
EAT: 20min | Deps: M2 | Labels: type:bug, size:XS
AC: • figures com fallback ASCII em cmd.exe/PowerShell legado (sem mojibake) • NO_COLOR/não-TTY → texto puro no runner Windows • smoke TUI 80 col no Windows Terminal sem quebra
DoD: • teste no CI Windows verde • typecheck/lint ok
Docs: documentation/development/PLAN.md

### M5-10: Changesets — versionamento e release npm
EAT: 25min | Deps: M5-04 | Labels: type:chore, size:XS
AC: • @changesets/cli; PR sem changeset relevante falha no check • release publica no npm com provenance após CI verde na matriz • CHANGELOG automático
DoD: • dry-run de release verde • fluxo documentado
Docs: documentation/development/PLAN.md

### M5-11: Docs de instalação por SO + registro MCP
EAT: 30min | Deps: M5-07, M3-11 | Labels: type:docs, size:S
AC: • guia por SO: npx, brew/apt/winget (incl. UB-Mannheim.TesseractOCR), --download-binaries, troubleshooting via doctor • registro MCP verificado: `claude mcp add redmine-context -- npx -y redmine-context mcp` • limitação musl/fallback documentada
DoD: • comandos validados nos 3 SOs (CI/smoke) • lint de markdown ok
Docs: documentation/adr/ADR-002-midia-100-local-politica-binarios.md

### M5-12: Gap Analysis M5
EAT: 30min | Deps: M5-01..M5-11 | Labels: type:chore, size:S, gap-analysis
- [ ] Documentation References: verificar docs atualizados e corretamente referenciados
- [ ] Acceptance Criteria: verificar que cada issue do milestone atende seus AC
- [ ] Definition of Done: verificar que cada issue passou seus gates de DoD
- [ ] Recommended FFT Agent: fft-qa — rodar QA automatizado contra o milestone
- [ ] Quality Seal: comparar implementado vs. planejado; o selo marca a qualidade ANTES desta análise; todos os achados DEVEM ser resolvidos dentro desta issue
DoD: • milestone fechável sem pendências • relatório de QA anexado
Docs: documentation/prd/PRD-redmine-context.md

---

## Pós-aprovação (execução deste plano)

1. Persistir este breakdown em `documentation/development/BACKLOG.md` (fonte para o /plan:publish).
2. Atualizar `documentation/development/PLAN.md` (estágio: breakdown ✅ → próximo /plan:publish) e memória do projeto.

## Verificação

- Todos os 87 itens têm EAT ≤ 30min (epics são contêineres sem EAT próprio).
- Toda sub-issue tem `Parent:` + label `sub-issue` (15 no total: M1-02.1–.3, M1-04.1–.3, M2-05.x, M3-05.x, M4-10.x, M5-05.x).
- Última issue de cada milestone é o Gap Analysis com o checklist obrigatório (5 no total: M1-15, M2-17, M3-14, M4-14, M5-12).
- Todo item tem Docs path apontando para ADR/PRD/PLAN existentes.
- Todas as tools MCP do escopo IN do PRD cobertas: get_issue_context (M1-12), search_issues (M1-13), get_attachment_text (M3-13, estendida em M4-11).
- Métricas do PRD com gate: < 30 s texto (M1-14), resposta MCP < 5 s com mídia pendente (M4-11).
