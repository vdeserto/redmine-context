/**
 * Callbacks REAIS do onboarding (#28) — fecha o wiring entre as telas de
 * onboarding (`../screens/onboarding/`) e o core: login por senha
 * (`loginWithPassword`), validação de api_key colada (`validateApiKey`, o
 * fallback de 2FA do ADR-003) e persistência via a cascata de credenciais M2
 * (`createCredentialCascade` — keychain preferido, com migração automática).
 *
 * Único ponto de import do core para o fluxo de onboarding (ADR-005): as
 * telas em si (`../screens/onboarding/*.tsx`) só recebem os callbacks
 * injetados via `<OnboardingProvider callbacks={...}>` (`../app.tsx`) — nunca
 * importam `../../../index.js` diretamente.
 *
 * Mantém uma cópia local da URL (via o callback `onUrlSubmit`, atualizado a
 * cada submissão da tela de URL) porque o `OnboardingContext` só existe
 * DEPOIS deste hook rodar (`<OnboardingProvider callbacks={...}>` recebe os
 * callbacks como prop) — não há como este hook consumir `useOnboarding()`
 * sem um ciclo de dependência.
 */
import { useRef } from 'react';

import { createCredentialCascade, loginWithPassword, validateApiKey, RedmineAuthError } from '../../../index.js';
import type {
  OnboardingCallbacks,
  OnboardingLoginCredentials,
  OnboardingLoginOutcome,
} from '../screens/onboarding/onboarding-context.js';

/**
 * Interpreta `REDMINE_INSECURE` (`1`/`true`, case-insensitive) — mesma
 * convenção usada por `../screens/onboarding/url.tsx` e pelo MCP
 * (`../../mcp/server.ts`).
 */
function isInsecureEnvSet(env: NodeJS.ProcessEnv): boolean {
  const raw = env.REDMINE_INSECURE;
  return raw !== undefined && /^(1|true)$/i.test(raw.trim());
}

/** Extrai uma mensagem segura de uma falha desconhecida — o core já redige segredos antes de lançar. */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Monta os callbacks reais de onboarding — injetados em
 * `<OnboardingProvider callbacks={...}>` por `../app.tsx`.
 *
 * @example
 * const callbacks = useOnboardingCallbacks();
 * return <OnboardingProvider callbacks={callbacks}>...</OnboardingProvider>;
 */
export function useOnboardingCallbacks(): OnboardingCallbacks {
  // Ref (não state): a URL só é lida dentro dos callbacks de login/api_key,
  // nunca precisa disparar um re-render por si só.
  const urlRef = useRef('');

  const onUrlSubmit = (url: string): void => {
    urlRef.current = url;
  };

  const onModeSelect = (): void => {
    // Reason: o modo escolhido só direciona a NAVEGAÇÃO entre telas
    // (`../screens/onboarding/mode.tsx`) — nenhuma chamada ao core depende
    // dele, então não há estado a guardar aqui.
  };

  const onLoginSubmit = async (
    credentials: OnboardingLoginCredentials,
  ): Promise<OnboardingLoginOutcome> => {
    try {
      const result = await loginWithPassword({
        baseUrl: urlRef.current,
        username: credentials.username,
        password: credentials.password,
        insecure: isInsecureEnvSet(process.env),
      });
      await createCredentialCascade().set(urlRef.current, result.apiKey);
      return { kind: 'success', user: result.user };
    } catch (cause) {
      if (cause instanceof RedmineAuthError) {
        return { kind: 'auth-error', message: cause.message };
      }
      return { kind: 'network-error', message: messageOf(cause) };
    }
  };

  const onApiKeySubmit = async (apiKey: string): Promise<OnboardingLoginOutcome> => {
    try {
      const result = await validateApiKey({
        baseUrl: urlRef.current,
        apiKey,
        insecure: isInsecureEnvSet(process.env),
      });
      await createCredentialCascade().set(urlRef.current, result.apiKey);
      return { kind: 'success', user: result.user };
    } catch (cause) {
      if (cause instanceof RedmineAuthError) {
        return { kind: 'auth-error', message: cause.message };
      }
      return { kind: 'network-error', message: messageOf(cause) };
    }
  };

  return { onUrlSubmit, onModeSelect, onLoginSubmit, onApiKeySubmit };
}
