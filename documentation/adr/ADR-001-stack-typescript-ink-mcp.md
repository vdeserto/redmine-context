# ADR-001 — Stack: TypeScript/Node ≥ 20 + Ink + MCP SDK

**Status**: Aceito (2026-07-21)

## Contexto

O redmine-context precisa rodar em macOS, Linux e Windows, oferecer uma TUI de alta qualidade visual (requisito de produto), expor um MCP server e orquestrar binários externos de mídia. Alternativas avaliadas: Python (melhor ecossistema ML/mídia, distribuição multi-OS mais difícil), Go/Rust (binário único, SDKs MCP menos maduros, desenvolvimento de TUI rica mais lento).

## Decisão

TypeScript sobre Node ≥ 20 (fetch nativo), com:
- `@modelcontextprotocol/sdk` para o MCP server (stdio);
- Ink + `@inkjs/ui` para a TUI (mesma base do Claude Code), complementados por `ink-task-list` e `figures`;
- binários de mídia (ffmpeg, whisper.cpp, tesseract) orquestrados via `execFile` (nunca shell);
- distribuição via npm/npx.

## Consequências

- (+) SDK MCP oficial maduro; distribuição `npx` uniforme nos 3 SOs; TUI React componentizável com tema central.
- (+) Zero toolchain de compilação para o usuário no M1 (deps nativas só a partir do M2, com prebuilds).
- (−) Processamento de mídia depende de binários externos — mitigado por detecção + `doctor` + degradação graciosa (ver ADR-002).
- (−) Cold start do `npx` com muitas deps; monitorar tamanho do pacote.
