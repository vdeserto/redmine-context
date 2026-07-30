---
"redmine-context": patch
---

Completa os metadados de publicação do `package.json`: `repository`, `homepage`,
`bugs`, `keywords`, `author` e `publishConfig` (`access: public`, `provenance:
true`). O `repository.url` é exigido pela validação de proveniência (SLSA/OIDC) do
`npm publish`; os demais melhoram a página e a descoberta do pacote no npm.
