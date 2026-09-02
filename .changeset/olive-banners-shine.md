---
'redmine-context': minor
---

Pacote estético da TUI: banner ASCII, barra de progresso e moldura.

**Banner na tela de abertura.** O nome do produto passa a ser desenhado em arte
ASCII com o gradiente da paleta ativa. A arte é constante (`src/surfaces/tui/banner.ts`)
em vez de gerada em runtime: o texto é sempre o mesmo, então uma dependência de
fontes custaria peso no pacote e tempo de boot sem entregar nada.

Três variantes, escolhidas pela largura do terminal e pelo suporte a Unicode:
`wide` (121 colunas, uma linha) → `stacked` (61 colunas, duas linhas) → `ascii`
(63 colunas, ASCII puro) → `plain` (sem arte). O sinal de Unicode é o mesmo que
já degrada os frames braille do spinner no terminal legado do Windows — sem ele,
os blocos do ANSI Shadow virariam mojibake.

O nome continua presente em TEXTO junto da versão: a arte é decorativa e
ilegível para leitor de tela.

**Barra de progresso nos jobs.** O `Job` já carregava `progress`, mas a tela só
mostrava o status textual — a extração de mídia (OCR, ffmpeg, whisper) roda em
background sem dar noção de quanto falta. As células da barra entram no conjunto
central de glyphs, com fallback `#`/`-`.

**Moldura da aplicação.** Borda arredondada na cor do tema, no shell comum — as
telas não sabem que existe uma.

Contraste: todas as cores vêm da paleta ativa. As quatro paletas claras usam
gradientes saturados e permanecem legíveis mesmo sobre fundo escuro (o pior
caso, quando a paleta não casa com o terminal).
