/**
 * Tela de boas-vindas da TUI — placeholder do scaffold M2-01.
 *
 * Mostra nome do produto + versão (via a superfície pública do core,
 * `../../../index.js`, ADR-005) e a dica de teclas. O capricho visual fica
 * para as telas seguintes; aqui o objetivo é um roteador limpo e extensível.
 */
import { Box, Text, useInput } from 'ink';

import { TOOL_NAME, TOOL_VERSION } from '../../../index.js';
import { useNavigation } from '../navigation.js';

/** Tela inicial do roteador: `?` leva aos atalhos, `q` sai da TUI (ver `app.tsx`). */
export function WelcomeScreen() {
  const { navigate } = useNavigation();

  useInput((input) => {
    if (input === '?') {
      navigate('about');
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="magenta">
        {TOOL_NAME}
      </Text>
      <Text dimColor>v{TOOL_VERSION}</Text>
      <Box marginTop={1}>
        <Text>Contexto completo de issues do Redmine, pronto para qualquer LLM.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Pressione <Text bold>?</Text> para atalhos, <Text bold>q</Text> para sair.
        </Text>
      </Box>
    </Box>
  );
}
