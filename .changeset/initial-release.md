---
"redmine-context": minor
---

Release inicial do redmine-context: consumidor de Redmine que entrega contexto
completo de issues (texto + mídia extraída 100% localmente) para qualquer LLM,
via MCP, CLI e TUI (Ink). Inclui distribuição por npx nos 3 SOs, CI em matriz
(typecheck/lint/testes + E2E Linux + smoke npx macOS/Windows) e pipeline de
release com Changesets (versionamento automático, CHANGELOG e publish npm com
provenance).
