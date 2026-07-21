# ADR-004 — Cache local em duas camadas com isolamento por instância

**Status**: Aceito (2026-07-21)

## Contexto

Reprocessar um vídeo de 10 minutos a cada chamada inviabiliza o MCP. A chave ingênua (`updated_on` da issue) invalida extrações caras quando apenas um comentário é adicionado. `attachment.id` só é único por instância Redmine — suporte multi-instância exige namespace. Attachments são imutáveis no Redmine (novo upload = novo id); Redmine 4.x+ expõe `digest` no JSON do attachment.

## Decisão

1. Layout em disco: `<cache_dir>/<instance_hash>/attachments/<id>-<digest8>/{original.ext, extraction.json}` + `index.json` por instância, onde `instance_hash` = SHA-256 truncado da URL base normalizada. `cache_dir` por SO via `env-paths`.
2. **Camada attachment (extrações, caras)**: chave `(instance_hash, attachment_id, digest, extractor_version + model + params)`. Fallback de digest para instâncias antigas: `(id, filesize, created_on)`. Trocar modelo whisper/versão do extrator invalida corretamente; comentários novos nunca invalidam.
3. **Camada issue (bundle/metadados, baratos)**: chave `(issue_id, updated_on)` — rebuild reutiliza 100% das extrações da camada de baixo.
4. Lock por chave (evita dois processos extraindo o mesmo anexo); GC com limite default 2 GB, LRU por `last_accessed_at`, quota agressiva para originais (recuperáveis do Redmine) e conservadora para extrações (caras). Índice JSON no MVP; SQLite só se houver necessidade comprovada.
5. Nomes em disco derivados de `id+digest`, nunca do filename do anexo (anti path-traversal).

## Consequências

- (+) Vídeo nunca reprocessa por edição de comentário; multi-instância sem colisão; melhoria de pipeline reprocessa sozinha.
- (+) MCP cache-first viável: responde com o que está pronto + `status: processing`.
- (−) Dois níveis de invalidação para manter coerentes; cobertos por testes (cenário "comentário novo não reprocessa mídia" é critério de aceitação do M3/M4).
