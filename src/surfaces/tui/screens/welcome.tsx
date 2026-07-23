/**
 * Tela de boas-vindas da TUI — placeholder do scaffold M2-01, com hints para
 * `doctor`/`config` adicionados no M2-12 (#35).
 *
 * Mostra nome do produto + versão (via a superfície pública do core,
 * `../../../index.js`, ADR-005) e a dica de teclas. O capricho visual fica
 * para as telas seguintes; aqui o objetivo é um roteador limpo e extensível.
 * Cores vêm do tema central (M2-02, `useTheme()`) — nenhum literal de cor
 * aqui, ver `theme.ts` para o guideline de uso de cada token.
 */
import { Box, Text, useInput } from 'ink';

import { TOOL_NAME, TOOL_VERSION } from '../../../index.js';
import { useNavigation } from '../navigation.js';
import { useTheme } from '../theme.js';

/** Tela inicial do roteador: `?` atalhos, `d` doctor, `c` config, `q` sai (ver `app.tsx`). */
export function WelcomeScreen() {
  const { navigate } = useNavigation();
  const theme = useTheme();

  useInput((input, key) => {
    // Reason: o Ink reporta Ctrl+<letra> com o MESMO `input` da letra solta
    // (ex.: Ctrl+C chega como `input === 'c'`, `key.ctrl === true`) — sem essa
    // guarda, o atalho global de sair (duplo Ctrl+C, `app.tsx`) navegaria
    // para `config` por engano a cada Ctrl+C pressionado nesta tela.
    if (key.ctrl) {
      return;
    }
    if (input === '?') {
      navigate('about');
    }
    if (input === 'd') {
      navigate('doctor');
    }
    if (input === 'c') {
      navigate('config');
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        {TOOL_NAME}
      </Text>
      <Text color={theme.muted}>v{TOOL_VERSION}</Text>
      <Box marginTop={1}>
        <Text>Contexto completo de issues do Redmine, pronto para qualquer LLM.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          Pressione <Text bold color={theme.accent}>?</Text> para atalhos,{' '}
          <Text bold color={theme.accent}>d</Text> para o doctor,{' '}
          <Text bold color={theme.accent}>c</Text> para configuração,{' '}
          <Text bold color={theme.accent}>q</Text> para sair.
        </Text>
      </Box>
    </Box>
  );
}
