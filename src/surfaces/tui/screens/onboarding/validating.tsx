/**
 * Tela de onboarding: validando o login por senha (#28) — consome a
 * `pendingLogin` (promise) guardada em `OnboardingContext` por `login.tsx` ao
 * confirmar o formulário, mostra um spinner enquanto ela resolve, e decide a
 * próxima tela a partir do `OnboardingLoginOutcome`:
 *
 * - `success` → grava `user` no contexto e segue para a splash (`replace`,
 *   troca o topo da pilha — a tela de validação é transitória, não faz
 *   sentido voltar a ela).
 * - `auth-error` (401/2FA, ADR-003) → oferece o fallback de colar api_key
 *   (`replace('onboarding-api-key')`).
 * - `network-error` (rede/TLS) → fica nesta tela mostrando a mensagem em
 *   `theme.danger`, sem stack, com a próxima ação sugerida; `Esc` (atalho
 *   global, `../../app.tsx`) volta para o formulário de login para tentar de
 *   novo.
 *
 * M2-13 (issue #36): quando o sucesso acontece com um fluxo de re-auth em
 * andamento (`OnboardingContext.reAuth`, empilhado por
 * `../../hooks/use-auth-guard.ts` após um 401 numa tela de dados), o caminho
 * de sucesso é DIFERENTE — em vez da splash, a navegação volta à tela de
 * origem (`popTo`) e a operação original é retomada automaticamente
 * (`resolveReAuth()`, que dispara o `retry` guardado no contexto).
 */
import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';

import { Spinner } from '../../components/spinner.js';
import { useNavigation } from '../../navigation.js';
import { symbols } from '../../symbols.js';
import { useTheme } from '../../theme.js';
import { useOnboarding } from './onboarding-context.js';

/** Sugestão de próxima ação para erros de rede/TLS (ex.: CA interna). */
const NETWORK_ERROR_HINT =
  'Se a instância usa uma CA interna, configure NODE_EXTRA_CA_CERTS apontando para o certificado. Verifique também a URL e a conexão de rede.';

export function OnboardingValidatingScreen() {
  const theme = useTheme();
  const { replace, popTo } = useNavigation();
  const { pendingLogin, setUser, reAuth, resolveReAuth } = useOnboarding();
  const [networkError, setNetworkError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (pendingLogin === undefined) {
      return;
    }
    let cancelled = false;
    pendingLogin
      .then((outcome) => {
        if (cancelled) {
          return;
        }
        if (outcome.kind === 'success') {
          setUser(outcome.user);
          if (reAuth !== undefined) {
            // M2-13 (#36): volta à tela de origem e retoma a operação
            // original — não passa pela splash (esse re-login é invisível
            // para o fluxo da tela de dados que o disparou).
            popTo(reAuth.origin);
            resolveReAuth();
            return;
          }
          replace('onboarding-success');
          return;
        }
        if (outcome.kind === 'auth-error') {
          replace('onboarding-api-key');
          return;
        }
        setNetworkError(outcome.message);
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        // Reason: defesa em profundidade — `onLoginSubmit` (ver
        // `../../hooks/use-onboarding-callbacks.ts`) já converte qualquer
        // falha num `OnboardingLoginOutcome` resolvido, mas um callback
        // injetado incorretamente (ex.: em teste) pode rejeitar a promise.
        setNetworkError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [pendingLogin, replace, popTo, reAuth, resolveReAuth, setUser]);

  if (networkError !== undefined) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor={theme.border}>
        <Text color={theme.danger}>
          {symbols.cross} Não foi possível entrar
        </Text>
        <Box marginTop={1}>
          <Text color={theme.danger}>{networkError}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.danger}>{NETWORK_ERROR_HINT}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>
            Pressione{' '}
            <Text color={theme.accent}>
              Esc
            </Text>{' '}
            para voltar e tentar novamente.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor={theme.border}>
      <Text color={theme.primary}>
        <Spinner /> Validando credenciais...
      </Text>
    </Box>
  );
}
