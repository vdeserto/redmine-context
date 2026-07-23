/**
 * Estado local do fluxo de onboarding (M2-05.1, issue #27, evoluído na #28)
 * URL da instância + modo de autenticação + a resolução do login, tudo
 * compartilhado entre as telas do fluxo (`url.tsx` → `mode.tsx` →
 * `login.tsx`/`api-key.tsx` → `validating.tsx` → `success.tsx`) sem
 * prop-drilling — como toda tela do roteador é renderizada sem props
 * (`../../screen.ts`), o único jeito de uma tela passar estado para a
 * próxima é via contexto.
 *
 * Os callbacks de submissão (`onUrlSubmit`, `onModeSelect`, `onLoginSubmit`,
 * `onApiKeySubmit`) são injetáveis, todos no-op por padrão — o wiring real
 * (chamada a `loginWithPassword`/`validateApiKey` do core + persistência via
 * `MigratingCredentialCascade`) vive em `../../hooks/use-onboarding-callbacks.ts`,
 * o único ponto que importa o core para este fluxo (ADR-005); quem instancia
 * o provider com os callbacks reais é `../../app.tsx`.
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

/** Identidade mínima do usuário autenticado — nunca inclui a api_key. */
export interface OnboardingUser {
  /** Id numérico do usuário no Redmine. */
  id: number;
  /** Login do usuário. */
  login: string;
  /** Nome de exibição (`firstname lastname`, ou `login` se ausentes). */
  name: string;
}

/**
 * Resultado de uma tentativa de login (por senha ou api_key colada),
 * classificado pelo que a tela de validação (`validating.tsx`) precisa
 * decidir: mostrar a splash de sucesso, oferecer o fallback de api_key
 * (401/2FA), ou mostrar uma mensagem de erro acionável (rede/TLS).
 */
export type OnboardingLoginOutcome =
  | { kind: 'success'; user: OnboardingUser }
  | { kind: 'auth-error'; message: string }
  | { kind: 'network-error'; message: string };

/** Callbacks de submissão injetáveis — todos no-op por padrão (wiring real na #28, ver topo do arquivo). */
export interface OnboardingCallbacks {
  /** Chamado quando a URL é validada (esquema) e confirmada (Enter na tela de URL). */
  onUrlSubmit: (url: string) => void;
  /** Chamado quando o usuário escolhe um modo de autenticação. */
  onModeSelect: (mode: OnboardingMode) => void;
  /**
   * Chamado quando o formulário de login (usuário/senha) é confirmado.
   * Resolve para o {@link OnboardingLoginOutcome} — consumido por
   * `validating.tsx` via `pendingLogin`.
   */
  onLoginSubmit: (credentials: OnboardingLoginCredentials) => Promise<OnboardingLoginOutcome>;
  /**
   * Chamado quando uma api_key colada é confirmada (`api-key.tsx`) — valida
   * a key contra o Redmine ANTES de salvar.
   */
  onApiKeySubmit: (apiKey: string) => Promise<OnboardingLoginOutcome>;
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
  /**
   * Promise do login em andamento — definida por `login.tsx` ao confirmar o
   * formulário (via `callbacks.onLoginSubmit`) e consumida por
   * `validating.tsx`, que decide a próxima tela a partir do
   * {@link OnboardingLoginOutcome} resolvido. `undefined` fora desse fluxo.
   */
  pendingLogin: Promise<OnboardingLoginOutcome> | undefined;
  /** Atualiza `pendingLogin`. */
  setPendingLogin: (pending: Promise<OnboardingLoginOutcome>) => void;
  /** Usuário autenticado com sucesso — preenchido por `validating.tsx`/`api-key.tsx`, exibido em `success.tsx`. */
  user: OnboardingUser | undefined;
  /** Atualiza `user`. */
  setUser: (user: OnboardingUser) => void;
  /** Callbacks de submissão injetáveis (ver {@link OnboardingCallbacks}). */
  callbacks: OnboardingCallbacks;
}

/** Callbacks padrão: no-op — usados quando `<OnboardingProvider>` não recebe `callbacks`. */
const NOOP_CALLBACKS: OnboardingCallbacks = {
  onUrlSubmit: () => undefined,
  onModeSelect: () => undefined,
  onLoginSubmit: () =>
    Promise.resolve({ kind: 'network-error', message: 'onLoginSubmit não configurado.' }),
  onApiKeySubmit: () =>
    Promise.resolve({ kind: 'network-error', message: 'onApiKeySubmit não configurado.' }),
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
 * qualquer tela `onboarding-*`.
 */
export function OnboardingProvider({ callbacks = NOOP_CALLBACKS, children }: OnboardingProviderProps) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<OnboardingMode | undefined>(undefined);
  const [pendingLogin, setPendingLogin] = useState<Promise<OnboardingLoginOutcome> | undefined>(
    undefined,
  );
  const [user, setUser] = useState<OnboardingUser | undefined>(undefined);

  const value: OnboardingValue = {
    url,
    setUrl,
    mode,
    setMode,
    pendingLogin,
    setPendingLogin,
    user,
    setUser,
    callbacks,
  };

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

/**
 * Hook de onboarding consumido pelas telas `url.tsx`/`mode.tsx`/`login.tsx`/
 * `api-key.tsx`/`validating.tsx`/`success.tsx`.
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
