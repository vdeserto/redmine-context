# PRD — redmine-context

> Documento vivo. Alterações registradas no changelog ao final.
> Decisões arquiteturais: ver `documentation/adr/ADR-001..006`.

## Problema e oportunidade

Devs que trabalham com Redmine perdem o contexto rico das issues ao iniciar tarefas com LLMs: descrição e comentários são copiáveis, mas screenshots, áudios e screencasts — onde frequentemente está a informação decisiva — não chegam ao modelo. Resultado: o dev abre o Redmine, reassiste vídeo, re-descreve imagem, e ainda assim o LLM começa com contexto incompleto.

## Persona e job-to-be-done

**Persona primária**: dev que usa Claude Code (ou outro cliente MCP) diariamente e recebe tarefas via Redmine.
**JTBD**: "Quando recebo uma issue do Redmine, quero levar todo o contexto dela (texto + mídia) para o meu LLM em um passo, para iniciar a tarefa sem abrir o Redmine."

**Persona secundária**: dev que prefere fluxo interativo — navega, escolhe a issue e exporta pelo terminal (TUI).

## Proposta de valor

Bundle de contexto (Markdown + JSON) com a issue completa — descrição, histórico, campos, e **texto extraído localmente** de imagens (OCR), áudios e vídeos (transcrição) — consumível por qualquer LLM, entregue via MCP, CLI ou TUI. Privacidade total: nada sai da máquina além das chamadas à própria instância Redmine.

## Escopo

**IN (MVP)**: leitura de issues (descrição, journals, custom fields, relações, anexos); extração local de mídia; bundle MD/JSON determinístico; MCP tools `get_issue_context`/`search_issues`/`get_attachment_text`; TUI completa (login, navegação, preview, jobs, exportação); login sem API key; cache em 2 camadas; multi-instância. **Pós-MVP (M6)**: bundle legível (nomes no lugar de códigos, fences por seção), rótulos em pt-BR/en/es e slash commands via MCP prompts.

**OUT**: escrita no Redmine; wiki/fóruns/time entries; UI gráfica; MCP HTTP/SSE; análise semântica de vídeo (frames+OCR pós-MVP condicionado a evidência); sumarização interna por LLM; binários de mídia empacotados no npm.

## User stories e critérios de aceitação (outcome-based)

### M1 — Core + CLI + MCP fino (texto-only)
- Como dev, dou o nº de uma issue (CLI `redmine-context issue <id>` ou tool MCP no Claude Code) e recebo um bundle que permite ao LLM iniciar a tarefa **sem eu abrir o Redmine**. ✔ validar com ≥ 3 issues reais.
- Como dev sem API key, faço login com usuário/senha uma única vez e nunca mais penso em credencial (api_key em arquivo 0600 no M1).

### M2 — TUI completa + keychain
- Como dev, executo `redmine-context`, navego pelas minhas issues com busca, vejo o preview e exporto o bundle — fluxo completo sem tocar em config manual.
- Estética: bonita em 80 colunas, funcional em 60; NO_COLOR/não-TTY degradam para texto puro; credencial migra para o keychain do SO.

### M3 — Anexos + imagens/OCR
- Como dev, screenshots anexados viram texto no bundle; se o tesseract não está instalado, o bundle sai mesmo assim com aviso e o `doctor` me diz exatamente como instalar no meu SO.

### M4 — Áudio e vídeo
- Como dev, screencasts e áudios viram transcrição; um comentário novo na issue **não** reprocessa o vídeo (cache); no MCP, anexos pesados chegam como `processing` e completam na chamada seguinte.

### M5 — Distribuição multi-OS
- Como dev em qualquer SO, `npx redmine-context` funciona sem toolchain de compilação; CI verde na matriz macOS/Linux/Windows.

### M6 — Bundle legível (ADR-006)
- **US1 — Nomes no lugar de códigos.** Como dev, leio o histórico sem decodificar números. ✔ nenhum `(#id)` nem id interno no bundle (asserção por regex); journal identificado por data local + autor; o que não resolve vira texto neutro; 403/404 nunca derrubam o bundle; cache quente segue < 30 s.
- **US2 — Fences por seção.** Como dev ou LLM, leio cada seção corrida, com a mesma proteção. ✔ uma `<untrusted-content>` por seção (bundle de referência: 26 → ≤ 8) + nota de topo; testes de fuga e de forja de estrutura passam.
- **US3 — Compatibilidade.** Como integrador, nada quebra. ✔ JSON `schema_version` 1.1 só aditivo; MCP × CLI byte-a-byte; replay verde com fixtures 6.x reais e variantes 4.x/5.x sintéticas.
- **US4 — Idioma.** Como dev de outro país, recebo os rótulos no meu idioma. ✔ pt-BR, en e es por env/config, padrão pt-BR; conteúdo da instância não é traduzido; catálogo com paridade testada.
- **US5 — Slash commands.** Como dev em qualquer harness MCP, digito `/issue 123`. ✔ prompts `issue`, `last`, `search` em `prompts/list` com nomes e argumentos congelados; harness sem prompts segue com as tools; matriz de suporte no README.
- **US6 — Ambiente reproduzível.** Como mantenedor, reproduzo os casos difíceis sem a instância real. ✔ seed Docker cria usuário bloqueado, CF removido, trocas de projeto/versão/categoria e anexo; E2E confere antes e depois.

## Métricas de sucesso

- Nº de issues reais processadas sem o dev abrir o Redmine no browser (meta M1: ≥ 3 consecutivas).
- Tempo issue→contexto no LLM < 30 s com cache quente (texto) / feedback imediato com `processing` (mídia).
- Instalação limpa nos 3 SOs sem erro de compilação.
- (M6) Zero id interno no bundle de referência; fences ≤ 8; 3 issues seedadas lidas sem decodificar número algum.

## Riscos de produto

- Qualidade do OCR/transcrição local pode frustrar (screenshots de UI, jargão) — bundle sempre referencia a mídia original como fallback.
- Instâncias corporativas com 2FA/SSO/self-signed — fluxos de fallback definidos no ADR-003.
- Latência de vídeo no MCP — mitigada por cache-first (ADR-004/005).
- (M6) Resolver nomes exige permissões variáveis por instância e papel — degradação para texto neutro; nomes de prompts viram API pública (ADR-006).

---

## Changelog

- **2026-07-21** — Criação. Consolida plano v2 do /plan:refine: revisão de 6 especialistas FlowForge, reordenação de milestones (MCP fino antecipado ao M1, TUI+keychain no M2 — decisão do usuário), resolução das 7 questões em aberto do draft.
- **2026-11-26** — Pós-MVP M6 "Bundle legível" (US1–US6), métricas e riscos. Motivo: o bundle exibia ids crus e uma fence por valor; consolidado no /plan:refine com 8 especialistas FlowForge. Decisões em ADR-006.
