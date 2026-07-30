/**
 * Tela de boas-vindas da TUI — scaffold M2-01, com hints de doctor/config
 * (M2-12, #35), o ponto de entrada do onboarding (M2-05.1, #27) e o desvio
 * direto para a home quando já há credencial salva (M2-06, #29).
 *
 * Mostra nome do produto + versão (via a superfície pública do core,
 * `../../../index.js`, ADR-005) e a dica de teclas. Cores vêm do tema
 * central (M2-02, `useTheme()`) — nenhum literal de cor aqui, ver
 * `theme.ts` para o guideline de uso de cada token.
 *
 * `Enter` checa a cascata de credenciais (`resolveApiKey`, mesma convenção
 * de instância — `REDMINE_URL` — usada pelo doctor/CLI/MCP): com credencial
 * já resolvida, pula direto para `home` (#29); sem ela (ou sem
 * `REDMINE_URL` configurada, ou se a cascata falhar), segue o fluxo de
 * onboarding de sempre. A checagem é assíncrona; `checkingRef` evita
 * disparar mais de uma em paralelo se `Enter` for pressionado repetidas
 * vezes antes da primeira resolver.
 */
import { useCallback, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { resolveApiKey, TOOL_NAME, TOOL_VERSION } from '../../../index.js';
import { GradientText } from '../components/gradient-text.js';
import { useEnvFallbackAllowed } from '../instance.js';
import { useNavigation } from '../navigation.js';
import { useTheme } from '../theme.js';

/** Lê `REDMINE_URL` do ambiente, tratando string vazia como ausente (mesma convenção do doctor). */
function instanceFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.REDMINE_URL;
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Tela inicial do roteador: `Enter` vai para `home` (credencial já salva) ou
 * inicia o onboarding (M2-05.1), `?` atalhos, `d` doctor, `c` config, `q`
 * sai (ver `app.tsx`).
 */
export function WelcomeScreen() {
  const { navigate } = useNavigation();
  const theme = useTheme();
  const [checking, setChecking] = useState(false);

  // Handlers ESTÁVEIS (useCallback+refs) — mesmo padrão do TextInput/app.tsx:
  // identidade nova por render des/re-subscreve o useInput e perde teclas.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const checkingRef = useRef(checking);
  checkingRef.current = checking;
  // SEGURANÇA (#187): instância de origem `config` (URL persistida) não pode usar a
  // env-key instance-agnóstica. Ref pelo padrão de handler estável desta tela.
  const allowEnvFallbackRef = useRef(true);
  allowEnvFallbackRef.current = useEnvFallbackAllowed();

  const handleInput = useCallback((input: string, key: { return: boolean; ctrl: boolean }) => {
    // Reason: o Ink reporta Ctrl+<letra> com o MESMO `input` da letra solta
    // (ex.: Ctrl+C chega como `input === 'c'`, `key.ctrl === true`) — sem essa
    // guarda, o atalho global de sair (duplo Ctrl+C, `app.tsx`) navegaria
    // para `config` por engano a cada Ctrl+C pressionado nesta tela.
    if (key.ctrl) {
      return;
    }
    if (input === '?') {
      navigateRef.current('about');
      return;
    }
    if (key.return) {
      if (checkingRef.current) {
        return;
      }
      const instanceUrl = instanceFromEnv(process.env);
      if (instanceUrl === undefined) {
        navigateRef.current('onboarding-url');
        return;
      }
      setChecking(true);
      void (async () => {
        const apiKey = await resolveApiKey(instanceUrl, {
          env: process.env,
          allowEnvFallback: allowEnvFallbackRef.current,
        }).catch(() => undefined);
        setChecking(false);
        navigateRef.current(apiKey !== undefined ? 'home' : 'onboarding-url');
      })();
      return;
    }
    if (input === 'd') {
      navigateRef.current('doctor');
    }
    if (input === 'c') {
      navigateRef.current('config');
    }
    if (input === 'a') {
      navigateRef.current('appearance');
    }
  }, []);
  useInput(handleInput);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <GradientText colors={theme.gradient ?? [theme.primary]}>{TOOL_NAME}</GradientText>
      <Text color={theme.muted}>v{TOOL_VERSION}</Text>
      <Box marginTop={1}>
        <Text>Contexto completo de issues do Redmine, pronto para qualquer LLM.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          Pressione <Text color={theme.accent}>Enter</Text> para continuar,{' '}
          <Text color={theme.accent}>?</Text> para atalhos,{' '}
          <Text color={theme.accent}>d</Text> para o doctor,{' '}
          <Text color={theme.accent}>c</Text> para configuração,{' '}
          <Text color={theme.accent}>a</Text> para aparência,{' '}
          <Text color={theme.accent}>q</Text> para sair.
        </Text>
      </Box>
    </Box>
  );
}
