/**
 * Tela de onboarding: colar api_key diretamente (#28) — alcançável de dois
 * jeitos: (1) escolha direta na tela de modo (`mode.tsx`, opção "Colar uma
 * api_key"), ou (2) fallback automático quando o login por senha falha com
 * 401/2FA (`validating.tsx` faz `replace('onboarding-api-key')`, ADR-003).
 *
 * Campo único mascarado (mesmo `TextInput` do login por senha, `mask="•"` —
 * a key nunca é ecoada em texto). Ao confirmar, a key é VALIDADA contra
 * `GET /users/current.json` (via `callbacks.onApiKeySubmit`, wiring real em
 * `../../hooks/use-onboarding-callbacks.ts`) ANTES de ser persistida —
 * mesma disciplina do login por senha (nunca salva sem confirmar que a
 * credencial funciona). Estado assíncrono gerenciado localmente (mesmo
 * padrão de `../config.tsx` no fluxo de logout): idle → validating → error,
 * com spinner próprio (`../../components/spinner.tsx`) durante a validação.
 *
 * M2-13 (issue #36): esta tela também é o fallback de 2FA (`validating.tsx`,
 * `replace('onboarding-api-key')`) quando o login por senha de um re-auth
 * falha com 401 — então o sucesso aqui também precisa checar
 * `OnboardingContext.reAuth` e, se definido, voltar à tela de origem
 * (`popTo`) e retomar a operação original (`resolveReAuth()`) em vez de
 * seguir para a splash.
 */
import { Box, Text } from 'ink';
import { useState } from 'react';

import { Spinner } from '../../components/spinner.js';
import { TextInput } from '../../components/text-input.js';
import { glyphs } from '../../glyphs.js';
import { useNavigation } from '../../navigation.js';
import { symbols } from '../../symbols.js';
import { useTheme } from '../../theme.js';
import { useOnboarding } from './onboarding-context.js';

/** Estágio do fluxo de validação desta tela. */
type Status = 'idle' | 'validating' | 'error';

/** Tela de onboarding: colar api_key — Enter valida e confirma, Esc volta (atalho global, ver `../../app.tsx`). */
export function OnboardingApiKeyScreen() {
  const theme = useTheme();
  const { replace, popTo } = useNavigation();
  const { callbacks, setUser, reAuth, resolveReAuth } = useOnboarding();
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  function handleSubmit(value: string): void {
    setStatus('validating');
    setErrorMessage(undefined);
    callbacks.onApiKeySubmit(value).then(
      (outcome) => {
        if (outcome.kind === 'success') {
          setUser(outcome.user);
          if (reAuth !== undefined) {
            // M2-13 (#36): volta à tela de origem e retoma a operação
            // original — ver o mesmo desvio em `validating.tsx`.
            popTo(reAuth.origin);
            resolveReAuth();
            return;
          }
          replace('onboarding-success');
          return;
        }
        setStatus('error');
        setErrorMessage(outcome.message);
      },
      (cause: unknown) => {
        // Reason: defesa em profundidade — `onApiKeySubmit` (ver
        // `../../hooks/use-onboarding-callbacks.ts`) já converte qualquer
        // falha num `OnboardingLoginOutcome` resolvido; isso só protege
        // contra um callback injetado incorretamente (ex.: em teste).
        setStatus('error');
        setErrorMessage(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor={theme.border}>
      <Text bold color={theme.primary}>
        Colar api_key
      </Text>
      <Box marginTop={1}>
        <Text color={theme.muted}>{symbols.pointer} api_key: </Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          onSubmit={handleSubmit}
          mask={glyphs.maskBullet}
          isActive={status !== 'validating'}
        />
      </Box>
      {status === 'validating' ? (
        <Box marginTop={1}>
          <Text color={theme.primary}>
            <Spinner /> Validando api_key...
          </Text>
        </Box>
      ) : null}
      {status === 'error' && errorMessage !== undefined ? (
        <Box marginTop={1}>
          <Text color={theme.danger}>
            {symbols.cross} {errorMessage}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.muted}>
          Pressione{' '}
          <Text bold color={theme.accent}>
            Enter
          </Text>{' '}
          para confirmar,{' '}
          <Text bold color={theme.accent}>
            Esc
          </Text>{' '}
          para voltar.
        </Text>
      </Box>
    </Box>
  );
}
