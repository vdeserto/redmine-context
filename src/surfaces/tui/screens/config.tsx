/**
 * Tela config da TUI (M2-12, #35): mostra a instância configurada e a fonte
 * de credencial em uso (reaproveita `use-doctor-status.js`, sem duplicar a
 * leitura da cascata) e permite logout — `l` remove a credencial da cascata
 * INTEIRA (keychain + arquivo, via `core.createCredentialCascade().delete()`);
 * a variável de ambiente é somente-leitura e NÃO é apagada por aqui — se
 * ainda resolver a credencial depois do logout, um aviso é mostrado (nunca a
 * api_key em si, só a fonte, via `describeCredentialSource`).
 *
 * Depois do logout, a tela aguarda uma tecla qualquer para voltar ao início
 * com `resetTo('welcome')` — como `config` só é alcançada a partir da
 * `welcome` (hint da tela inicial), isso equivale a resetar a pilha de
 * navegação para a base.
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { createCredentialCascade, describeCredentialSource } from '../../../index.js';
import { useDoctorStatus } from '../hooks/use-doctor-status.js';
import { useInstance } from '../instance.js';
import { useNavigation } from '../navigation.js';
import { symbols } from '../symbols.js';
import { useTheme } from '../theme.js';

/** Rótulo legível da origem da instância (#187). */
function originLabel(origin: 'env' | 'config' | 'none'): string {
  if (origin === 'env') return 'via REDMINE_URL';
  if (origin === 'config') return 'salva neste dispositivo';
  return '';
}

/** Estados do fluxo de logout desta tela. */
type LogoutState = 'idle' | 'working' | 'done' | 'error';

/** Tela config: instância + credencial em uso, `l` faz logout, `b` volta. */
export function ConfigScreen() {
  const { pop, resetTo } = useNavigation();
  const theme = useTheme();
  const status = useDoctorStatus();
  const instance = useInstance();
  const [logoutState, setLogoutState] = useState<LogoutState>('idle');
  const [envStillPresent, setEnvStillPresent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const startLogout = (instanceUrl: string): void => {
    setLogoutState('working');
    void (async () => {
      try {
        await createCredentialCascade({ env: process.env }).delete(instanceUrl);
        // Também remove a URL persistida (#187) para não reconfigurar sozinha no
        // próximo boot. Isolado em try próprio: a parte CRÍTICA (a credencial) já
        // foi removida acima, então uma falha ao limpar o settings.json NÃO deve
        // marcar o logout como erro total — degrada silenciosamente.
        try {
          await instance.clearPersisted();
        } catch {
          // Best-effort: a credencial já foi removida; settings.json fica para a próxima.
        }
        // Env é somente-leitura: se ainda resolver a credencial, avisa (sem expor a key).
        const remaining = await describeCredentialSource(instanceUrl, { env: process.env });
        setEnvStillPresent(remaining === 'env');
        setLogoutState('done');
      } catch (cause) {
        setErrorMessage(cause instanceof Error ? cause.message : String(cause));
        setLogoutState('error');
      }
    })();
  };

  useInput((input) => {
    if (logoutState === 'done' || logoutState === 'error') {
      // Qualquer tecla confirma e volta ao início — pilha zerada (resetTo).
      resetTo('welcome');
      return;
    }

    if (input === 'b') {
      pop();
      return;
    }

    if (input === 'l' && logoutState === 'idle' && status.instanceUrl !== undefined) {
      startLogout(status.instanceUrl);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Configuração
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={theme.muted}>Instância: </Text>
          {status.instanceUrl ?? 'não configurada (defina REDMINE_URL ou faça login)'}
          {status.instanceUrl !== undefined && instance.origin !== 'none' ? (
            <Text color={theme.muted}> ({originLabel(instance.origin)})</Text>
          ) : null}
        </Text>
        <Text>
          <Text color={theme.muted}>Credencial: </Text>
          {status.credentialMethod}
        </Text>
      </Box>

      {logoutState === 'working' ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>Removendo credencial...</Text>
        </Box>
      ) : null}

      {logoutState === 'done' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.success}>
            {symbols.tick} Credencial removida do keychain e do arquivo local.
          </Text>
          {envStillPresent ? (
            <Text color={theme.warning}>
              {symbols.warning} REDMINE_API_KEY ainda definida no ambiente — a credencial pode
              continuar ativa por essa variável. Remova-a manualmente para desativar por completo.
            </Text>
          ) : null}
          <Text color={theme.muted}>Pressione qualquer tecla para voltar ao início.</Text>
        </Box>
      ) : null}

      {logoutState === 'error' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.danger}>
            {symbols.cross} Falha ao remover a credencial: {errorMessage}
          </Text>
          <Text color={theme.muted}>Pressione qualquer tecla para voltar ao início.</Text>
        </Box>
      ) : null}

      {logoutState === 'idle' ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>
            Pressione{' '}
            <Text bold color={theme.accent}>
              l
            </Text>{' '}
            para fazer logout (remove a credencial salva),{' '}
            <Text bold color={theme.accent}>
              b
            </Text>{' '}
            para voltar.
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
