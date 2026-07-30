---
"redmine-context": patch
---

Polish de legibilidade da TUI full-screen (#190): as cores da paleta agora são
aplicadas ao terminal via **OSC 10/11** (fg/bg), então o texto fica legível tanto
em terminal **claro** quanto **escuro**; **12 paletas** (8 escuras + 4 claras) com
tokens `text`/`background`. Removido o atributo **negrito** de toda a interface —
em alguns terminais (ex.: Terminal.app) o negrito ignorava a cor e virava preto
ilegível; o destaque agora vem só da cor + a setinha de seleção. Atalhos
**ancorados no rodapé** (estilo nano/nvim/tmux) e descrição que **cresce para
preencher a tela**. Anexos extraíveis (imagem/PDF/áudio/vídeo/OOXML) passam a
exibir **"pendente"** em vez de "não suportado".
