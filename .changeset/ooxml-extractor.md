---
"redmine-context": minor
---

Extração de texto de documentos Office (OOXML) — `.docx`, `.pptx`, `.xlsx` — 100% local e **sem binário externo** (não entra no `doctor`, funciona nos 3 SOs sem instalar nada). Antes esses anexos saíam como `unsupported`. Leitor ZIP zero-dependência (via `node:zlib`) + extração de texto por dialeto, com scanner linear (sem ReDoS), orçamento anti-zip-bomb e degradação graciosa.
