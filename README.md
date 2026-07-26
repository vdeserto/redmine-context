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

> Os binários de mídia (`tesseract`, `ffmpeg`, `whisper.cpp`) **não** são
> embutidos no pacote npm (ADR-002): são opcionais e instalados pelo próprio
> usuário quando quiser OCR/transcrição. Rode `redmine-context doctor` para o
> diagnóstico. Sem eles, o bundle de texto é gerado normalmente.

## Quickstart

Do login ao contexto da issue no seu LLM, em três passos:

```bash
# 1) login — autentica e grava a api_key da instância na cascata de credenciais:
#    keychain do sistema (preferido) → arquivo 0600 → REDMINE_API_KEY (env).
#    Credenciais antigas em arquivo migram para o keychain automaticamente.
#    (senha ou, em contas com 2FA, cole a api_key quando solicitado).
redmine-context login --url https://redmine.example

# 2) issue — imprime o bundle Markdown completo da issue em stdout
#    (descrição + histórico + custom fields + anexos + relações + pai/filhos).
redmine-context issue 42 --url https://redmine.example
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

## Estrutura

`src/` segue os 6 módulos do core (ADR-005): `client` (REST Redmine), `normalize`, `extract` (pipeline de mídia), `bundle`, `config` (auth/credenciais — cascata keychain → arquivo → env), `cache`. Superfícies: CLI e MCP (M1) e TUI interativa (M2) em `src/surfaces/`.

## MCP server (stdio)

O subcomando `redmine-context mcp` sobe um servidor [MCP](https://modelcontextprotocol.io) sobre stdio, expondo três tools read-only:

- `get_issue_context(issue_id: number, format?: 'markdown' | 'json', extract_attachments?: boolean)` — busca a issue na instância configurada, normaliza e retorna o bundle (Markdown por padrão). Com `extract_attachments: true`, embute o texto (OCR) dos anexos de imagem no bundle (default `false`, pois adiciona latência de download+OCR).
- `search_issues(query?, project_id?, status_id?, assigned_to_id?, updated_on?, limit?)` — busca issues por filtros estruturados e, opcionalmente, texto livre (`query`, best-effort via `/search`); retorna uma lista compacta paginada.
- `get_attachment_text(issue_id: number, attachment_id: number)` — retorna o texto extraído (OCR, com cache) de um anexo, dentro de uma fence de conteúdo não confiável. Anexo não processável retorna o status/motivo legível (`skipped`/`unsupported`/`failed`), nunca um erro genérico.

A instância vem sempre da configuração do processo (`REDMINE_URL` + cascata de credencial, `REDMINE_API_KEY` no modo headless): **nenhuma tool aceita URL/host arbitrário**. Erros 403/404 e credencial ausente retornam um erro MCP claro (`isError`). O stdout é reservado ao protocolo; logs vão para stderr.

Registro no Claude:

```bash
claude mcp add redmine-context -- npx -y redmine-context mcp
```

Configure o ambiente do servidor com `REDMINE_URL` e `REDMINE_API_KEY` (ou rode `redmine-context login` para gravar a credencial na cascata).

## Extração de mídia (OCR)

O texto de anexos de **imagem** (PNG/JPEG/GIF/WebP) é extraído **100% localmente**
via [`tesseract`](https://github.com/tesseract-ocr/tesseract) (idiomas `por+eng`
por padrão), conforme o [ADR-002](documentation/adr/ADR-002-midia-100-local-politica-binarios.md).
O texto extraído é sempre marcado como **não confiável** (`<untrusted-content>`)
no bundle. Áudio/vídeo entram no M4 pelo mesmo caminho.

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

Verifique a instalação com o `doctor`:

```bash
redmine-context doctor    # relatório dos binários de mídia (tesseract); exit 0 se ok, 1 se faltar
```

O `doctor` detecta o binário no `PATH` e em locais convencionais e, quando
ausente, imprime a instrução de instalação do seu SO (ex.: `brew install tesseract`,
`apt install tesseract-ocr`, `winget install UB-Mannheim.TesseractOCR`). Degrada
naturalmente em `NO_COLOR`/não-TTY (texto puro, sem ANSI).


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

> Nota (CI): o one-shot `enable-rest-api` roda após o Redmine ficar healthy; em pipelines, aguarde o exit 0 dele (`docker compose wait enable-rest-api`) antes do smoke test da API.
