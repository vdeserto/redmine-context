# redmine-context

## 0.2.0

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
