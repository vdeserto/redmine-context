/**
 * Tela home da TUI (M2-06, #29): "minhas issues" (`assigned_to_id=me`) via o
 * core, com seleção por teclado (`../hooks/use-list-navigation.js`) e os 4
 * estados visuais exigidos pela AC — carregando (`Spinner`), vazio, erro de
 * rede (banner `theme.danger` + tecla `r` para tentar de novo) e 403
 * (mensagem específica de permissão). Vira o destino pós-onboarding (ver
 * `onboarding/success.tsx`, que faz `resetTo('home')`) e o Enter da
 * `welcome.tsx` quando já há credencial salva na cascata.
 *
 * A busca em si vive em `../hooks/use-my-issues.js` (deps injetáveis,
 * fronteira do core via `../../../index.js`) — esta tela só formata os
 * estados. `Enter` sobre a issue selecionada empilha `issue-detail`, uma
 * tela placeholder mínima (`./issue-detail.js`) até a #31 implementar o
 * detalhe real.
 */
import { useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import { Spinner } from '../components/spinner.js';
import { useListNavigation } from '../hooks/use-list-navigation.js';
import { useMyIssues, type MyIssue } from '../hooks/use-my-issues.js';
import { useNavigation } from '../navigation.js';
import { symbols } from '../symbols.js';
import { useTheme, type Theme } from '../theme.js';

/** Tamanho máximo do subject antes de truncar com reticências. */
const SUBJECT_MAX_LENGTH = 60;

/** Trunca `text` em `max` caracteres, com reticências (`…`) quando corta. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Cor do badge de status: heurística por nome do status, sempre via token do
 * tema (nunca um literal de cor — a varredura anti-hardcode cobre esta
 * tela). `theme.primary` é o fallback para status sem correspondência
 * (ex.: "Nova", "Em espera").
 */
function statusColor(theme: Theme, statusName: string): string {
  const normalized = statusName.toLowerCase();
  if (/fechad|closed|resolvid|resolved|conclu[ií]d/.test(normalized)) {
    return theme.success;
  }
  if (/cancel/.test(normalized)) {
    return theme.danger;
  }
  if (/andamento|progress|curso/.test(normalized)) {
    return theme.warning;
  }
  return theme.primary;
}

/** Uma linha da lista: `#id` em `theme.muted`, subject truncado, badge de status. */
function IssueRow({ issue, selected }: { issue: MyIssue; selected: boolean }) {
  const theme = useTheme();
  return (
    <Box>
      <Text color={theme.primary}>{selected ? `${symbols.pointerSmall} ` : '  '}</Text>
      <Text color={theme.muted}>#{issue.id} </Text>
      <Text bold={selected}>{truncate(issue.subject, SUBJECT_MAX_LENGTH)} </Text>
      <Text color={statusColor(theme, issue.statusName)}>[{issue.statusName}]</Text>
    </Box>
  );
}

/** Tela home: lista "minhas issues", `↑/↓`/`j`/`k` navegam, `Enter` abre o detalhe. */
export function HomeScreen() {
  const theme = useTheme();
  const { push } = useNavigation();
  const { state, retry } = useMyIssues();

  const issues = state.status === 'loaded' ? state.issues : [];

  // Handlers ESTÁVEIS (useCallback + refs, padrão do repo): identidade nova a
  // cada render des/re-subscreve o useInput e pode perder uma tecla rápida.
  const pushRef = useRef(push);
  pushRef.current = push;
  const handleSelect = useCallback((index: number) => {
    if (issues[index] !== undefined) {
      pushRef.current('issue-detail');
    }
  }, [issues]);
  const { selectedIndex } = useListNavigation(issues.length, { onSelect: handleSelect });

  const retryRef = useRef(retry);
  retryRef.current = retry;
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  const handleRetryInput = useCallback((input: string) => {
    if (input === 'r' && (statusRef.current === 'error-network' || statusRef.current === 'error-forbidden')) {
      retryRef.current();
    }
  }, []);
  useInput(handleRetryInput);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Minhas issues
      </Text>

      {state.status === 'loading' ? (
        <Box marginTop={1}>
          <Text>
            <Spinner /> Carregando issues...
          </Text>
        </Box>
      ) : null}

      {state.status === 'empty' ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>nenhuma issue atribuída</Text>
        </Box>
      ) : null}

      {state.status === 'error-network' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.danger}>
            {symbols.cross} Falha ao carregar suas issues: {state.message}
          </Text>
          <Text color={theme.muted}>
            Pressione{' '}
            <Text bold color={theme.accent}>
              r
            </Text>{' '}
            para tentar de novo.
          </Text>
        </Box>
      ) : null}

      {state.status === 'error-forbidden' ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.danger}>
            {symbols.cross} {state.message}
          </Text>
          <Text color={theme.muted}>
            Pressione{' '}
            <Text bold color={theme.accent}>
              r
            </Text>{' '}
            para tentar de novo.
          </Text>
        </Box>
      ) : null}

      {state.status === 'loaded' ? (
        <Box marginTop={1} flexDirection="column">
          {state.issues.map((issue, index) => (
            <IssueRow key={issue.id} issue={issue} selected={index === selectedIndex} />
          ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={theme.muted}>
          <Text bold color={theme.accent}>
            ↑/↓
          </Text>{' '}
          navega,{' '}
          <Text bold color={theme.accent}>
            Enter
          </Text>{' '}
          abre a issue,{' '}
          <Text bold color={theme.accent}>
            Esc
          </Text>{' '}
          volta.
        </Text>
      </Box>
    </Box>
  );
}
