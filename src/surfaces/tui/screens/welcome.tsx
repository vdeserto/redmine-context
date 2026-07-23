/**
 * Tela de boas-vindas da TUI — scaffold M2-01, com hints de doctor/config
 * (M2-12, #35) e o ponto de entrada do onboarding (M2-05.1, #27).
 *
 * Mostra nome do produto + versão (via a superfície pública do core,
 * `../../../index.js`, ADR-005) e a dica de teclas. Cores vêm do tema
 * central (M2-02, `useTheme()`) — nenhum literal de cor aqui, ver
 * `theme.ts` para o guideline de uso de cada token.
 */
import { useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import { TOOL_NAME, TOOL_VERSION } from '../../../index.js';
import { useNavigation } from '../navigation.js';
import { useTheme } from '../theme.js';

/**
 * Tela inicial do roteador: `Enter` inicia o onboarding (M2-05.1), `?`
 * atalhos, `d` doctor, `c` config, `q` sai (ver `app.tsx`).
 */
export function WelcomeScreen() {
  const { navigate } = useNavigation();
  const theme = useTheme();

  // Handler estável (useCallback+refs) — mesmo padrão do TextInput/app.tsx:
  // identidade nova por render des/re-subscreve o useInput e perde teclas.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const handleInput = useCallback((input: string, key: { return: boolean; ctrl: boolean }) => {
    // Reason: o Ink reporta Ctrl+<letra> com o MESMO `input` da letra solta
    // (ex.: Ctrl+C chega como `input === 'c'`, `key.ctrl === true`) — sem essa
    // guarda, o atalho global de sair (duplo Ctrl+C, `app.tsx`) navegaria
    // para `config` por engano a cada Ctrl+C pressionado nesta tela.
    if (key.ctrl) {
      return;
    }
    if (input === '?') {
      navigateRef.current('about');
      return;
    }
    if (key.return) {
      navigateRef.current('onboarding-url');
    }
    if (input === 'd') {
      navigateRef.current('doctor');
    }
    if (input === 'c') {
      navigateRef.current('config');
    }
  }, []);
  useInput(handleInput);

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
          Pressione <Text bold color={theme.accent}>Enter</Text> para configurar o acesso ao Redmine,{' '}
          <Text bold color={theme.accent}>?</Text> para atalhos,{' '}
          <Text bold color={theme.accent}>d</Text> para o doctor,{' '}
          <Text bold color={theme.accent}>c</Text> para configuração,{' '}
          <Text bold color={theme.accent}>q</Text> para sair.
        </Text>
      </Box>
    </Box>
  );
}
