/**
 * Tela de onboarding 3/3: login por usuário e senha (M2-05.1, issue #27).
 *
 * Dois campos (`TextInput`, `../../components/text-input.tsx`): usuário com
 * eco normal, senha mascarada (`mask="•"`, nunca ecoada em texto — ver
 * `text-input.tsx`). `Tab`/setas alternam o campo ativo — o `useInput()` do
 * Ink não tem noção de foco, então só um `TextInput` fica `isActive` por
 * vez, senão a mesma tecla digitaria nos dois campos ao mesmo tempo. Enter
 * no campo de usuário avança para a senha; Enter na senha confirma o
 * formulário: dispara `callbacks.onLoginSubmit` (wiring real a
 * `loginWithPassword` do core em `../../hooks/use-onboarding-callbacks.ts`,
 * #28), guarda a `Promise` resultante em `pendingLogin` (`OnboardingContext`)
 * e navega para `onboarding-validating`, que consome essa promise e decide a
 * próxima tela (splash de sucesso, fallback de api_key em 401/2FA, ou
 * mensagem de erro de rede).
 */
import { Box, Text, useInput } from 'ink';
import { useState, useCallback } from 'react';

import { TextInput } from '../../components/text-input.js';
import { useNavigation } from '../../navigation.js';
import { symbols } from '../../symbols.js';
import { useTheme } from '../../theme.js';
import { useOnboarding } from './onboarding-context.js';

/** Campo com foco no formulário — só um `TextInput` fica `isActive` por vez. */
type Field = 'username' | 'password';

/** Alterna entre os dois campos do formulário. */
function otherField(field: Field): Field {
  return field === 'username' ? 'password' : 'username';
}

/** Tela de onboarding: login por usuário/senha — Esc volta (atalho global, ver `../../app.tsx`). */
export function OnboardingLoginScreen() {
  const theme = useTheme();
  const { push } = useNavigation();
  const { callbacks, setPendingLogin } = useOnboarding();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [field, setField] = useState<Field>('username');

  // Handler estável — setField (setState) já tem identidade fixa; o useCallback
  // garante que o useInput subscreva uma única vez (padrão do repo).
  const handleFieldSwitch = useCallback((_input: string, key: { tab: boolean; downArrow: boolean; upArrow: boolean }) => {
    if (key.tab || key.downArrow || key.upArrow) {
      setField(otherField);
    }
  }, []);
  useInput(handleFieldSwitch);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor={theme.border}>
      <Text bold color={theme.primary}>
        Login no Redmine
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={field === 'username' ? theme.primary : theme.muted}>
            {field === 'username' ? symbols.pointer : ' '} Usuário:{' '}
          </Text>
          <TextInput
            value={username}
            onChange={setUsername}
            onSubmit={() => setField('password')}
            isActive={field === 'username'}
          />
        </Box>
        <Box>
          <Text color={field === 'password' ? theme.primary : theme.muted}>
            {field === 'password' ? symbols.pointer : ' '} Senha:{' '}
          </Text>
          <TextInput
            value={password}
            onChange={setPassword}
            onSubmit={() => {
              setPendingLogin(callbacks.onLoginSubmit({ username, password }));
              push('onboarding-validating');
            }}
            mask="•"
            isActive={field === 'password'}
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          <Text bold color={theme.accent}>
            Tab
          </Text>{' '}
          alterna o campo,{' '}
          <Text bold color={theme.accent}>
            Enter
          </Text>{' '}
          confirma,{' '}
          <Text bold color={theme.accent}>
            Esc
          </Text>{' '}
          volta.
        </Text>
      </Box>
    </Box>
  );
}
