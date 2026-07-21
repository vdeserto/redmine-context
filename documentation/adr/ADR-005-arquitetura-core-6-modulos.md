# ADR-005 — Arquitetura: core de 6 módulos + superfícies finas + contrato de progresso

**Status**: Aceito (2026-07-21)

## Contexto

Três superfícies (TUI Ink stateful, CLI one-shot, MCP request/response) consomem a mesma lógica. Sem um contrato único, a TUI vazaria lógica para dentro dos componentes e o MCP não teria respostas parciais. Extração de mídia é longa (minutos) e o MCP stdio é single-process. Auth/config/cache são transversais e não pertencem a nenhuma camada de negócio.

## Decisão

Core com 6 módulos:
1. **REST client Redmine** — fetch nativo, `include=journals,attachments,relations,children`, paginação, retry/backoff.
2. **Normalização** — modelo estável `Issue`/`Journal`/`Attachment`; journals com `details[]` brutos (status history); custom fields `{id, name, value, raw_value, field_format?}` sem coerção de tipo não confirmada; watchers opcionais com degradação em 403.
3. **Pipeline de extração** — dispatcher por magic bytes; extratores plugáveis; fila de jobs com concorrência limitada (núcleos−1), timeout, cancelamento.
4. **Bundle** — Markdown + JSON com `schema_version`, determinístico (ordenações declaradas, `generated_at` fora do corpo canônico → snapshots byte-idênticos); conteúdo derivado marcado como não confiável (`<untrusted-content>` / `untrusted: true`) contra prompt injection.
5. **Config/Auth/Credential store** — resolução de credencial em cascata, config, `doctor`.
6. **Cache** — contrato próprio get/put/invalidate/lock/GC (ADR-004).

Superfícies finas consomem o core via **`AsyncIterable<ProgressEvent | Result>`**: a TUI renderiza progresso incremental, a CLI imprime, o MCP agrega (cache-first). Nenhuma superfície acessa módulo interno diretamente.

## Consequências

- (+) Um único caminho de execução, três consumidores; core testável sem UI/MCP.
- (+) Fila de jobs resolve vídeo longo sem bloquear TUI nem MCP (gargalo é o binário externo; `execFile` não bloqueia o event loop — não é preciso worker pool próprio).
- (−) Contrato de eventos exige disciplina desde o M1 (mesmo texto-only) para não retrofitar depois.
