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
 *
 * M2-13 (issue #36) acrescenta o MODO RE-AUTH (`reAuth`/`beginReAuth`/
 * `resolveReAuth`/`abortReAuth`): quando uma tela de dados (#29+) recebe um
 * 401 (`RedmineAuthError`) numa chamada ao core, ela usa
 * `../../hooks/use-auth-guard.ts` para empilhar `onboarding-login` de novo,
 * reaproveitando este mesmo fluxo de login para o usuário reautenticar sem
 * perder o que estava fazendo — ver o JSDoc de `useAuthGuard` para o
 * contrato completo consumido pelas telas de dados, e `validating.tsx`/
 * `api-key.tsx` para onde o sucesso do re-login é detectado e a operação
 * original retomada.
 *
 * Fix do review do PR #119: dois 401 concorrentes (duas telas de dados, ou
 * a mesma tela com duas chamadas em voo) podem cair em re-auth ao mesmo
 * tempo — em vez de o segundo `beginReAuth` sobrescrever silenciosamente o
 * primeiro (perdendo seu retry/reject para sempre), `reAuth` agora acumula
 * uma LISTA de pendências (`pending`); uma única passagem de login bem
 * sucedida atende todas elas (`resolveReAuth`). Esc durante o re-login
 * (`../../app.tsx`) agora também tem uma saída explícita: `abortReAuth`
 * rejeita todas as pendências em vez de deixar a(s) `Promise`(s) do
 * `guard()` penduradas para sempre.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

import type { ScreenName } from '../../screen.js';

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

/**
 * Uma pendência individual de re-auth (fix do review #119) — um par
 * retry/reject correspondente a UMA chamada de `guard()`
 * (`../../hooks/use-auth-guard.ts`) que recebeu 401. `OnboardingReAuth`
 * acumula uma lista destas: com dois 401 concorrentes, ambas as pendências
 * são atendidas por uma única passagem de login (`resolveReAuth`) ou
 * canceladas juntas (`abortReAuth`).
 */
export interface OnboardingReAuthPending {
  /**
   * Reexecuta a operação original que falhou com 401. Chamado automaticamente
   * por `resolveReAuth()` quando o login é refeito com sucesso — nenhuma tela
   * precisa chamá-lo diretamente.
   */
  retry: () => void;
  /**
   * Rejeita a `Promise` de `guard()` correspondente a esta pendência com o
   * motivo do abandono (tipicamente `ReAuthAbortedError`,
   * `../../hooks/use-auth-guard.ts`). Chamado automaticamente por
   * `abortReAuth()` — nenhuma tela precisa chamá-lo diretamente.
   */
  reject: (reason: Error) => void;
}

/**
 * Estado de um fluxo de re-autenticação em andamento (M2-13, issue #36) —
 * criado por `useAuthGuard` (`../../hooks/use-auth-guard.ts`) ao capturar um
 * `RedmineAuthError` (401) numa operação de uma tela de dados (#29+).
 */
export interface OnboardingReAuth {
  /**
   * Tela que estava ativa quando o PRIMEIRO 401 deste ciclo aconteceu — a
   * navegação volta para ela (`popTo`, `../../navigation.tsx`) assim que o
   * re-login for concluído (com sucesso) ou abandonado (Esc). Pendências
   * subsequentes (401 concorrentes) reaproveitam esta mesma origem — a TUI
   * só sustenta uma tela de dados ativa por vez, então não há origem
   * divergente de fato.
   */
  origin: ScreenName;
  /**
   * Todas as pendências acumuladas desde que o modo re-auth foi ativado
   * (fix do review #119) — ver {@link OnboardingReAuthPending}.
   */
  pending: readonly OnboardingReAuthPending[];
}

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
  /**
   * Fluxo de re-autenticação em andamento (M2-13, issue #36), ou `undefined`
   * fora dele. Consumido por `validating.tsx`/`api-key.tsx` para desviar do
   * caminho normal de sucesso (splash) e, em vez disso, retomar a operação de
   * origem — ver {@link OnboardingReAuth}.
   */
  reAuth: OnboardingReAuth | undefined;
  /**
   * Inicia (ou ADICIONA a) o modo re-auth — chamado por `useAuthGuard()`
   * (`../../hooks/use-auth-guard.ts`), nunca diretamente pelas telas.
   *
   * Fix do review #119: se já houver um `reAuth` ativo (401 concorrente),
   * `pending` é apenas ACRESCENTADO à lista existente — a `origin` recebida
   * aqui é ignorada nesse caso (a origem do ciclo já foi fixada na primeira
   * chamada) — uma única passagem de login atende todas as pendências.
   * Senão, ativa o modo com `origin` e uma lista iniciada só com `pending`.
   *
   * @returns `true` se este chamado ATIVOU o modo re-auth (nenhum estava em
   *   andamento antes) — o chamador (`useAuthGuard`) usa isso para decidir
   *   se deve empilhar `onboarding-login` (só na primeira vez; pendências
   *   subsequentes reaproveitam a tela já empilhada).
   */
  beginReAuth: (origin: ScreenName, pending: OnboardingReAuthPending) => boolean;
  /**
   * Encerra o modo re-auth com SUCESSO: dispara `retry()` de TODAS as
   * pendências acumuladas (fix do review #119 — antes só a mais recente era
   * atendida) e limpa o estado. Chamado por `validating.tsx`/`api-key.tsx`
   * quando o re-login resolve com `{ kind: 'success' }` enquanto `reAuth`
   * está definido. No-op se não houver `reAuth` em andamento.
   */
  resolveReAuth: () => void;
  /**
   * Encerra o modo re-auth com ABANDONO (fix do review #119 — Esc durante o
   * re-login, ver `../../app.tsx`): rejeita TODAS as pendências acumuladas
   * com `reason` (tipicamente `ReAuthAbortedError`,
   * `../../hooks/use-auth-guard.ts`) e limpa o estado — sem isso, a(s)
   * `Promise`(s) de `guard()` ficariam penduradas para sempre. No-op se não
   * houver `reAuth` em andamento.
   */
  abortReAuth: (reason: Error) => void;
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
  const [reAuth, setReAuth] = useState<OnboardingReAuth | undefined>(undefined);

  // Ref espelhando `reAuth` (fix do review #119): `beginReAuth` precisa
  // decidir SINCRONAMENTE (para devolver o `boolean` de ativação ao
  // chamador) se já existe um ciclo em andamento, mas o setter funcional do
  // `useState` só executa o callback no próximo render — não dá pra
  // confiar nele para essa decisão. A ref é a única fonte de verdade
  // síncrona; `setReAuth` continua sendo chamado em paralelo só para
  // provocar o re-render de quem lê `reAuth` do contexto.
  const reAuthRef = useRef<OnboardingReAuth | undefined>(undefined);

  // Handlers estáveis (useCallback) — mesmo padrão dos demais hooks da TUI
  // (ver `../../hooks/use-exit-guard.ts`): identidade fixa evita
  // re-subscrições desnecessárias em quem os usa como dependência de efeito.
  const beginReAuth = useCallback((origin: ScreenName, pending: OnboardingReAuthPending): boolean => {
    const current = reAuthRef.current;
    if (current !== undefined) {
      // Já em andamento (401 concorrente) — apenas acrescenta à lista,
      // mantendo a origem original.
      const next: OnboardingReAuth = { origin: current.origin, pending: [...current.pending, pending] };
      reAuthRef.current = next;
      setReAuth(next);
      return false;
    }
    const next: OnboardingReAuth = { origin, pending: [pending] };
    reAuthRef.current = next;
    setReAuth(next);
    return true;
  }, []);
  const resolveReAuth = useCallback(() => {
    const current = reAuthRef.current;
    reAuthRef.current = undefined;
    setReAuth(undefined);
    current?.pending.forEach((item) => {
      item.retry();
    });
  }, []);
  const abortReAuth = useCallback((reason: Error) => {
    const current = reAuthRef.current;
    reAuthRef.current = undefined;
    setReAuth(undefined);
    current?.pending.forEach((item) => {
      item.reject(reason);
    });
  }, []);

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
    reAuth,
    beginReAuth,
    resolveReAuth,
    abortReAuth,
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
