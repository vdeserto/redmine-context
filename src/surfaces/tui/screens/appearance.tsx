/**
 * Tela de APARÊNCIA — seletor de paleta de cores da TUI (#190).
 *
 * Lista as paletas (`../palettes.ts`) com PREVIEW AO VIVO: navegar com ↑/↓
 * aplica a paleta na hora (via `useThemeController().preview`, sem persistir),
 * `Enter` confirma e PERSISTE (`select`), `Esc` cancela e REVERTE para a paleta
 * original (via `useEscapeInterceptor`, que intercepta o Esc global antes do
 * `pop()`). Cada linha mostra swatches (blocos coloridos) dos tokens daquela
 * paleta — as cores vêm dos dados da paleta (variáveis), então nenhuma cor
 * literal aparece aqui (varredura anti-hardcode).
 */
import { useCallback, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { GradientText } from '../components/gradient-text.js';
import { useEscapeInterceptor } from '../hooks/use-escape-interceptor.js';
import { useNavigation } from '../navigation.js';
import { PALETTES } from '../palettes.js';
import { symbols } from '../symbols.js';
import { useTheme, useThemeController } from '../theme.js';

/** Índice da paleta com um dado id (0 se não achar). */
function indexOfPalette(id: string): number {
  const i = PALETTES.findIndex((p) => p.id === id);
  return i >= 0 ? i : 0;
}

/** Tela seletora de paleta com preview ao vivo, salvar (Enter) e cancelar (Esc). */
export function AppearanceScreen() {
  const { pop } = useNavigation();
  const theme = useTheme();
  const controller = useThemeController();

  const [index, setIndex] = useState(() => indexOfPalette(controller.paletteId));
  // Paleta ORIGINAL ao abrir a tela — restaurada no cancelamento (Esc).
  const originalRef = useRef(controller.paletteId);

  // Refs estáveis (padrão do repo: identidade nova des/re-subscreve o useInput e
  // perde teclas rápidas).
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const popRef = useRef(pop);
  popRef.current = pop;
  const indexRef = useRef(index);
  indexRef.current = index;

  const move = useCallback((delta: number) => {
    const next = (indexRef.current + delta + PALETTES.length) % PALETTES.length;
    setIndex(next);
    controllerRef.current.preview((PALETTES[next] as (typeof PALETTES)[number]).id);
  }, []);

  // Esc cancela: reverte para a paleta original e volta.
  useEscapeInterceptor(true, () => {
    controllerRef.current.preview(originalRef.current);
    popRef.current();
  });

  const handleInput = useCallback(
    (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean }) => {
      if (key.upArrow || input === 'k') {
        move(-1);
        return;
      }
      if (key.downArrow || input === 'j') {
        move(1);
        return;
      }
      if (key.return) {
        void controllerRef.current.select((PALETTES[indexRef.current] as (typeof PALETTES)[number]).id);
        popRef.current();
      }
    },
    [move],
  );
  useInput(handleInput);

  const gradient = theme.gradient ?? [theme.primary];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <GradientText colors={gradient}>{`Aparência ${symbols.pointerSmall} paleta de cores`}</GradientText>

      <Box marginTop={1} flexDirection="column">
        {PALETTES.map((palette, i) => {
          const selected = i === index;
          const t = palette.theme;
          const swatches = [t.primary, t.secondary ?? t.primary, t.accent, t.success, t.warning, t.danger];
          return (
            <Box key={palette.id}>
              <Box width={22}>
                <Text color={selected ? theme.primary : theme.muted} bold={selected}>
                  {selected ? symbols.pointer : ' '} {palette.label}
                </Text>
              </Box>
              {swatches.map((color, si) => (
                <Text key={si} backgroundColor={color}>
                  {'  '}
                </Text>
              ))}
              {palette.id === originalRef.current ? (
                <Text color={theme.muted}> {symbols.tick} atual</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted}>
          {symbols.arrowUp}/{symbols.arrowDown} pré-visualiza {symbols.pointerSmall}{' '}
          <Text bold color={theme.accent}>
            Enter
          </Text>{' '}
          salva {symbols.pointerSmall}{' '}
          <Text bold color={theme.accent}>
            Esc
          </Text>{' '}
          cancela
        </Text>
      </Box>
    </Box>
  );
}
