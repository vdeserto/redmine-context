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

## Próximo passo
**/plan:breakdown** — quebrar M1–M5 em 15–30 issues granulares.
