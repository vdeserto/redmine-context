/**
 * Roteador de telas da TUI (M2-01, evoluído em M2-04 para pilha + casca
 * visual global).
 *
 * `App` só instancia os providers (tema, pilha de navegação) — quem de fato
 * consome o contexto e renderiza a casca visual (breadcrumb fixo, aviso de
 * saída, tela atual) é `AppShell`, um componente à parte porque precisa
 * estar DENTRO dos providers para poder chamar `useTheme()`/`useNavigation()`.
 *
 * Atalhos globais (qualquer tela): `q` sai, `Esc` volta (`pop()` da pilha,
 * ver `navigation.tsx`), `Ctrl+C` segue o padrão de duas pressões (ver
 * `hooks/use-exit-guard.ts`). `/` era reservado (no-op) para a busca antes
 * da M2-07 existir; a semântica real agora vive na home (`screens/home.tsx`,
 * que registra seu PRÓPRIO `useInput` para `/`) — o handler global permanece
 * no-op aqui, o que automaticamente CONTINUA bloqueando `/` em qualquer tela
 * que não seja a home (nenhuma outra tela trata essa tecla).
 *
 * Fix do review do PR #119: `Esc` numa tela `onboarding-*` enquanto um
 * re-auth (M2-13, #36) está em andamento (`OnboardingContext.reAuth`) passa
 * a significar ABANDONO explícito do re-login, em vez do `pop()` simples de
 * sempre — sem isso, a `Promise` do `guard()` original
 * (`hooks/use-auth-guard.ts`) ficaria pendurada para sempre. Nesse caso:
 * `abortReAuth()` rejeita as pendências com `ReAuthAbortedError` e a
 * navegação volta direto para a tela de ORIGEM do 401 (`popTo`,
 * `navigation.tsx`) em vez de só desempilhar uma tela por vez.
 *
 * M2-07 (#30): `Esc` no campo de busca da home precisa fechar a busca em vez
 * de desempilhar a home inteira — `consumeEscapeInterceptor()`
 * (`hooks/use-escape-interceptor.ts`) é consultado ANTES do `pop()` padrão;
 * se a home registrou um interceptor (busca aberta), ele é quem trata o Esc
 * e o `pop()`/abandono de re-auth abaixo é pulado nesse ciclo.
 */
import { useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { Breadcrumb } from './components/breadcrumb.js';
import { ReAuthAbortedError } from './hooks/use-auth-guard.js';
import { consumeEscapeInterceptor } from './hooks/use-escape-interceptor.js';
import { useExitGuard } from './hooks/use-exit-guard.js';
import { useOnboardingCallbacks } from './hooks/use-onboarding-callbacks.js';
import { NavigationProvider, useNavigation, useNavigationStack } from './navigation.js';
import {
  OnboardingProvider,
  useOnboarding,
  type OnboardingReAuth,
} from './screens/onboarding/onboarding-context.js';
import { INITIAL_SCREEN, SCREENS, type ScreenName } from './screen.js';
import { symbols } from './symbols.js';
import { ThemeProvider, useTheme } from './theme.js';

/**
 * O que `Esc` deve fazer dado o estado atual — extraída como função pura
 * (fix do review #119) para poder ser testada isoladamente
 * (`tests/surfaces/tui/app.test.tsx`) sem precisar montar toda a árvore do
 * Ink nem depender de uma tela de dados real (#29+) para chegar no estado de
 * re-auth ativo.
 */
export type EscapeAction = { kind: 'abort-reauth'; origin: ScreenName } | { kind: 'pop' };

/**
 * Decide a ação de `Esc`: abandono do re-auth (fix do review #119) quando a
 * tela atual é do fluxo de onboarding (`onboarding-*`) E há um `reAuth` em
 * andamento; `pop()` simples em qualquer outro caso (comportamento original,
 * M2-04).
 */
export function resolveEscapeAction(
  current: ScreenName,
  reAuth: OnboardingReAuth | undefined,
): EscapeAction {
  if (reAuth !== undefined && current.startsWith('onboarding-')) {
    return { kind: 'abort-reauth', origin: reAuth.origin };
  }
  return { kind: 'pop' };
}

/**
 * App raiz da TUI: só monta os providers (tema, pilha de navegação,
 * onboarding — M2-05.1). `OnboardingProvider` recebe os callbacks REAIS de
 * `useOnboardingCallbacks` (#28) — o wiring com o core (`loginWithPassword`,
 * `validateApiKey`, credential cascade) vive só ali, nunca nas telas em si
 * (ADR-005).
 */
export function App() {
  const navigation = useNavigationStack(INITIAL_SCREEN);
  const onboardingCallbacks = useOnboardingCallbacks();

  return (
    <ThemeProvider>
      <NavigationProvider value={navigation}>
        <OnboardingProvider callbacks={onboardingCallbacks}>
          <AppShell />
        </OnboardingProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}

/**
 * Casca visual do app: breadcrumb fixo + aviso de saída (quando armado) +
 * tela atual. Só existe dentro dos providers de `App` — depende de
 * `useTheme()`/`useNavigation()`.
 */
function AppShell() {
  const { exit } = useApp();
  const { current, pop, popTo, stack } = useNavigation();
  const { reAuth, abortReAuth } = useOnboarding();
  const theme = useTheme();
  const { armed } = useExitGuard(exit);

  // Handler ESTÁVEL (refs + useCallback): identidade nova a cada render faz o
  // useInput des/re-subscrever no efeito pós-commit, abrindo janelas em que
  // teclas rápidas (Esc em sequência) se perdem — mesma classe de bug
  // corrigida no TextInput.
  const exitRef = useRef(exit);
  exitRef.current = exit;
  const popRef = useRef(pop);
  popRef.current = pop;
  const popToRef = useRef(popTo);
  popToRef.current = popTo;
  const currentRef = useRef(current);
  currentRef.current = current;
  const reAuthRef = useRef(reAuth);
  reAuthRef.current = reAuth;
  const abortReAuthRef = useRef(abortReAuth);
  abortReAuthRef.current = abortReAuth;
  const handleGlobalInput = useCallback((input: string, key: { escape: boolean }) => {
    if (input === 'q') {
      exitRef.current();
      return;
    }

    if (key.escape) {
      // M2-07 (#30): a busca da home intercepta Esc para fechar o campo em
      // vez de desempilhar a tela — consultado ANTES de qualquer outra
      // semântica de Esc (pop/abandono de re-auth).
      if (consumeEscapeInterceptor()) {
        return;
      }
      // Fix do review #119: Esc numa tela de onboarding com um re-auth ativo
      // é ABANDONO explícito — aborta as pendências (rejeita o(s) `guard()`
      // original(is) com `ReAuthAbortedError`) e volta direto à tela de
      // origem do 401, em vez do `pop()` simples de sempre.
      const action = resolveEscapeAction(currentRef.current, reAuthRef.current);
      if (action.kind === 'abort-reauth') {
        abortReAuthRef.current(new ReAuthAbortedError());
        popToRef.current(action.origin);
        return;
      }
      popRef.current();
      return;
    }

    if (input === '/') {
      // Reason: reservado para a busca (M2-07, ainda sem tela) — no-op
      // proposital para já travar a tecla e evitar que outra tela reaproveite
      // "/" para algo diferente antes da tela de busca existir.
      return;
    }
  }, []);
  useInput(handleGlobalInput);

  const Screen = SCREENS[current].component;

  return (
    <Box flexDirection="column">
      <Breadcrumb stack={stack} />
      {armed ? (
        <Box paddingX={1} marginBottom={1}>
          <Text color={theme.warning}>{symbols.warning} Pressione Ctrl+C de novo para sair.</Text>
        </Box>
      ) : null}
      <Screen />
    </Box>
  );
}
