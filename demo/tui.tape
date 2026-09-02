# tui.tape — gravação da TUI para a seção "TUI interativa" do README.
#
# Pré-requisitos: `npm run build` (a TUI roda do dist/) e um terminal LARGO —
# o banner só entra na variante `wide` a partir de 121 colunas (ver
# ../src/surfaces/tui/banner.ts). Com menos, a gravação sai com a arte empilhada,
# que também é válida, mas não é a que ilustra melhor.
#
# Gravar (a partir da raiz do repo):
#   vhs demo/tui.tape

Output demo/tui.gif

Set Shell "zsh"
Set FontSize 13
Set Width 1400
Set Height 620
Set Padding 8
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

Hide
Type "cd $(git rev-parse --show-toplevel) && clear" Enter
Show

Sleep 500ms
Type "redmine-context" Enter
Sleep 3s

# Aparência: a paleta é trocada ao vivo, e o banner acompanha o gradiente.
Type "a"
Sleep 2s
Down
Sleep 1500ms
Down
Sleep 1500ms
Down
Sleep 2s
Escape
Sleep 2s
