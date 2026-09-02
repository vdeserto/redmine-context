/**
 * Banner multi-linha com gradiente HORIZONTAL (#190 — pacote estético).
 *
 * Diferença para {@link GradientText}: aquele interpola por CARACTERE ao longo de
 * uma string única — passar uma arte multi-linha a ele faria a ramp escorrer
 * pelas quebras de linha e sair na diagonal, com cada linha começando numa cor
 * diferente. Aqui a ramp é calculada UMA vez pela largura da arte e aplicada por
 * COLUNA: a coluna `x` tem a mesma cor em todas as linhas, que é o que faz o
 * logo ler como um objeto só.
 *
 * Reutiliza `rampColors` de `./gradient-text.js` — a interpolação é a mesma, só
 * muda o eixo. Nenhuma cor literal aqui: a ramp vem do tema (varredura
 * `no-hardcoded-colors`).
 *
 * Contraste: as paradas de cor são as da paleta ativa (claras e escuras já vêm
 * calibradas em `../palettes.ts`), então o banner herda o contraste do tema em
 * vez de impor um seu. Sem `bold` — o atributo derruba o fg truecolor em alguns
 * terminais (ver a nota em `./gradient-text.tsx`).
 */
import { Box, Text } from 'ink';

import { rampColors } from './gradient-text.js';

/**
 * Renderiza linhas de arte ASCII com gradiente por coluna.
 *
 * @param props.lines - Linhas da arte (mesma fonte, alturas iguais).
 * @param props.colors - Ramp de cores (hex) da paleta ativa; vazia ⇒ sem cor.
 * @returns O banner, ou `null` quando não há linhas (variante `plain`).
 * @example
 * <GradientBanner lines={bannerLines('wide')} colors={theme.gradient ?? []} />
 */
export function GradientBanner({
  lines,
  colors,
}: {
  lines: readonly string[];
  colors: readonly string[];
}) {
  if (lines.length === 0) return null;

  const width = Math.max(...lines.map((line) => [...line].length));
  const ramp = rampColors(colors, width);

  return (
    <Box flexDirection="column">
      {lines.map((line, row) => (
        <Text key={row}>
          {[...line].map((ch, col) => (
            // Espaço não recebe cor: evita pintar o "fundo" da arte e mantém o
            // banner legível também em paleta clara.
            <Text key={col} {...(ch === ' ' || ramp.length === 0 ? {} : { color: ramp[col] as string })}>
              {ch}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
