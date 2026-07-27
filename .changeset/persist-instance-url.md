---
"redmine-context": minor
---

Persistência da URL da instância (#187): o `login` agora salva a instância autenticada e a CLI/TUI/MCP a usam como fallback quando `--url`/`REDMINE_URL` estão ausentes. Precedência: `--url` → `REDMINE_URL` → URL persistida. Resolve o atrito de a TUI falhar com "Instância não configurada" mesmo com credencial salva. O `config`/`doctor` mostram a origem da instância e o `logout` limpa a URL persistida.
