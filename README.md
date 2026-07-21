# redmine-context

Consumidor de Redmine que entrega contexto completo de issues — texto e mídia (áudio/vídeo/imagem) extraída **100% localmente** — para qualquer LLM, via MCP server, CLI e TUI.

> Planejamento: `documentation/development/PLAN.md` · Backlog: `documentation/development/BACKLOG.md` · Decisões: `documentation/adr/`

## Requisitos

- Node.js ≥ 20

## Scripts

| Script | O que faz |
|---|---|
| `npm run typecheck` | Checagem de tipos (tsc, strict) |
| `npm run lint` | ESLint (typescript-eslint) |
| `npm test` | Vitest com cobertura (threshold 80%) |
| `npm run build` | Compila para `dist/` |
| `npm run seed` | Popula fixtures base no Redmine via REST (ver [Seed](#seed-de-fixtures)) |

## Estrutura

`src/` segue os 6 módulos do core (ADR-005): `client` (REST Redmine), `normalize`, `extract` (pipeline de mídia), `bundle`, `config` (auth/credenciais), `cache`. Superfícies (CLI/TUI/MCP) chegam nos milestones M1–M2.

## MCP server (stdio)

O subcomando `redmine-context mcp` sobe um servidor [MCP](https://modelcontextprotocol.io) sobre stdio, expondo uma tool read-only:

- `get_issue_context(issue_id: number, format?: 'markdown' | 'json')` — busca a issue na instância configurada, normaliza e retorna o bundle (Markdown por padrão).

A instância vem sempre da configuração do processo (`REDMINE_URL` + cascata de credencial, `REDMINE_API_KEY` no modo headless): **nenhuma tool aceita URL/host arbitrário**. Erros 403/404 e credencial ausente retornam um erro MCP claro (`isError`). O stdout é reservado ao protocolo; logs vão para stderr.

Registro no Claude:

```bash
claude mcp add redmine-context -- npx -y redmine-context mcp
```

Configure o ambiente do servidor com `REDMINE_URL` e `REDMINE_API_KEY` (ou rode `redmine-context login` para gravar a credencial na cascata).

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
