/**
 * Tela de detalhe de issue — PLACEHOLDER MÍNIMO (M2-06, #29).
 *
 * A #29 só precisa registrar a navegação para cá quando `Enter` é pressionado
 * sobre uma issue selecionada na home (`./home.js`); o detalhe real (bundle
 * completo da issue via o core) é escopo da #31, que deve substituir o corpo
 * deste componente. `b` (ou `Esc`, atalho global) volta para a home — mesmo
 * padrão de `pop()` das demais telas de detalhe/diagnóstico.
 */
import { Box, Text, useInput } from 'ink';

import { useNavigation } from '../navigation.js';
import { useTheme } from '../theme.js';

/** Tela de detalhe: placeholder até a #31. `b` (ou `Esc`) volta para a home. */
export function IssueDetailScreen() {
  const { pop } = useNavigation();
  const theme = useTheme();

  useInput((input) => {
    if (input === 'b') {
      pop();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Detalhe da issue
      </Text>
      <Box marginTop={1}>
        <Text color={theme.muted}>Ainda não implementado — chega na #31.</Text>
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
