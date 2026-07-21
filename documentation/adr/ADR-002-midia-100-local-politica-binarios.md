# ADR-002 — Extração de mídia 100% local + política híbrida de binários

**Status**: Aceito (2026-07-21)

## Contexto

Anexos de issues (screenshots, áudios, screencasts) carregam contexto essencial. O usuário decidiu por processamento 100% local (privacidade/offline) — sem APIs de nuvem. Isso exige ffmpeg, whisper.cpp e tesseract presentes em 3 SOs, o que é a premissa mais cara do projeto. Ambientes corporativos bloqueiam egress e exigem auditoria; download silencioso de executáveis é vetor de supply chain.

## Decisão

1. Extração local: tesseract (OCR, traineddata `por+eng` default), whisper.cpp (transcrição, modelo GGUF auto-detect de idioma com override), ffmpeg (vídeo → faixa de áudio + 1 keyframe representativo; sem frames+OCR no MVP).
2. **Degradação graciosa obrigatória**: o bundle sempre é gerado; anexo não processável entra com metadados + motivo. Nenhum binário é pré-requisito.
3. Política híbrida de obtenção: default = comando `doctor` detecta PATH/locais convencionais e imprime instrução de instalação por SO (brew/apt/winget). Download automático **somente opt-in** (`--download-binaries`), apenas onde existe artefato estático oficial (ffmpeg BtbN, whisper.cpp releases), com SHA-256 pinado no código, URL fixa, `.part` + rename atômico; nunca no MCP headless. Tesseract no Windows: só instrução (`winget install UB-Mannheim.TesseractOCR`).
4. Anexos tratados como input hostil: MIME por magic bytes, limites (100 MB anexo / 20 min vídeo, configuráveis; estourou → pula com aviso), timeout + kill, `-protocol_whitelist file` no ffmpeg.

## Consequências

- (+) Privacidade total; funciona offline; auditável em ambiente corporativo.
- (+) Ferramenta utilizável mesmo sem nenhum binário (texto-only).
- (−) Qualidade inferior a APIs de nuvem (OCR em screenshots de UI, jargão em transcrições) — mitigado com metadados de confiança e referência à mídia original no bundle.
- (−) Matriz de QA multi-OS é o maior custo do projeto; CI nos 3 SOs necessária.
