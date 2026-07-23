/**
 * Estado local do fluxo de onboarding (M2-05.1, issue #27): URL da
 * instância + modo de autenticação escolhido, compartilhados entre as três
 * telas (`url.tsx` → `mode.tsx` → `login.tsx`) sem prop-drilling — como
 * toda tela do roteador é renderizada sem props (`../../screen.ts`), o
 * único jeito de uma tela passar estado para a próxima é via contexto.
 *
 * Este contexto é DELIBERADAMENTE burro: guarda só `{ url, mode }` e expõe
 * callbacks de submissão injetáveis (`onUrlSubmit`, `onModeSelect`,
 * `onLoginSubmit`), todos no-op por padrão. A validação real da URL contra
 * o core, a chamada a `loginWithPassword` e a persistência via
 * `MigratingCredentialCascade` são a #28 — quem fizer esse wiring passa os
 * callbacks reais para `<OnboardingProvider callbacks={...}>` em `../../app.tsx`.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

/** Modo de autenticação escolhido na tela de modo (`mode.tsx`). */
export type OnboardingMode = 'password' | 'api-key';

/** Credenciais coletadas na tela de login (`login.tsx`). */
export interface OnboardingLoginCredentials {
  /** Usuário/login digitado (eco normal). */
  username: string;
  /** Senha digitada (mascarada na tela, nunca ecoada em texto). */
  password: string;
}

/** Callbacks de submissão injetáveis — todos no-op por padrão (wiring real na #28). */
export interface OnboardingCallbacks {
  /** Chamado quando a URL é validada (esquema) e confirmada (Enter na tela de URL). */
  onUrlSubmit: (url: string) => void;
  /** Chamado quando o usuário escolhe um modo de autenticação. */
  onModeSelect: (mode: OnboardingMode) => void;
  /** Chamado quando o formulário de login (usuário/senha) é confirmado. */
  onLoginSubmit: (credentials: OnboardingLoginCredentials) => void;
}

/** Valor exposto pelo contexto de onboarding. */
export interface OnboardingValue {
  /** URL digitada na tela de URL — sobrevive à navegação para trás (Esc). */
  url: string;
  /** Atualiza a URL — ligado diretamente ao `onChange` do `TextInput` da tela de URL. */
  setUrl: (url: string) => void;
  /** Modo de autenticação escolhido, ou `undefined` antes da tela de modo. */
  mode: OnboardingMode | undefined;
  /** Atualiza o modo escolhido. */
  setMode: (mode: OnboardingMode) => void;
  /** Callbacks de submissão injetáveis (ver {@link OnboardingCallbacks}). */
  callbacks: OnboardingCallbacks;
}

/** Callbacks padrão: no-op — usados quando `<OnboardingProvider>` não recebe `callbacks`. */
const NOOP_CALLBACKS: OnboardingCallbacks = {
  onUrlSubmit: () => undefined,
  onModeSelect: () => undefined,
  onLoginSubmit: () => undefined,
};

const OnboardingContext = createContext<OnboardingValue | undefined>(undefined);

/** Props do `OnboardingProvider`. */
export interface OnboardingProviderProps {
  /** Callbacks reais de submissão (injetados pela #28); no-op por padrão. */
  callbacks?: OnboardingCallbacks;
  children: ReactNode;
}

/**
 * Provider do contexto de onboarding — instanciado uma vez em `../../app.tsx`,
 * envolvendo toda a árvore de telas (não só as de onboarding), para que
 * `useOnboarding()` esteja sempre disponível quando o roteador troca para
 * `onboarding-url`/`onboarding-mode`/`onboarding-login`.
 */
export function OnboardingProvider({ callbacks = NOOP_CALLBACKS, children }: OnboardingProviderProps) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<OnboardingMode | undefined>(undefined);

  const value: OnboardingValue = { url, setUrl, mode, setMode, callbacks };

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

/**
 * Hook de onboarding consumido pelas telas `url.tsx`/`mode.tsx`/`login.tsx`.
 *
 * @throws {Error} Se chamado fora de um `<OnboardingProvider>` — indica erro
 *   de composição (tela renderizada sem passar pelo roteador).
 */
export function useOnboarding(): OnboardingValue {
  const value = useContext(OnboardingContext);
  if (value === undefined) {
    throw new Error('useOnboarding() usado fora de <OnboardingProvider>.');
  }
  return value;
}
