/**
 * Tela doctor da TUI (M2-12, #35): painel de diagnóstico — versão do Node, da
 * ferramenta, instância configurada, método de credencial em uso (keychain /
 * arquivo / env, sem NUNCA expor a api_key) e status de conectividade (GET
 * leve à instância, com timeout curto). Toda a lógica assíncrona vive em
 * `../hooks/use-doctor-status.js` (testável isoladamente, com deps
 * injetáveis); esta tela só formata o "painel de status": uma linha por
 * item, `symbols.tick`/`symbols.cross` coloridos por `theme.success`/
 * `theme.danger`, rótulos em `theme.muted`.
 *
 * M2-16 (#39): `value` de cada `StatusRow` é truncado (`../truncate.js`) ao
 * espaço restante do terminal — a instância (`REDMINE_URL`) é a candidata
 * mais provável a estourar a largura, e a linha é um `<Box>` de 3 `<Text>`
 * IRMÃS (ícone/rótulo/valor): sem truncar, um valor comprido sobrepõe as
 * demais (o Ink não reflui `<Text>` irmãs; ver o JSDoc de `../truncate.ts`).
 */
import { Box, Text, useInput } from 'ink';

import {
  useDoctorStatus,
  type ConnectivityStatus,
  type DoctorStatus,
} from '../hooks/use-doctor-status.js';
import { useTerminalWidth } from '../hooks/use-terminal-width.js';
import { useNavigation } from '../navigation.js';
import { symbols } from '../symbols.js';
import { useTheme, type Theme } from '../theme.js';
import { truncate } from '../truncate.js';

/** Largura mínima garantida ao valor de um `StatusRow`, mesmo em terminais muito estreitos. */
const MIN_VALUE_WIDTH = 8;

/** `paddingX={1}` dos dois lados do `Box` raiz da tela. */
const SCREEN_PADDING_X = 2;

/** Largura da coluna de ícone (`<Box width={2}>`, ver `StatusRow` abaixo). */
const ICON_COLUMN_WIDTH = 2;

/** Rótulo legível de cada fonte de credencial (nunca a api_key em si). */
const CREDENTIAL_LABELS: Record<DoctorStatus['credentialMethod'], string> = {
  keyring: 'keychain do SO',
  file: 'arquivo local (credentials.json)',
  env: 'variável de ambiente (REDMINE_API_KEY)',
  none: 'nenhuma credencial encontrada',
  checking: 'verificando...',
};

/** Tom do símbolo/linha: `ok` (tick verde), `error` (cross vermelho) ou `neutral` (sem símbolo). */
type RowTone = 'ok' | 'error' | 'neutral';

/** Uma linha do painel: símbolo de status opcional + rótulo em muted + valor truncado ao espaço disponível. */
function StatusRow({ label, value, tone }: { label: string; value: string; tone: RowTone }) {
  const theme = useTheme();
  const terminalWidth = useTerminalWidth();
  // "label: " ocupa `label.length + 2` (": ") colunas antes do valor.
  const overhead = ICON_COLUMN_WIDTH + label.length + 2 + SCREEN_PADDING_X;
  const valueBudget = Math.max(terminalWidth - overhead, MIN_VALUE_WIDTH);
  return (
    <Box>
      <Box width={ICON_COLUMN_WIDTH}>
        {tone === 'ok' ? (
          <Text color={theme.success}>{symbols.tick}</Text>
        ) : tone === 'error' ? (
          <Text color={theme.danger}>{symbols.cross}</Text>
        ) : null}
      </Box>
      <Text color={theme.muted}>{label}: </Text>
      <Text>{truncate(value, valueBudget)}</Text>
    </Box>
  );
}

/** Formata o valor + tom da linha de instância. */
function instanceRow(status: DoctorStatus): { value: string; tone: RowTone } {
  if (status.instanceUrl === undefined) {
    return { value: 'não configurada (defina REDMINE_URL)', tone: 'error' };
  }
  return { value: status.instanceUrl, tone: 'ok' };
}

/** Formata o valor + tom da linha de credencial. */
function credentialRow(status: DoctorStatus): { value: string; tone: RowTone } {
  const value = CREDENTIAL_LABELS[status.credentialMethod];
  if (status.credentialMethod === 'checking') {
    return { value, tone: 'neutral' };
  }
  return { value, tone: status.credentialMethod === 'none' ? 'error' : 'ok' };
}

/** Formata o valor + tom da linha de conectividade a partir do status. */
function connectivityRow(
  connectivity: ConnectivityStatus,
  detail: string | undefined,
): { value: string; tone: RowTone } {
  if (connectivity === 'skipped') {
    return { value: 'não verificada (nenhuma instância configurada)', tone: 'neutral' };
  }
  if (connectivity === 'checking') {
    return { value: 'verificando...', tone: 'neutral' };
  }
  if (connectivity === 'ok') {
    return { value: 'conectado', tone: 'ok' };
  }
  return { value: `falha${detail !== undefined ? ` (${detail})` : ''}`, tone: 'error' };
}

/** Tela doctor: `b` (ou `Esc`, atalho global) volta para a tela anterior (ver `app.tsx`). */
export function DoctorScreen() {
  const { pop } = useNavigation();
  const theme: Theme = useTheme();
  const status = useDoctorStatus();

  useInput((input) => {
    if (input === 'b') {
      pop();
    }
  });

  const instance = instanceRow(status);
  const credential = credentialRow(status);
  const connectivity = connectivityRow(status.connectivity, status.connectivityDetail);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Doctor
      </Text>
      <Box marginTop={1} flexDirection="column">
        <StatusRow label="Node" value={status.nodeVersion} tone="neutral" />
        <StatusRow label="Ferramenta" value={`${status.toolName} v${status.toolVersion}`} tone="neutral" />
        <StatusRow label="Instância" value={instance.value} tone={instance.tone} />
        <StatusRow label="Credencial" value={credential.value} tone={credential.tone} />
        <StatusRow label="Conectividade" value={connectivity.value} tone={connectivity.tone} />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          Pressione{' '}
          <Text bold color={theme.accent}>
            b
          </Text>{' '}
          para voltar.
        </Text>
      </Box>
    </Box>
  );
}
