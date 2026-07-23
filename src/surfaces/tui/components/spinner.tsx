/**
 * Spinner de terminal (#28) — indicador de "operação em andamento" para as
 * telas assíncronas do onboarding (`../screens/onboarding/validating.tsx`,
 * `../screens/onboarding/api-key.tsx`). Implementação própria, sem depender
 * de `@inkjs/ui` (ver `../theme.tsx`, mapeamento previsto): frames braille
 * (mesmo conjunto usado por spinners de terminal populares), avançados por um
 * `setInterval` simples.
 */
import { useEffect, useState } from 'react';
import { Text } from 'ink';

import { useTheme } from '../theme.js';

/** Sequência de frames braille do spinner — um giro completo por volta do array. */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** Intervalo (ms) entre frames — rápido o bastante para parecer fluido, sem sobrecarregar o terminal. */
export const SPINNER_INTERVAL_MS = 80;

/**
 * Spinner animado em `theme.primary` — usado inline junto de um rótulo (ex.:
 * `<Text><Spinner /> Validando credenciais...</Text>`).
 *
 * @example
 * <Text color={theme.primary}><Spinner /> Validando...</Text>
 */
export function Spinner() {
  const theme = useTheme();
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return <Text color={theme.primary}>{SPINNER_FRAMES[frameIndex]}</Text>;
}
