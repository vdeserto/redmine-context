/**
 * Tela de atalhos da TUI — placeholder do scaffold M2-01.
 *
 * Existe também para provar o roteador: `?` na tela de boas-vindas navega até
 * aqui, `b` volta — a troca de componente é o que o teste de render valida.
 * Cores vêm do tema central (M2-02, `useTheme()`) — nenhum literal de cor
 * aqui, ver `theme.ts` para o guideline de uso de cada token.
 */
import { Box, Text, useInput } from 'ink';

import { useNavigation } from '../navigation.js';
import { useTheme } from '../theme.js';

/** Lista de atalhos conhecidos pela TUI (crescerá conforme novas telas chegam). */
const SHORTCUTS: Array<{ key: string; description: string }> = [
  { key: '?', description: 'abre esta tela' },
  { key: 'b', description: 'volta para a tela anterior' },
  { key: 'q', description: 'sai da TUI' },
];

/** Tela de atalhos: `b` volta para a tela de boas-vindas (ver `app.tsx`). */
export function AboutScreen() {
  const { navigate } = useNavigation();
  const theme = useTheme();

  useInput((input) => {
    if (input === 'b') {
      navigate('welcome');
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Atalhos
      </Text>
      <Box marginTop={1} flexDirection="column">
        {SHORTCUTS.map((shortcut) => (
          <Text key={shortcut.key}>
            <Text bold color={theme.accent}>
              {shortcut.key}
            </Text>{' '}
            {shortcut.description}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          Pressione{' '}
          <Text bold color={theme.accent}>
            b
          </Text>{' '}
          para voltar.
        </Text>
      </Box>
    </Box>
  );
}
