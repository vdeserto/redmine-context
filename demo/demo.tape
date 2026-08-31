# demo.tape — roteiro de gravação do demo (VHS: https://github.com/charmbracelet/vhs)
#
# Pré-requisitos:
#   brew install vhs
#   docker compose -f docker/docker-compose.yml up -d && docker/wait-for-healthy.sh
#   npm run seed        # cria as fixtures, incl. o anexo demo/fixture-error.png
#   npm run build
#
# Credencial (o ttyd herda o ambiente do processo vhs):
#   export REDMINE_API_KEY=$(curl -s -u admin:admin \
#     http://localhost:3080/users/current.json | python3 -c \
#     'import json,sys; print(json.load(sys.stdin)["user"]["api_key"])')
#
# Gravar (a partir da raiz do repo):
#   vhs demo/demo.tape
#
# Os blocos Hide/Show escondem o setup (env, alias) — o espectador só vê o
# comando limpo. O alias embute --insecure porque o Redmine de demo é http local.

Output demo/redmine-context.gif
Output demo/redmine-context.mp4

Set Shell "zsh"
Set FontSize 20
Set Width 1200
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

Hide
# REDMINE_URL/REDMINE_API_KEY vêm do ambiente de quem roda o vhs (ver cabeçalho).
Type "export REDMINE_URL=http://localhost:3080" Enter
Type "alias redmine-context='node dist/surfaces/cli/main.js --insecure'" Enter
Type "clear" Enter
Show

Sleep 800ms

# --- Ato 1: a issue tem um print anexado, e o print é opaco -------------------
# O recorte ancora em 'Nome:' porque o filename também aparece no histórico
# ("Anexo #2: ∅ → fixture-error.png") e um grep pelo nome puro pegaria aquela linha.
Type "# uma issue do Redmine com um print de erro anexado" Enter
Sleep 1s
Type "redmine-context issue 1 | grep -A3 'Nome:.*fixture-error'" Enter
Sleep 3s

Type "# o print é só um arquivo. o texto dentro dele some." Enter
Sleep 2s

Hide
Type "clear" Enter
Show

# --- Ato 2: o mesmo comando com --extract ------------------------------------
Type "redmine-context issue 1 --extract | grep -A14 'Nome:.*fixture-error'" Enter
Sleep 6s

Type "# o stack trace saiu de dentro da imagem." Enter
Sleep 2s
Type "# tesseract rodou na sua máquina. nada foi enviado pra lugar nenhum." Enter
Sleep 3s

Hide
Type "clear" Enter
Show

# --- Ato 3: o mesmo core dentro do seu LLM -----------------------------------
Type "# o mesmo contexto, dentro do Claude:" Enter
Sleep 1s
Type "claude mcp add redmine-context -- npx -y redmine-context mcp" Enter
Sleep 3s
