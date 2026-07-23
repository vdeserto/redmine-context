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
 * `hooks/use-exit-guard.ts`), `/` está reservado para a busca (M2-07) —
 * registrado aqui como no-op para não ser usado por engano por outra tela
 * antes da tela de busca existir.
 */
import { useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { Breadcrumb } from './components/breadcrumb.js';
import { useExitGuard } from './hooks/use-exit-guard.js';
import { useOnboardingCallbacks } from './hooks/use-onboarding-callbacks.js';
import { NavigationProvider, useNavigation, useNavigationStack } from './navigation.js';
import { OnboardingProvider } from './screens/onboarding/onboarding-context.js';
import { INITIAL_SCREEN, SCREENS } from './screen.js';
import { symbols } from './symbols.js';
import { ThemeProvider, useTheme } from './theme.js';

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
  const { current, pop, stack } = useNavigation();
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
  const handleGlobalInput = useCallback((input: string, key: { escape: boolean }) => {
    if (input === 'q') {
      exitRef.current();
      return;
    }

    if (key.escape) {
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
