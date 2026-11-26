# ADR-006 — Bundle legível: nomes no lugar de códigos, fences por seção e idioma

**Status**: Proposto (2026-11-26)
**Relaciona**: complementa o ADR-005 (item 4, marcação untrusted) · substitui o item 3 do ADR-004 (chave da camada issue)

## Contexto

O bundle chega ao leitor (humano ou LLM) com códigos que ninguém decifra: `Atribuída (#7)`,
`#42` de um usuário que não aparece na issue, `campo #17`, `Journal #1001`, `Anexo #2002`.
O histórico do Redmine grava ids, e a issue só traz o nome do estado atual.

A marcação anti prompt-injection do ADR-005 é aplicada a cada valor. Um bundle real teve 26
fences `<untrusted-content>`, uma no nome e outra no valor de cada custom field e em cada lado de
cada alteração. A proteção funciona, mas a leitura fica ruim.

Restrições: a ferramenta lê instâncias 4.x, 5.x e 6.x, com usuários que não são admin
(`/users.json` e `/custom_fields.json` exigem admin), e roda em processos longos (TUI e MCP).

## Decisão

1. **Uma fence por seção**: assunto, descrição, custom fields, cada journal, relações, anexos e
   busca. Uma nota no topo do bundle explica a tag. O nome `<untrusted-content>` continua o mesmo,
   é neutro em idioma e compatível com quem já lê o bundle.
2. **Estrutura que não pode ser forjada**: dentro do bloco, cada valor externo fica numa linha
   só; notas de journal vêm citadas linha a linha (`> `); o cabeçalho do journal (data e autor,
   este sanitizado como no item 3) fica fora do bloco. A neutralização de fuga normaliza com
   NFKC e cobre atributos, sinais de menor e maior de largura cheia, entidades HTML e
   caracteres de largura zero.
3. **Dois níveis de confiança**: nomes de enumerações que só o admin define (status, tracker,
   prioridade) podem ficar fora da fence. Nomes que usuários ou gerentes editam (usuário,
   projeto, versão, categoria, custom field) passam por sanitização (uma linha, sem caracteres
   de controle ou bidi, tamanho limitado, fuga neutralizada) quando saem fora da fence, e
   nunca são marcados como confiáveis.
4. **Nomes, nunca números**: some o `(#id)`. O que não puder ser resolvido aparece como texto
   neutro ("usuário removido", "(valor não resolvido)"). Referências que as pessoas usam
   aparecem de forma discreta: `#123 — assunto` para issue e `arquivo.mp4 (id 2002)` para anexo,
   porque a tool `get_attachment_text` precisa desse id.
5. **Resolução em camadas, sempre com degradação**: payload da issue → enumerações da
   instância → memberships do projeto → versões e categorias do projeto → `/users/:id`, com
   concorrência e tempo limitados → assuntos das issues relacionadas numa só chamada. 401, 403
   e 404 nunca derrubam o bundle. A busca na rede fica em `src/client`, numa única função do
   core usada pelo bundle e pela TUI. A renderização em `src/bundle` continua pura.
6. **Memoização**: só sucesso é guardado, com TTL. Falha tenta de novo depois de um intervalo
   curto. A chave inclui a instância e um hash da credencial, porque a visibilidade de usuários
   depende do papel. De usuários e memberships só se guarda `{id, nome}`; resposta crua nunca é
   persistida.
7. **JSON 1.1, só aditivo**: `*_display` ao lado de `old_value`/`new_value`, `value_display` em
   custom field, `subject` em pai e relações. Os campos da 1.0 continuam iguais. O determinismo
   passa a valer para "mesmo estado + mesmas resoluções".
8. **Chave da camada issue do cache (substitui o item 3 do ADR-004)**: quando essa camada for
   ligada, a chave será
   `(instance_hash, credential_hash, issue_id, updated_on, format, lang, schema_version, tool_version)`,
   com TTL menor ou igual ao dos dicionários. A credencial entra na chave pelo mesmo motivo do
   item 6: nomes resolvidos por uma credencial não podem ser servidos a outra. Renomear um
   usuário ou status não muda o `updated_on` da issue. A alternativa aceita é guardar só a
   issue normalizada e renderizar de novo a cada chamada.
9. **Idioma no core**: catálogo de rótulos próprios em pt-BR, en e es, com o idioma como entrada
   das funções do core. Precedência: variável de ambiente > config > pt-BR. Conteúdo da
   instância não é traduzido.
10. **MCP prompts como API pública**: os slash commands vêm de prompts MCP, agnósticos de
    harness, com nomes em inglês e congelados como os das tools (`issue`, `last`, `search`).
    Novo argumento opcional é mudança minor; renomear, remover ou tornar um argumento
    obrigatório é major. O conteúdo do Redmine entra no prompt cercado e depois das nossas
    instruções.

## Consequências

- (+) O bundle se lê sem decifrar números, com a mesma proteção contra prompt injection e muito
  menos ruído.
- (+) Uma única fonte de nomes para o bundle, o JSON e a TUI.
- (+) Os prompts funcionam em qualquer cliente MCP que os suporte; quem não suporta continua
  com as tools.
- (−) Mais chamadas à instância por issue, limitadas por memo, concorrência e orçamento de tempo.
- (−) O mesmo estado da issue pode gerar bundles diferentes conforme as permissões da credencial.
- (−) Nomes de prompts e argumentos passam a ser contrato público.
