# ADR-003 — Autenticação: login interativo → api_key → keychain do SO

**Status**: Aceito (2026-07-21)

## Contexto

Usuários comuns de Redmine não têm/conhecem API key (o próprio usuário do projeto não tem). Exigir API key na configuração inviabiliza a adoção. A API REST do Redmine aceita Basic auth e retorna a `api_key` do usuário autenticado em `GET /users/current.json`. Instâncias com 2FA rejeitam Basic auth; instâncias corporativas frequentemente usam certificado self-signed.

## Decisão

1. Fluxo principal: login interativo (usuário/senha mascarada) → Basic auth → `GET /users/current.json` → extrai `api_key` → senha descartada imediatamente (nunca persistida/logada) → chamadas subsequentes via header `X-Redmine-API-Key` (fallback `?key=` para proxies que removem headers).
2. Persistência da api_key em cascata: keychain do SO (@napi-rs/keyring — macOS Keychain / Windows Credential Manager / libsecret; a partir do M2) → fallback arquivo com permissão 0600 em diretório 0700 (verificada no boot; usado no M1 e em musl) → env var (CI/MCP headless, sempre aceita).
3. 2FA/SSO: fallback com prompt para colar a api_key obtida em `/my/account`.
4. TLS: `https://` obrigatório por default; CA interna via `--ca-file`/`NODE_EXTRA_CA_CERTS`; `--insecure` apenas opt-in explícito e ruidoso.

## Consequências

- (+) Onboarding sem fricção para quem nunca viu uma API key; MCP/CI continuam headless via env.
- (+) api_key nunca exposta em env de subprocessos de mídia; logs com redação.
- (−) Dependência nativa do keyring exige prebuilds por plataforma (optionalDependencies) — fallback arquivo cobre plataformas sem prebuild.
- (−) Basic auth falha com 2FA — coberto pelo fluxo de colar a key manualmente.
