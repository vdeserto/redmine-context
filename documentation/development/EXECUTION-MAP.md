# EXECUTION MAP — redmine-context (/plan:pathfind, 2026-07-21)

> Branches de milestone (sequenciais): `milestone/M1` ← main · `milestone/M2` ← M1 · `milestone/M3` ← M2 · `milestone/M4` ← M3 · `milestone/M5` ← M4
> Feature branch de cada issue nasce da branch do SEU milestone: `git worktree add ../rc-<slug> -b type/Mx-yy-slug milestone/Mx`
> Após merge de uma dependência na branch do milestone: `git pull` nela antes de iniciar issue dependente.
> Todas as issues têm `Milestone branch:` no corpo — o /dev:kickoff lê de lá.

## M1 — branch `milestone/M1`

EAT total: 9h00 · Caminho crítico: 6h20 · Worktrees recomendados: 3

**Caminho crítico**: M1-01(#1) → M1-03(#6) → M1-04.1(#8) → M1-04.2(#9) → M1-04.3(#10) → M1-05(#11) → M1-06(#12) → M1-09(#15) → M1-10(#16) → M1-11(#17) → M1-12(#18) → M1-13(#19) → M1-15(#21)

### Grupos paralelos (lanes = worktrees)

**Onda 0** (sem dependências — iniciar em paralelo)
- `# 1` [M1-01] Inicializar repositório e toolchain TypeScript (30min) ★crítico
- `# 3` [M1-02.1] Subir Redmine+Postgres via docker compose com healthcheck (25min)

**Onda 1** 
- `# 4` [M1-02.2] Criar seed base via REST (projeto + 3 issues simples) (25min) ← após merge de #3
- `# 6` [M1-03] Definir contrato do core (tipos + AsyncIterable<ProgressEvent | Result>) (25min) ← após merge de #1 ★crítico

**Onda 2** 
- `# 5` [M1-02.3] Enriquecer seed com fixtures ricas (journals, custom fields, relations, anexo) (30min) ← após merge de #4
- `# 8` [M1-04.1] Implementar HTTP base com auth e TLS obrigatório (30min) ← após merge de #6 ★crítico

**Onda 3** 
- `# 9` [M1-04.2] Implementar getIssue/listIssues com paginação (30min) ← após merge de #8 ★crítico
- `#13` [M1-07] Implementar login interativo (usuário/senha → api_key) (30min) ← após merge de #8

**Onda 4** 
- `#10` [M1-04.3] Implementar retry/backoff exponencial no client (25min) ← após merge de #9 ★crítico
- `#14` [M1-08] Credential store em arquivo 0600 + cascata de resolução (25min) ← após merge de #13

**Onda 5** 
- `#11` [M1-05] Normalizar Issue/Journal/Attachment (modelo base) (30min) ← após merge de #10 ★crítico

**Onda 6** 
- `#12` [M1-06] Normalizar custom fields, relations, parent/children e watchers (30min) ← após merge de #11 ★crítico

**Onda 7** 
- `#15` [M1-09] Gerar bundle JSON determinístico (30min) ← após merge de #12 ★crítico

**Onda 8** 
- `#16` [M1-10] Gerar bundle Markdown com fences untrusted (30min) ← após merge de #15 ★crítico

**Onda 9** 
- `#17` [M1-11] CLI `redmine-context issue <id>` (30min) ← após merge de #14, #16 ★crítico

**Onda 10** 
- `#18` [M1-12] MCP server (stdio) com tool get_issue_context (30min) ← após merge de #17 ★crítico

**Onda 11** 
- `#19` [M1-13] MCP tool search_issues (pós-dogfood, não bloqueia M1-14) (30min) ← após merge de #18 ★crítico
- `#20` [M1-14] Validar E2E dogfood (CLI + MCP no Claude Code) e quickstart (25min) ← após merge de #5, #18

**Onda 12** 
- `#21` [M1-15] Gap Analysis M1 (30min) ← após merge de #1, #3, #4, #5, #6, #8, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18, #19, #20 ★crítico

### Comandos prontos (ordem de execução)
```
/dev:kickoff #1
/dev:kickoff #3
/dev:kickoff #4
/dev:kickoff #6
/dev:kickoff #5
/dev:kickoff #8
/dev:kickoff #9
/dev:kickoff #13
/dev:kickoff #10
/dev:kickoff #14
/dev:kickoff #11
/dev:kickoff #12
/dev:kickoff #15
/dev:kickoff #16
/dev:kickoff #17
/dev:kickoff #18
/dev:kickoff #19
/dev:kickoff #20
/dev:kickoff #21
```

## M2 — branch `milestone/M2`

EAT total: 8h25 · Caminho crítico: 4h50 · Worktrees recomendados: 3

**Caminho crítico**: M2-01(#22) → M2-02(#23) → M2-04(#25) → M2-05.1(#27) → M2-05.2(#28) → M2-06(#29) → M2-08(#31) → M2-10(#33) → M2-11(#34) → M2-17(#40)

### Grupos paralelos (lanes = worktrees)

**Onda 0** (sem dependências — iniciar em paralelo)
- `#22` [M2-01] Scaffolding da TUI (Ink + @inkjs/ui + roteador de telas) (30min) ★crítico
- `#37` [M2-14] Keychain nativo (@napi-rs/keyring) (30min)

**Onda 1** 
- `#23` [M2-02] theme.ts central com tokens via Context (25min) ← após merge de #22 ★crítico
- `#24` [M2-03] Degradação NO_COLOR / não-TTY / CI (30min) ← após merge de #22
- `#38` [M2-15] Cascata completa de credencial + migração para keychain (25min) ← após merge de #37

**Onda 2** 
- `#25` [M2-04] Navegação global e breadcrumb (30min) ← após merge de #22, #23 ★crítico

**Onda 3** 
- `#27` [M2-05.1] Telas URL → modo auth → login mascarado (30min) ← após merge de #25 ★crítico
- `#35` [M2-12] Telas doctor e config/logout (30min) ← após merge de #25

**Onda 4** 
- `#28` [M2-05.2] Validação, estados sucesso/erro e fallback 2FA (30min) ← após merge de #27 ★crítico

**Onda 5** 
- `#29` [M2-06] Tela home (minhas issues) com estados (30min) ← após merge de #25, #28 ★crítico

**Onda 6** 
- `#30` [M2-07] Busca e filtros na home (30min) ← após merge de #29
- `#31` [M2-08] Tela de detalhe da issue (descrição + journals roláveis) (30min) ← após merge de #29 ★crítico
- `#36` [M2-13] Sessão expirada (401 → re-login) (25min) ← após merge de #28, #29

**Onda 7** 
- `#32` [M2-09] Anexos no detalhe com status de extração (20min) ← após merge de #31
- `#33` [M2-10] Tela de exportação do bundle (30min) ← após merge de #31 ★crítico
- `#39` [M2-16] Layout responsivo em 80 e 60 colunas (25min) ← após merge de #29, #31

**Onda 8** 
- `#34` [M2-11] Painel de jobs (25min) ← após merge de #33 ★crítico

**Onda 9** 
- `#40` [M2-17] Gap Analysis M2 (30min) ← após merge de #22, #23, #24, #25, #27, #28, #29, #30, #31, #32, #33, #34, #35, #36, #37, #38, #39 ★crítico

### Comandos prontos (ordem de execução)
```
/dev:kickoff #22
/dev:kickoff #37
/dev:kickoff #23
/dev:kickoff #24
/dev:kickoff #38
/dev:kickoff #25
/dev:kickoff #27
/dev:kickoff #35
/dev:kickoff #28
/dev:kickoff #29
/dev:kickoff #30
/dev:kickoff #31
/dev:kickoff #36
/dev:kickoff #32
/dev:kickoff #33
/dev:kickoff #39
/dev:kickoff #34
/dev:kickoff #40
```

## M3 — branch `milestone/M3`

EAT total: 6h20 · Caminho crítico: 3h50 · Worktrees recomendados: 3

**Caminho crítico**: M3-01(#41) → M3-02(#42) → M3-03(#43) → M3-06(#48) → M3-08(#50) → M3-09(#51) → M3-10(#52) → M3-12(#54) → M3-14(#56)

### Grupos paralelos (lanes = worktrees)

**Onda 0** (sem dependências — iniciar em paralelo)
- `#41` [M3-01] Contrato do módulo Cache (get/put/invalidate/lock/gc) (20min) ★crítico

**Onda 1** 
- `#42` [M3-02] instance_hash e layout de diretórios (env-paths) (25min) ← após merge de #41 ★crítico

**Onda 2** 
- `#43` [M3-03] Chave attachment-level com fallback de digest (25min) ← após merge de #42 ★crítico
- `#44` [M3-04] Lock por chave do cache (25min) ← após merge de #42
- `#46` [M3-05.1] Índice JSON por instância com last_accessed_at (25min) ← após merge de #42

**Onda 3** 
- `#47` [M3-05.2] Política LRU com quotas separadas + remoção segura (25min) ← após merge de #46
- `#48` [M3-06] Download de anexo com nome derivado de id+digest (25min) ← após merge de #43, #44 ★crítico

**Onda 4** 
- `#49` [M3-07] Limite de anexo (100 MB) com pular-com-aviso (25min) ← após merge de #48
- `#50` [M3-08] Dispatcher de extratores por magic bytes (25min) ← após merge de #48 ★crítico

**Onda 5** 
- `#51` [M3-09] Extrator tesseract (execFile, por+eng) (30min) ← após merge de #50 ★crítico

**Onda 6** 
- `#52` [M3-10] Degradação graciosa + untrusted do OCR no bundle (25min) ← após merge de #51 ★crítico
- `#53` [M3-11] doctor — detecção do tesseract e instruções por SO (25min) ← após merge de #51

**Onda 7** 
- `#54` [M3-12] Integração — comentário novo não reprocessa extração (25min) ← após merge de #52 ★crítico
- `#55` [M3-13] MCP tool get_attachment_text (25min) ← após merge de #52

**Onda 8** 
- `#56` [M3-14] Gap Analysis M3 (30min) ← após merge de #41, #42, #43, #44, #46, #47, #48, #49, #50, #51, #52, #53, #54, #55 ★crítico

### Comandos prontos (ordem de execução)
```
/dev:kickoff #41
/dev:kickoff #42
/dev:kickoff #43
/dev:kickoff #44
/dev:kickoff #46
/dev:kickoff #47
/dev:kickoff #48
/dev:kickoff #49
/dev:kickoff #50
/dev:kickoff #51
/dev:kickoff #52
/dev:kickoff #53
/dev:kickoff #54
/dev:kickoff #55
/dev:kickoff #56
```

## M4 — branch `milestone/M4`

EAT total: 6h40 · Caminho crítico: 2h40 · Worktrees recomendados: 3

**Caminho crítico**: M4-10.1(#67) → M4-10.2(#68) → M4-11(#70) → M4-12(#71) → M4-13(#72) → M4-14(#73)

### Grupos paralelos (lanes = worktrees)

**Onda 0** (sem dependências — iniciar em paralelo)
- `#57` [M4-01] Estender doctor — ffmpeg e whisper.cpp (20min)
- `#58` [M4-02] Download GGUF com SHA-256 pinado e URL oficial fixa (25min)
- `#67` [M4-10.1] Núcleo da fila — concorrência núcleos−1 e estados (30min) ★crítico

**Onda 1** 
- `#59` [M4-03] Retomada HTTP Range + .part/rename atômico no GGUF (25min) ← após merge de #58
- `#60` [M4-04] Áudio → WAV 16 kHz via ffmpeg com -protocol_whitelist file (25min) ← após merge de #57
- `#68` [M4-10.2] Timeout + kill de subprocesso e env sanitizado (25min) ← após merge de #67 ★crítico
- `#69` [M4-10.3] Cancelamento via AbortSignal + eventos no AsyncIterable (25min) ← após merge de #67

**Onda 2** 
- `#61` [M4-05] Extrator whisper.cpp — execFile e parse para ExtractionResult (25min) ← após merge de #58, #60
- `#63` [M4-07] Vídeo — extração da faixa de áudio via ffmpeg (25min) ← após merge de #60
- `#70` [M4-11] MCP cache-first — resposta imediata com status processing (25min) ← após merge de #67, #68, #69 ★crítico

**Onda 3** 
- `#62` [M4-06] Idioma auto-detect com override; modelo/params na chave de cache (20min) ← após merge de #61
- `#64` [M4-08] Keyframe representativo (1 frame) com referência no bundle (25min) ← após merge de #63
- `#65` [M4-09] Limite 20 min de vídeo (ffprobe) com pular-com-aviso (25min) ← após merge de #63
- `#71` [M4-12] Continuação em background — 2ª chamada retorna completo (25min) ← após merge de #70 ★crítico

**Onda 4** 
- `#72` [M4-13] Integração — comentário novo não reprocessa vídeo (25min) ← após merge de #71 ★crítico

**Onda 5** 
- `#73` [M4-14] Gap Analysis M4 (30min) ← após merge de #57, #58, #59, #60, #61, #62, #63, #64, #65, #67, #68, #69, #70, #71, #72 ★crítico

### Comandos prontos (ordem de execução)
```
/dev:kickoff #57
/dev:kickoff #58
/dev:kickoff #67
/dev:kickoff #59
/dev:kickoff #60
/dev:kickoff #68
/dev:kickoff #69
/dev:kickoff #61
/dev:kickoff #63
/dev:kickoff #70
/dev:kickoff #62
/dev:kickoff #64
/dev:kickoff #65
/dev:kickoff #71
/dev:kickoff #72
/dev:kickoff #73
```

## M5 — branch `milestone/M5`

EAT total: 5h30 · Caminho crítico: 2h40 · Worktrees recomendados: 3

**Caminho crítico**: M5-03(#76) → M5-04(#77) → M5-05.1(#79) → M5-05.2(#80) → M5-06(#81) → M5-12(#87)

### Grupos paralelos (lanes = worktrees)

**Onda 0** (sem dependências — iniciar em paralelo)
- `#74` [M5-01] Prebuilds do keyring via optionalDependencies (25min)
- `#76` [M5-03] Empacotamento npm/npx (bin, files, exports, engines) (25min) ★crítico
- `#83` [M5-08] Hardening Windows — execFile sem shell e paths portáveis (25min)
- `#84` [M5-09] Hardening Windows — terminal legado (ASCII, NO_COLOR) (20min)

**Onda 1** 
- `#75` [M5-02] Teste de instalação limpa sem toolchain (25min) ← após merge de #74
- `#77` [M5-04] CI base — matriz 3 SOs (typecheck/lint/unit) (25min) ← após merge de #76 ★crítico

**Onda 2** 
- `#79` [M5-05.1] docker compose Redmine+Postgres com seed via REST (CI) (30min) ← após merge de #77 ★crítico
- `#82` [M5-07] Smoke npx (--help, doctor) em macOS/Windows (20min) ← após merge de #76, #77
- `#85` [M5-10] Changesets — versionamento e release npm (25min) ← após merge de #77

**Onda 3** 
- `#80` [M5-05.2] Job E2E — CLI e MCP contra Redmine seedado (25min) ← após merge de #79 ★crítico
- `#86` [M5-11] Docs de instalação por SO + registro MCP (30min) ← após merge de #82

**Onda 4** 
- `#81` [M5-06] Fixtures nock gravadas com replay em macOS/Windows (25min) ← após merge de #79, #80 ★crítico

**Onda 5** 
- `#87` [M5-12] Gap Analysis M5 (30min) ← após merge de #74, #75, #76, #77, #79, #80, #81, #82, #83, #84, #85, #86 ★crítico

### Comandos prontos (ordem de execução)
```
/dev:kickoff #74
/dev:kickoff #76
/dev:kickoff #83
/dev:kickoff #84
/dev:kickoff #75
/dev:kickoff #77
/dev:kickoff #79
/dev:kickoff #82
/dev:kickoff #85
/dev:kickoff #80
/dev:kickoff #86
/dev:kickoff #81
/dev:kickoff #87
```
