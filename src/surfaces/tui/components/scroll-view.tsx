/**
 * Viewport rolável genérico (#31): janela de `height` linhas sobre um array
 * `lines` potencialmente maior, sem quebrar o layout da tela que o usa (a
 * altura ocupada na tela é sempre `height`, mesmo perto do fim do conteúdo).
 *
 * Extraído como componente próprio (em vez de embutido em
 * `../screens/issue-detail.tsx`) porque a mecânica de rolagem — deslocar um
 * `offset` sobre um array já "achatado" em linhas, com wrap NÃO permitido
 * (ao contrário de `../hooks/use-list-navigation.ts`, que dá a volta nas
 * pontas) — é genérica o suficiente para qualquer tela futura com conteúdo
 * maior que a viewport (a #31 é a primeira consumidora: descrição + journals
 * da issue).
 *
 * Teclado: `j`/seta para baixo desce 1 linha, `k`/seta para cima sobe 1
 * linha, `PageDown`/`PageUp` deslocam uma página inteira (`height` linhas) de
 * uma vez. Nas duas pontas o `offset` apenas CLAMPA (não há wrap — rolar
 * "além" do topo/fundo não faz sentido para uma leitura linear de texto).
 *
 * `lines` já deve conter os elementos PRONTOS (tipicamente `<Text key=.../>`
 * ou `<Box key=.../>`) — o componente só decide QUAIS `height` delas mostrar
 * a cada momento; formatação/estilo de cada linha é responsabilidade de quem
 * monta o array (ver `../screens/issue-detail.tsx`).
 */
import { Box, Text, useInput } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';

import { symbols } from '../symbols.js';
import { useTheme } from '../theme.js';

/** Props do `ScrollView`. */
export interface ScrollViewProps {
  /**
   * Linhas de conteúdo, uma por posição — cada item já é o elemento completo
   * da linha (ex.: `<Text key={...}>...</Text>`), COM `key` próprio (o
   * componente as renderiza diretamente, sem reatribuir chaves).
   */
  lines: ReactNode[];
  /** Altura da janela visível, em linhas. */
  height: number;
  /**
   * Desativa a captura de teclado desta viewport (ex.: um overlay/modal por
   * cima está ativo). Default `true`.
   */
  isActive?: boolean;
}

/** Clampa `offset` para `[0, maxOffset]` — sem wrap (ver o JSDoc do módulo). */
function clampOffset(offset: number, maxOffset: number): number {
  if (maxOffset <= 0) return 0;
  if (offset < 0) return 0;
  if (offset > maxOffset) return maxOffset;
  return offset;
}

/**
 * Viewport rolável de `height` linhas sobre `lines`. Ver o JSDoc do módulo
 * para o contrato completo de teclado/props.
 *
 * @example
 * <ScrollView lines={rows} height={10} />
 */
export function ScrollView({ lines, height, isActive = true }: ScrollViewProps) {
  const theme = useTheme();
  const maxOffset = Math.max(lines.length - height, 0);
  const [offset, setOffset] = useState(0);

  // Reclampa quando o conteúdo muda de tamanho (ex.: issue recarregada via
  // retry) para não deixar a janela apontando além do novo fim.
  useEffect(() => {
    setOffset((current) => clampOffset(current, maxOffset));
  }, [maxOffset]);

  useInput(
    (input, key) => {
      if (key.pageDown) {
        setOffset((current) => clampOffset(current + height, maxOffset));
        return;
      }
      if (key.pageUp) {
        setOffset((current) => clampOffset(current - height, maxOffset));
        return;
      }
      if (key.downArrow || input === 'j') {
        setOffset((current) => clampOffset(current + 1, maxOffset));
        return;
      }
      if (key.upArrow || input === 'k') {
        setOffset((current) => clampOffset(current - 1, maxOffset));
      }
    },
    { isActive },
  );

  const visible = lines.slice(offset, offset + height);
  const canScroll = lines.length > height;
  const atTop = offset <= 0;
  const atBottom = offset >= maxOffset;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" height={height}>
        {visible}
      </Box>
      {canScroll ? (
        <Box>
          <Text color={theme.muted}>
            {atTop ? ' ' : symbols.arrowUp} {offset + 1}-{offset + visible.length}/{lines.length}{' '}
            {atBottom ? ' ' : symbols.arrowDown}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
