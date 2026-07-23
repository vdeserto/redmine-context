/**
 * Tela de onboarding: sucesso (#28) — splash comemorativa mostrando o usuário
 * autenticado (`OnboardingContext.user`, preenchido por `validating.tsx`/
 * `api-key.tsx` ao concluir com sucesso).
 *
 * Único lugar da TUI onde um capricho visual mais forte é permitido pelo
 * guideline do tema (`../../theme.tsx`): borda DUPLA + `theme.accent` em
 * destaque, para marcar visualmente a conclusão do fluxo — em qualquer outra
 * tela isso seria decoração em excesso (o guideline pede moderação com
 * `accent`), mas aqui é o clímax de um fluxo que só acontece uma vez por
 * instância configurada.
 *
 * `Enter` segue para a home (M2-06, #29) com a PILHA ZERADA (`resetTo`) —
 * sem telas do onboarding sobrando por baixo para um Esc alcançar. A home é
 * o destino pós-onboarding: lista "minhas issues" com a credencial recém
 * salva.
 */
import { Box, Text, useInput } from 'ink';
import { useCallback, useRef } from 'react';

import { useNavigation } from '../../navigation.js';
import { symbols } from '../../symbols.js';
import { useTheme } from '../../theme.js';
import { useOnboarding } from './onboarding-context.js';

/** Tela de onboarding: sucesso — `Enter` segue para a home (pilha zerada via `resetTo`). */
export function OnboardingSuccessScreen() {
  const theme = useTheme();
  const { resetTo } = useNavigation();
  const { user } = useOnboarding();

  // Handler ESTÁVEL (useCallback + refs, padrão do repo — ver text-input.tsx/app.tsx):
  // identidade nova a cada render des/re-subscreve o useInput e pode perder um Enter rápido.
  const resetToRef = useRef(resetTo);
  resetToRef.current = resetTo;
  const handleInput = useCallback((_input: string, key: { return: boolean }) => {
    if (key.return) {
      resetToRef.current('home');
    }
  }, []);
  useInput(handleInput);

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      paddingX={3}
      paddingY={1}
      borderStyle="double"
      borderColor={theme.accent}
    >
      <Text bold color={theme.accent}>
        {symbols.star} Login concluído com sucesso! {symbols.star}
      </Text>
      <Box marginTop={1}>
        <Text bold color={theme.primary}>
          {symbols.tick} Bem-vindo{user !== undefined ? `, ${user.name}` : ''}!
        </Text>
      </Box>
      {user !== undefined ? (
        <Box>
          <Text color={theme.muted}>Usuário: {user.login}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.muted}>
          Pressione{' '}
          <Text bold color={theme.accent}>
            Enter
          </Text>{' '}
          para começar.
        </Text>
      </Box>
    </Box>
  );
}
