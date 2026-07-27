# redmine-context

Consumidor de Redmine que entrega contexto completo de issues — texto e mídia (áudio/vídeo/imagem) extraída **100% localmente** — para qualquer LLM, via MCP server, CLI e TUI.

> Planejamento: `documentation/development/PLAN.md` · Backlog: `documentation/development/BACKLOG.md` · Decisões: `documentation/adr/`

## Requisitos

- Node.js ≥ 20

## Instalação

O pacote é publicado no npm e roda direto via `npx`, sem toolchain de compilação:

```bash
# uso pontual (sempre a última versão), sem instalar nada global:
npx redmine-context --help
npx redmine-context issue 42 --url https://redmine.example

# ou instale o comando globalmente:
npm install -g redmine-context
redmine-context --version
```

> Os binários de mídia (`tesseract`, `ffmpeg`, `whisper.cpp`, `pdftotext`) **não**
> são embutidos no pacote npm (ADR-002): são opcionais e instalados pelo próprio
> usuário quando quiser OCR/transcrição/PDF (ver [Binários de mídia](#binários-de-mídia-opcionais-100-local)).
> Rode `redmine-context doctor` para o diagnóstico. Sem eles, o bundle de texto é
> gerado normalmente.

### Binários de mídia (opcionais, 100% local)

A extração de texto de anexos roda **100% na sua máquina**
([ADR-002](documentation/adr/ADR-002-midia-100-local-politica-binarios.md)), por
binários externos que **não** acompanham o pacote npm. Todos são **opcionais**:
sem eles o bundle de texto sai normalmente (degradação graciosa) — apenas o texto
daquela mídia fica ausente, com o motivo registrado no anexo. O
[`doctor`](#troubleshooting-com-redmine-context-doctor) diz quais faltam e como
instalar no seu SO.

| Binário | Para quê | macOS (Homebrew) | Linux (apt / dnf) | Windows (winget) |
|---|---|---|---|---|
| `tesseract` | OCR de imagens (PNG/JPEG/GIF/WebP) | `brew install tesseract tesseract-lang` | `sudo apt install tesseract-ocr` · `sudo dnf install tesseract` | `winget install UB-Mannheim.TesseractOCR` |
| `pdftotext` (poppler) | Texto de anexos PDF | `brew install poppler` | `sudo apt install poppler-utils` · `sudo dnf install poppler-utils` | `winget install oschwartz10612.Poppler` (ou `choco install poppler`) |
| `ffmpeg` | Áudio/vídeo → faixa de áudio | `brew install ffmpeg` | `sudo apt install ffmpeg` · `sudo dnf install ffmpeg` | `winget install Gyan.FFmpeg` |
| `whisper.cpp` | Transcrição de áudio | `brew install whisper-cpp` | `brew install whisper-cpp` (ou compile) | baixe as [releases](https://github.com/ggml-org/whisper.cpp/releases) |

> Estes comandos são exatamente os que o `redmine-context doctor` sugere quando o
> binário está ausente. No Windows, o `tesseract` também pode ser instalado
> manualmente em `C:\Program Files\Tesseract-OCR`; o `tesseract-lang` (macOS) traz
> o traineddata `por` — o OCR usa `por+eng` por padrão.

#### Modelo do whisper.cpp (GGUF)

Além do binário, a transcrição precisa de um **modelo GGUF** (ex.: `ggml-base`) no
cache de modelos do usuário (via [`env-paths`](https://github.com/sindresorhus/env-paths),
por SO):

- **macOS**: `~/Library/Caches/redmine-context/models`
- **Linux**: `~/.cache/redmine-context/models` (respeita `$XDG_CACHE_HOME`)
- **Windows**: `%LOCALAPPDATA%\redmine-context\Cache\models`

O `doctor` reporta o status do modelo junto com os binários.

#### Download automático opt-in (`--download-binaries`) — planejado (#58)

> ⚠️ **Ainda não implementado.** O flag `--download-binaries` está **planejado**
> ([issue #58](https://github.com/vdeserto/redmine-context/issues/58)); por ora,
> instale os binários pelo gerenciador do seu SO (tabela acima) — o `doctor`
> aponta a instrução correta. Esta seção descreve o comportamento **futuro**.

Onde existe **artefato estático oficial**, o opt-in `--download-binaries` **poderá**
obter o binário/modelo automaticamente (explícito e ruidoso; **nunca** no MCP
headless): **ffmpeg** ([builds BtbN](https://github.com/BtbN/FFmpeg-Builds)),
**whisper.cpp** ([releases](https://github.com/ggml-org/whisper.cpp/releases)) e o
**modelo GGUF**. O **tesseract** não tem artefato estático oficial — instale-o
pelo gerenciador do seu SO (tabela acima). Cada download terá SHA-256 pinado, URL
fixa e escrita atômica
([ADR-002](documentation/adr/ADR-002-midia-100-local-politica-binarios.md)).

### Troubleshooting com `redmine-context doctor`

`redmine-context doctor` é a ferramenta central de diagnóstico do ambiente de
mídia. Ele localiza cada binário no `PATH` e em locais convencionais, lê a versão
quando disponível e, para o que estiver ausente, imprime a instrução de instalação
**do seu SO**:

```bash
redmine-context doctor
```

Saída (exemplo, macOS com o ffmpeg e o modelo faltando):

```text
Binários de mídia:
  [ok] tesseract v5.5.0 (/opt/homebrew/bin/tesseract)
  [ok] pdftotext v24.02.0 (/opt/homebrew/bin/pdftotext)
  [faltando] ffmpeg — instale com: brew install ffmpeg (ou, no futuro, o opt-in `--download-binaries`; builds estáticos BtbN (github.com/BtbN/FFmpeg-Builds))
  [faltando] whisper.cpp — instale com: brew install whisper-cpp (ou, no futuro, o opt-in `--download-binaries`; releases em github.com/ggml-org/whisper.cpp/releases)
  [faltando] modelo whisper (GGUF) — instale com: baixe um modelo GGUF (ex.: ggml-base) para ~/Library/Caches/redmine-context/models (ou, no futuro, o opt-in `--download-binaries`, via #58)
```

- **Exit code**: `0` se todos os itens presentes, `1` se faltar algum — programável
  em scripts/CI.
- **Ordem do relatório**: `tesseract`, `pdftotext`, `ffmpeg`, `whisper.cpp`,
  `modelo whisper (GGUF)`.
- Degrada em `NO_COLOR`/saída não-TTY (texto puro, sem ANSI).

### Keychain do sistema: prebuilds e fallback

O keychain nativo (`@napi-rs/keyring`) é distribuído como **binários pré-compilados
por plataforma**, publicados como `optionalDependencies`. Na instalação, o npm baixa
apenas o prebuild da sua plataforma — **`node-gyp` nunca é acionado**, então não há
toolchain de compilação (C/C++/Python) envolvida. As plataformas com prebuild
declarado são `darwin-arm64`, `darwin-x64`, `linux-x64-gnu` e `win32-x64-msvc`.

Em uma plataforma **sem prebuild** (por exemplo, Linux **musl**/Alpine, ou uma
arquitetura exótica), o pacote opcional correspondente simplesmente **falha em
silêncio** e o npm o ignora — a instalação continua verde, **sem erro e sem
compilar nada**. Em tempo de execução, o módulo de credenciais detecta a ausência
do binário (o import dinâmico falha de forma controlada), emite **um único aviso**
e **degrada para o arquivo `0600`** da cascata do ADR-003 (keychain → arquivo →
`REDMINE_API_KEY`). O login e o boot nunca são interrompidos por falta de keychain.

## Quickstart

Do login ao contexto da issue no seu LLM, em três passos:

```bash
# 1) login — autentica e grava a api_key da instância na cascata de credenciais:
#    keychain do sistema (preferido) → arquivo 0600 → REDMINE_API_KEY (env).
#    Credenciais antigas em arquivo migram para o keychain automaticamente.
#    (senha ou, em contas com 2FA, cole a api_key quando solicitado).
#    Também SALVA a instância como default: depois do login, o --url/REDMINE_URL
#    passam a ser opcionais na CLI e na TUI (precedência: --url → REDMINE_URL → salva).
redmine-context login --url https://redmine.example

# 2) issue — imprime o bundle Markdown completo da issue em stdout
#    (descrição + histórico + custom fields + anexos + relações + pai/filhos).
redmine-context issue 42            # usa a instância salva no login (ou --url/REDMINE_URL)
#    --json grava/emite o bundle JSON canônico; --out <dir> grava em arquivo.
#    --extract liga o OCR dos anexos de imagem e embute o texto no bundle
#    (requer tesseract; ver Extração de mídia abaixo).

# 3) mcp add — registra o MCP server no seu cliente (ex.: Claude) para expor as
#    tools read-only get_issue_context, search_issues e get_attachment_text,
#    usando a mesma credencial da cascata.
claude mcp add redmine-context \
  --env REDMINE_URL=https://redmine.example \
  -- npx -y redmine-context mcp
```

Para o ambiente Docker local (http), passe `--insecure` na CLI e
`REDMINE_INSECURE=1` no ambiente do MCP server (TLS é obrigatório por padrão;
ver [Ambiente de teste](#ambiente-de-teste) e [E2E](#e2e-dogfood-cli--mcp)).

## Scripts

| Script | O que faz |
|---|---|
| `npm run typecheck` | Checagem de tipos (tsc, strict) |
| `npm run lint` | ESLint (typescript-eslint) |
| `npm test` | Vitest com cobertura (threshold 80%) |
| `npm run build` | Compila para `dist/` |
| `npm run seed` | Popula fixtures base no Redmine via REST (ver [Seed](#seed-de-fixtures)) |
| `npm run e2e` | Roteiro E2E de dogfood (CLI + MCP) contra o Docker (ver [E2E](#e2e-dogfood-cli--mcp)) |
| `npm run ci:e2e:up` | Sobe + espera healthy/one-shots + seed em 1 comando, p/ o CI (ver [CI](#subir-e-seedar-em-1-comando-ci)) |
| `npm run record:fixtures` | Grava fixtures HTTP p/ o replay offline (ver [Replay offline](#replay-offline-via-fixtures-gravadas-macoswindows)) |
| `npm run changeset` | Cria um changeset (bump + nota de CHANGELOG) — ver [Release](#release-changesets) |
| `npm run version` | `changeset version` — aplica bumps e escreve o `CHANGELOG.md` |
| `npm run release` | `changeset publish` — publica no npm (usado só pela workflow de release) |

## Release (Changesets)

Versionamento e publicação npm via [`@changesets/cli`](https://github.com/changesets/changesets).

- **Crie um changeset em todo PR de código:** `npm run changeset` (escolha `patch`/`minor`/`major` + a nota). Commite o `.changeset/<slug>.md` junto.
- **Gate de CI:** `changeset-check.yml` roda `changeset status --since=origin/main` no PR e **reprova** código sem changeset (docs/CI ficam isentos).
- **Release automático:** `release.yml` (push em `main`, após gates verdes) usa `changesets/action` para abrir o PR **"Version Packages"** (bump + CHANGELOG) e, ao mergeá-lo, roda `npm publish` com **provenance** (`NPM_CONFIG_PROVENANCE` + OIDC `id-token: write`).
- **Guardado por `NPM_TOKEN`:** o publish só roda com o segredo presente — sem ele o workflow fica inerte (nada é publicado).
- **Dry-run (não publica):** `npm publish --dry-run` simula o empacotamento do `dist/`.

Detalhes e passos manuais (adicionar `NPM_TOKEN`, tornar o repo público, disparar o 1º release): `documentation/development/PLAN.md`.

## Estrutura

`src/` segue os 6 módulos do core (ADR-005): `client` (REST Redmine), `normalize`, `extract` (pipeline de mídia), `bundle`, `config` (auth/credenciais — cascata keychain → arquivo → env), `cache`. Superfícies: CLI e MCP (M1) e TUI interativa (M2) em `src/surfaces/`.

## MCP server (stdio)

O subcomando `redmine-context mcp` sobe um servidor [MCP](https://modelcontextprotocol.io) sobre stdio, expondo três tools read-only:

- `get_issue_context(issue_id: number, format?: 'markdown' | 'json', extract_attachments?: boolean)` — busca a issue na instância configurada, normaliza e retorna o bundle (Markdown por padrão). Com `extract_attachments: true`, embute o texto (OCR) dos anexos de imagem no bundle (default `false`, pois adiciona latência de download+OCR).
- `search_issues(query?, project_id?, status_id?, assigned_to_id?, updated_on?, limit?)` — busca issues por filtros estruturados e, opcionalmente, texto livre (`query`, best-effort via `/search`); retorna uma lista compacta paginada.
- `get_attachment_text(issue_id: number, attachment_id: number)` — retorna o texto extraído (OCR, com cache) de um anexo, dentro de uma fence de conteúdo não confiável. Anexo não processável retorna o status/motivo legível (`skipped`/`unsupported`/`failed`), nunca um erro genérico.

A instância vem sempre da configuração do processo (`REDMINE_URL` + cascata de credencial, `REDMINE_API_KEY` no modo headless): **nenhuma tool aceita URL/host arbitrário**. Erros 403/404 e credencial ausente retornam um erro MCP claro (`isError`). O stdout é reservado ao protocolo; logs vão para stderr.

Registro no Claude (tudo após `--` é o comando do servidor stdio; `npx -y` roda a
última versão publicada, sem instalar nada global):

```bash
claude mcp add redmine-context -- npx -y redmine-context mcp
```

No Windows nativo (fora do WSL), o `npx` precisa do wrapper `cmd /c`:

```bash
claude mcp add redmine-context -- cmd /c npx -y redmine-context mcp
```

Passe a instância via `--env` (aplicado ao ambiente do servidor), por exemplo
`claude mcp add redmine-context --env REDMINE_URL=https://redmine.example -- npx -y redmine-context mcp`.
Configure o ambiente do servidor com `REDMINE_URL` e `REDMINE_API_KEY` (ou rode
`redmine-context login` para gravar a credencial na cascata). Com a integração
ativa, o cliente ganha as tools read-only `get_issue_context`, `search_issues` e
`get_attachment_text` (detalhadas acima).

## Extração de mídia (OCR)

O texto de anexos de **imagem** (PNG/JPEG/GIF/WebP) é extraído **100% localmente**
via [`tesseract`](https://github.com/tesseract-ocr/tesseract) (idiomas `por+eng`
por padrão), conforme o [ADR-002](documentation/adr/ADR-002-midia-100-local-politica-binarios.md).
O texto extraído é sempre marcado como **não confiável** (`<untrusted-content>`)
no bundle. Áudio/vídeo entram no M4 pelo mesmo caminho.

Documentos **Office (OOXML)** — `.docx`, `.pptx`, `.xlsx` — também têm o texto
extraído **100% localmente e SEM binário externo** (são contêineres ZIP com XML;
o texto é lido direto no Node). Funciona nos 3 SOs sem instalar nada e **não** entra
no `doctor`. Cobertura: parágrafos do documento (docx), texto dos slides na ordem
(pptx) e as *shared strings* (xlsx); formatação complexa/tabelas saem simplificadas.
Um `.doc`/`.ppt`/`.xls` antigo (formato binário pré-2007) não é OOXML e não é suportado.

- **CLI**: `redmine-context issue <id> --extract` baixa os anexos, roda o OCR e
  embute o texto no bundle.
- **MCP**: `get_issue_context(..., extract_attachments: true)` e
  `get_attachment_text(issue_id, attachment_id)`.

**Degradação graciosa**: o `tesseract` **não** é pré-requisito. Se estiver
ausente, o bundle é gerado do mesmo jeito — o anexo apenas registra o status de
falha com a dica de instalação; a falha de um anexo nunca derruba os demais nem o
bundle. As extrações são cacheadas por `(instância, anexo, digest, versão+modelo+params
do extrator)` ([ADR-004](documentation/adr/ADR-004-cache-duas-camadas.md)): um
comentário novo **não** reprocessa o OCR, e CLI e MCP compartilham o mesmo cache.

Verifique a instalação de todos os binários (tesseract, pdftotext, ffmpeg,
whisper.cpp) e do modelo GGUF com o `doctor` — ver
[Troubleshooting com `redmine-context doctor`](#troubleshooting-com-redmine-context-doctor):

```bash
redmine-context doctor    # exit 0 se tudo presente, 1 se faltar algum
```


## TUI interativa

`redmine-context` **sem argumentos** (num terminal interativo) abre a interface
de texto completa — mesma credencial e mesmo core da CLI/MCP:

| Tela | Como chegar | Para quê |
|---|---|---|
| Início | abertura | roteia para onboarding (sem credencial) ou Home |
| Onboarding | `Enter` no Início | URL → modo de auth → login (senha mascarada) → splash |
| Home | pós-login | suas issues com estados, seleção e retry |
| Busca | `/` na Home | full-text + filtro de status (`f` com a busca fechada) |
| Detalhe | `Enter` numa issue | metadados, descrição/journals roláveis, anexos |
| Exportação | `e` no Detalhe | grava o bundle MD/JSON (destino com `~`) |
| Jobs | `t` | operações da sessão |
| Doctor / Config | `d` / `c` no Início | status do ambiente · logout |

Atalhos globais: `Esc` volta · `q` sai · `Ctrl+C` duas vezes sai · `?` atalhos.
Sessão expirada (401) reabre o login e retoma a operação automaticamente.
Em `NO_COLOR`, `CI=true` ou saída não-TTY, a TUI cede lugar ao modo texto puro.

## Ambiente de teste

Um ambiente Redmine + Postgres descartável, usado pelos testes locais e
reutilizado sem fork pelo CI (M5). Definição em [`docker/`](docker/).

- `docker/docker-compose.yml` — Redmine (`redmine:6`) + Postgres
  (`postgres:16-alpine`), volumes nomeados (`pgdata`, `redmine_files`) e
  healthchecks (`pg_isready` no Postgres; `wget` na raiz do Redmine).
- `docker/wait-for-healthy.sh` — bloqueia até os serviços ficarem `healthy`.
- `docker/.env.example` — variáveis parametrizáveis (copie para `docker/.env`).

### Subir

```bash
docker compose -f docker/docker-compose.yml up -d
docker/wait-for-healthy.sh            # aguarda postgres + redmine healthy
```

A interface web e a **REST API** ficam em `http://localhost:${REDMINE_PORT}`
(porta padrão **3080**, fixa e documentada). A REST API é habilitada
automaticamente após o `up`, sem passo manual: um serviço one-shot
(`enable-rest-api`) roda assim que o Redmine fica healthy e liga
`rest_api_enabled` via SQL (idempotente). O seed do M1-02.2 reutiliza a API
com uma chave.

### Verificar (smoke test)

```bash
# API servindo (login não é exigido por padrão, lista vazia):
curl -s http://localhost:3080/issues.json          # {"issues":[],...} (200)

# Endpoint protegido rejeita sem chave => API de pé e autenticando:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3080/users.json   # 401
```

### Seed de fixtures

Com o ambiente de pé (healthy + REST habilitada), popule fixtures base:

```bash
npm run seed
```

O script (`scripts/seed.mjs`, Node puro, `fetch` nativo, sem dependências) cria
um projeto de identifier fixo **`rc-fixtures`** e **3 issues** com descrição, via
REST API. É **idempotente**: cada recurso é verificado por `GET` antes do `POST`
(projeto por identifier, issues por subject), então re-executar não duplica nada.
Ao final, asserções via `GET` validam as contagens e o processo sai com código
`!= 0` se algo estiver errado.

Config via ambiente (defaults combinam com o compose de teste):

| Variável                 | Padrão                   | Descrição                    |
| ------------------------ | ------------------------ | ---------------------------- |
| `REDMINE_URL`            | `http://localhost:3080`  | Base da REST API             |
| `REDMINE_ADMIN_USER`     | `admin`                  | Usuário admin (Basic auth)   |
| `REDMINE_ADMIN_PASSWORD` | `admin`                  | Senha do admin (Basic auth)  |

> Senha do admin: a imagem oficial do Redmine 6 marca o admin default para
> trocar a senha no primeiro login **web** (`must_change_passwd`). Esse flag é
> por sessão e **não bloqueia a REST API via Basic auth**; ainda assim o seed o
> zera de forma proativa e idempotente (`PUT /users/{id}.json`, mantendo a mesma
> senha) para manter o admin utilizável em web + API.

### Subir e seedar em 1 comando (CI)

Para o job de E2E no CI (Linux, issue #80), o stack precisa ficar **pronto e
seedado** em um único passo. `scripts/ci-e2e-up.sh` faz exatamente isso,
**reutilizando** o compose, o `wait-for-healthy.sh` e o `seed.mjs` (sem fork):

```bash
npm run ci:e2e:up          # = bash scripts/ci-e2e-up.sh
```

Passos: `docker compose up -d` → `wait-for-healthy.sh postgres redmine` → poll de
`docker compose ps -a` até os one-shots (`load-default-data`, `enable-rest-api`)
saírem com código 0 → `npm run seed` (idempotente). O poll de `ps -a` é usado no
lugar de `docker compose wait` porque este erra quando o container já saiu (só
rastreia containers em execução). Em sucesso o stack fica **de pé** (o teardown,
`down -v`, é responsabilidade do chamador). Re-executar é seguro: o seed não
duplica. Aceita `COMPOSE_FILE`/`ONESHOT_TIMEOUT`/`TIMEOUT` e as variáveis do seed.

### E2E dogfood (CLI + MCP)

Com Docker disponível, o roteiro E2E automatizado valida o fluxo real
ponta-a-ponta (issue #20 / M1-14):

```bash
npm run e2e
```

O script (`scripts/e2e.mjs`, Node puro, sem dependências, log em stderr, exit
`!= 0` em falha) sobe o stack (ou assume up com `E2E_ASSUME_UP=1`), espera
healthy + one-shots, roda o seed, builda, exercita a **CLI** para as 3 issues
do seed (grep das strings das fixtures: descrição, journal, custom field, anexo,
relação e pai/filho), sobe o **MCP server** como subprocess e chama
`get_issue_context` via um cliente JSON-RPC stdio mínimo (initialize →
initialized → tools/call), compara **MCP vs CLI** byte-a-byte, mede o tempo
issue→bundle (cache quente, orçamento < 30 s), testa a **recusa de http:// sem
`--insecure`** (exit `!= 0`) e faz o teardown (`down -v`) ao final.

> A api_key é obtida no fluxo real (`GET /users/current.json` com Basic auth
> admin). Contra o Docker local (http) a CLI usa `--insecure` e o MCP server
> lê `REDMINE_INSECURE=1` do ambiente.

### Replay OFFLINE via fixtures gravadas (macOS/Windows)

O E2E real acima depende de Docker e só roda no Linux do CI (#80). Para dar
cobertura E2E-equivalente **offline** na matriz **macOS/Windows** (#77) — onde o
Redmine não está disponível —, gravamos as respostas HTTP do Redmine seedado como
**fixtures versionadas** e as **reproduzimos sem rede nem docker** (issue #81):

- **Fixtures**: `tests/fixtures/redmine-e2e/interactions.json` — as interações
  `GET /issues/{id}.json` (com `include`) das 3 issues do seed e o download do
  anexo de texto. **Segredos redigidos**: nenhuma `api_key`, `Authorization` ou
  senha real; a URL base do stack é reescrita para `https://redmine.example`.
- **Replay**: `tests/integration/redmine-replay.test.ts` — substitui o `fetch`
  global por um stub dirigido pelas fixtures (mesmo mecanismo dos demais testes
  do core; o client usa `fetch`/undici, que o `nock` não intercepta) e reexecuta
  `getIssue → normalize → bundle` + o download do anexo, comparando contra
  snapshots determinísticos. Requisições **não gravadas lançam** — se algo tentar
  a rede, o teste falha. Roda na suíte padrão (`npm test`), portanto na matriz de
  3 SOs do CI.

**Regravar as fixtures** (só quando o seed/contrato mudar):

```bash
npm run ci:e2e:up        # sobe + espera healthy/one-shots + seed (precisa de Docker)
npm run record:fixtures  # grava tests/fixtures/redmine-e2e/interactions.json (segredos redigidos)
npx vitest run tests/integration/redmine-replay.test.ts -u   # atualiza os snapshots
git add tests/fixtures/redmine-e2e tests/integration/__snapshots__
```

O `scripts/record-fixtures.mjs` obtém a `api_key` do admin no fluxo real
(`GET /users/current.json`, Basic auth), mas **nunca** a grava: ela viaja só no
header (não serializado), campos sensíveis são redigidos para `[REDACTED]` e o
script **aborta** se a chave real aparecer no arquivo. O teste versionado
reafirma a ausência de segredos por grep.

### Reproduzir instância limpa / derrubar

```bash
docker compose -f docker/docker-compose.yml down -v   # remove containers + volumes
docker compose -f docker/docker-compose.yml up -d     # instância nova do zero
```

### Parametrização

Definidas em `docker/.env` (auto-carregado) ou como variáveis de ambiente:

| Variável                  | Padrão                          | Descrição                     |
| ------------------------- | ------------------------------- | ----------------------------- |
| `REDMINE_PORT`            | `3080`                          | Porta host da web/REST API    |
| `POSTGRES_DB`             | `redmine`                       | Nome do banco                 |
| `POSTGRES_USER`           | `redmine`                       | Usuário do banco              |
| `POSTGRES_PASSWORD`       | `redmine`                       | Senha do banco (test-only)    |
| `REDMINE_SECRET_KEY_BASE` | `please-change-me-in-real-envs` | Secret do Rails               |

O script `wait-for-healthy.sh` aceita `TIMEOUT`, `INTERVAL` e `COMPOSE_FILE`.

> As credenciais acima são exclusivas do ambiente de teste (defaults no
> compose/`.env.example`); não há credenciais hardcoded fora dele.

> Nota (CI): o one-shot `enable-rest-api` roda após o Redmine ficar healthy; em pipelines, aguarde o exit 0 dele antes do smoke test da API — o `ci-e2e-up.sh` faz isso via poll de `docker compose ps -a` (não `docker compose wait`, que erra em containers já finalizados).
