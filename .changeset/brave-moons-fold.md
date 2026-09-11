---
'redmine-context': patch
---

Moldura da TUI degrada para ASCII no terminal legado.

A borda `round` do shell usa box-drawing Unicode (`╭ ─ │ ╯`), que vira mojibake
no cmd.exe/PowerShell antigo — o mesmo problema que o projeto já tratava nos
frames braille do spinner, nas setas de navegação e no banner. A moldura era a
única peça que não acompanhava a política de glyphs.

Agora o estilo é decidido pelo MESMO sinal (`isUnicodeSupported`): `round` onde
há Unicode, `classic` (`+ - |`) onde não há.
