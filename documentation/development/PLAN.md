# PLAN — redmine-context (compacto v3, breakdown 2026-07-21)

> Backlog completo (87 itens): `documentation/development/BACKLOG.md`
> Docs: ADRs em `documentation/adr/ADR-001..005`, PRD em `documentation/prd/PRD-redmine-context.md`
> Estágio do fluxo: planning pipeline completo ✅ (draft → refine → breakdown → publish → pathfind, 2026-07-21) → **agora: dev flow por issue** (`/dev:kickoff #1`)
> Mapa de execução: `documentation/development/EXECUTION-MAP.md` · branches `milestone/M1..M5` sequenciais
> Publicado: repo https://github.com/vdeserto/redmine-context (privado) · 87 issues (#1–#87) · 5 milestones · 19 labels · 15 sub-issues linkadas · mapeamento em `documentation/development/ISSUE-MAP.json`

## Breakdown (resumo)
87 itens: M1=21 · M2=19 · M3=16 · M4=17 · M5=14 (6 epics, 15 sub-issues, 5 gap analysis; EAT ≤ 30min/item, ≈ 28h). Validado pelo fft-po (9 ajustes aplicados, incl. novo M3-13 get_attachment_text e dogfood M1 desbloqueado de search_issues). Convenções GitHub (labels, milestones, template de issue, sub-issues via create_subissue com fallback task-list, branch `type/M<n>-<seq>-<slug>`, squash merge, Projects) documentadas no BACKLOG.md — o /plan:publish deve segui-las, começando pelo bootstrap do repo (git init -b main + gh repo create --private).

## Visão
Consumidor de Redmine multi-OS que entrega contexto completo de issues (texto + mídia extraída 100% localmente) para qualquer LLM, via MCP, CLI e TUI bonita (Ink).

## Decisões travadas (detalhe nos ADRs)
- **ADR-001** Stack: TS/Node ≥ 20, `@modelcontextprotocol/sdk`, Ink + `@inkjs/ui`; npm/npx.
- **ADR-002** Mídia 100% local (tesseract/whisper.cpp/ffmpeg); degradação graciosa obrigatória; binários: default instrução via `doctor`, download opt-in com SHA-256 pinado (nunca tesseract Windows, nunca em MCP headless); anexo = input hostil (magic bytes, limites 100 MB/20 min → pular com aviso, timeout, protocol_whitelist).
- **ADR-003** Auth: login TUI → Basic auth → api_key de `/users/current.json` → keychain (M2; arquivo 0600 no M1) → env sempre aceita; 2FA → colar key de /my/account; HTTPS obrigatório, `--ca-file` para self-signed.
- **ADR-004** Cache 2 camadas: extrações por `(instance_hash, attachment_id, digest, extractor_version+model)`; bundle por `(issue_id, updated_on)`; comentário novo NUNCA reprocessa mídia; GC LRU 2 GB; multi-instância por instance_hash.
- **ADR-005** Core 6 módulos (REST client, normalização, extração+fila de jobs, bundle determinístico com schema_version e marcação untrusted, config/auth, cache) + superfícies finas via `AsyncIterable<ProgressEvent | Result>`; MCP cache-first.

## Questões resolvidas no refine
idioma auto-detect + override (`por+eng` no tesseract) · limites 100 MB/20 min pular-com-aviso · mídia por referência (cópia só na exportação explícita) · search = filtros estruturados + full-text best-effort · vídeo = áudio + 1 keyframe (frames+OCR pós-MVP) · cache 2 camadas · binários híbrido default-instrução.

## Milestones (reordenados — "compromisso", decisão do usuário 2026-07-21)
- **M1 — Core + CLI + MCP fino (texto-only)**: dogfood no Claude Code desde a semana 1; login simples (arquivo 0600); zero deps nativas. Aceite: ≥ 3 issues reais iniciadas no LLM sem abrir o Redmine.
- **M2 — TUI completa + keychain**: telas onboarding/home/detalhe/jobs/export/doctor; `@inkjs/ui` + theme.ts central; NO_COLOR/60-col ok; @napi-rs/keyring.
- **M3 — Anexos + OCR**: cache, dispatcher magic-bytes, tesseract, `doctor`.
- **M4 — Áudio/vídeo**: whisper.cpp + GGUF (checksum/Range), ffmpeg, fila de jobs, MCP `status: processing`.
- **M5 — Distribuição**: npx limpo nos 3 SOs, CI (Linux E2E docker + mac/win fixtures nock), changesets.

## Pré-requisitos
`git init` (passo zero); Node ≥ 20; Redmine docker seedado (fixture E2E); binários de mídia na máquina dev; GitHub + CI 3 SOs a partir do M2.

## CI base — 3 SOs (#77 / M5-04)
- Workflow: `.github/workflows/ci.yml` — `push`/`pull_request` em `main` e `milestone/**`.
- Matriz `os: [ubuntu-latest, macos-latest, windows-latest]`, Node 20, cache npm (`actions/setup-node@v4`).
- Steps: `npm ci` → `npm run typecheck` → `npm run lint` → `npm test` (coverage, gate 80%). `shell: bash` nos 3 SOs; `fail-fast: false` (cada SO reporta status próprio); `timeout-minutes: 25`; `concurrency` cancela runs redundantes do mesmo ref.
- Escopo: só CI base (typecheck/lint/unit). E2E real contra Redmine (docker, só Linux) fica em #78–#80. Binários de mídia (ffmpeg/whisper/tesseract) permanecem opt-in — não exigidos no unit CI.
- Checks gerados: `ci (ubuntu-latest)` · `ci (macos-latest)` · `ci (windows-latest)`.
- **Proteção de branch (config do repo, NÃO no workflow — executar quando o dono decidir):**

  ```sh
  gh api -X PUT repos/vdeserto/redmine-context/branches/main/protection \
    -H "Accept: application/vnd.github+json" \
    -f 'required_status_checks[strict]=true' \
    -f 'required_status_checks[checks][][context]=ci (ubuntu-latest)' \
    -f 'required_status_checks[checks][][context]=ci (macos-latest)' \
    -f 'required_status_checks[checks][][context]=ci (windows-latest)' \
    -F 'enforce_admins=true' \
    -F 'required_pull_request_reviews=null' \
    -F 'restrictions=null'
  ```

  (Repetir trocando `main` por `milestone/M5` para proteger a branch de milestone.)

## Replay offline via fixtures (#81 / M5-06)
- **Problema:** o E2E real (#80) precisa de Docker e só roda no Linux; macOS/Windows
  da matriz (#77) não têm o Redmine. O #81 dá cobertura E2E-equivalente **offline**.
- **Mecanismo:** fixtures HTTP gravadas + replay pelo **stub de `fetch` global** (o
  mesmo padrão dos demais testes do core). Não usa `nock`: o client usa `fetch`/undici,
  que o `nock` (interceptor de `http`/`https`) não intercepta de forma confiável.
- **Gravação:** `scripts/record-fixtures.mjs` (`npm run record:fixtures`) exercita o
  Redmine seedado (`npm run ci:e2e:up`) e grava `GET /issues/{id}.json` (com include)
  das 3 issues + o download do anexo em `tests/fixtures/redmine-e2e/interactions.json`.
- **Segredos redigidos:** a `api_key` viaja só no header (não serializado); campos
  sensíveis viram `[REDACTED]`; a URL base do stack é reescrita para
  `https://redmine.example`; o script **aborta** se a chave real vazar.
- **Replay:** `tests/integration/redmine-replay.test.ts` reexecuta
  `getIssue → normalize → bundle` (Markdown + JSON canônico) e o download do anexo
  contra snapshots determinísticos; requisições não gravadas **lançam** (prova o
  isolamento de rede). Testes de ausência de segredos por grep. Roda em `npm test`,
  logo na matriz mac/win do `ci.yml` (#77) — sem workflow novo.
- **Regravar:** ver README §"Replay OFFLINE via fixtures gravadas".

## Release & versionamento — Changesets (#85 / M5-10)

Versionamento e publicação npm gerenciados por [`@changesets/cli`](https://github.com/changesets/changesets).

- **Config:** `.changeset/config.json` — `baseBranch: main`, `access: public`, changelog automático (`@changesets/cli/changelog`), `commit: false`.
- **Scripts npm:** `changeset` (criar), `version` (`changeset version` — bump + CHANGELOG), `release` (`changeset publish`).

### Como criar um changeset (todo PR de código)
```sh
npm run changeset      # interativo: escolhe bump (patch/minor/major) + nota do CHANGELOG
# gera .changeset/<slug>.md — commite junto com o código do PR
```

### Gate de PR sem changeset — `.github/workflows/changeset-check.yml`
- Roda em `pull_request` (para `main`/`milestone/**`): `npx changeset status --since=origin/main`.
- **FALHA** se um PR mexe em código publicável sem changeset; **PASSA** se há changeset ou se a mudança não afeta o publicado (docs/CI ficam isentos naturalmente).
- Workflow separado — **não** toca em `ci.yml`/`e2e.yml`/`smoke-npx.yml`.

### Release automático — `.github/workflows/release.yml`
- Dispara no `push` em `main`. Job `gates` (typecheck+lint+test+build) roda primeiro; `release` só prossegue com **CI verde** (`needs: gates`).
- Usa `changesets/action`:
  1. Com changesets pendentes → abre/atualiza o PR **"Version Packages"** (bumpa versão + escreve `CHANGELOG.md`).
  2. Ao **mergear** esse PR → não há changesets pendentes → roda `changeset publish` → `npm publish`.
- **Provenance:** `NPM_CONFIG_PROVENANCE: true` + `permissions: id-token: write` + `contents: write` → attestation SLSA no npm.
- **GUARDADO (inerte hoje):** o passo do `changesets/action` só roda com `if: ${{ secrets.NPM_TOKEN != '' }}`. **Sem o segredo o job é pulado — NADA é publicado.**

### DoD — dry-run verde
```sh
npm ci
npx changeset status          # lista bumps pendentes (exit 0)
npm publish --dry-run         # empacota o dist/ e SIMULA (NÃO publica) — exit 0
```
Validado localmente: `changeset status` OK (minor em `redmine-context`); `npm publish --dry-run` empacota 213 arquivos (`dist/` + `README.md` + `LICENSE` + `package.json`, ~303 kB) sem erro. `prepack` (build via `tsc`) reaproveitado do #76.

### Passos manuais do Victor (fora do escopo desta issue — não executados aqui)
1. **Adicionar `NPM_TOKEN`** nos secrets do repo (token npm com permissão de publish) — sem ele o release fica inerte.
2. **Tornar o repo público** (proveniência npm exige repo público).
3. **Disparar o primeiro release:** mergear PRs com changesets em `main` → mergear o PR "Version Packages" gerado → o publish roda com provenance.

> ⚠️ Esta issue **NÃO** publicou nada no npm, **NÃO** tornou o repo público e **NÃO** adicionou segredos. Apenas configurou o tooling (dry-run verde).

## Próximo passo
**/plan:breakdown** — quebrar M1–M5 em 15–30 issues granulares.
