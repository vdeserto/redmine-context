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

## Próximo passo
**/plan:breakdown** — quebrar M1–M5 em 15–30 issues granulares.
