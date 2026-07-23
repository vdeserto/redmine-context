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
 *
 * Fix do review do PR #120: `useMyIssues` agora envolve a busca com
 * `useAuthGuard` (#36) — 401 relogina e retoma a busca sozinho (o estado
 * fica `loading` até lá, nenhuma tela nova aqui). Se o re-login for
 * abandonado (Esc), o hook expõe o 5º estado `auth-aborted` (neutro, não um
 * erro) — renderizado aqui igual aos banners de erro, com o mesmo `r` de
 * retry.
 *
 * M2-07 (#30) acrescenta a busca/filtros inline: `/` (reservado
 * globalmente como no-op em `../app.tsx`) abre um `TextInput` de busca
 * QUANDO a home está ativa — a lista de "minhas issues" (`useMyIssues`,
 * acima) permanece montada e intocada por baixo, só fica visualmente
 * substituída pela UI de busca enquanto `isSearching` é `true`. A busca em
 * si (`../hooks/use-issue-search.js`) é outro hook próprio (não uma extensão
 * de `useMyIssues`, o gatilho é bem diferente — retriggado a cada
 * `query`/`statusFilter`, com debounce de digitação) que reaproveita o MESMO
 * vocabulário de estados. `f` cicla o filtro rápido de status (badge ao lado
 * do campo); Esc fecha a busca e restaura a lista original SEM refetch — o
 * hook nunca é desmontado, só some do estado `isSearching`, e `search.clear()`
 * zera o estado da busca para `idle` sem chamar o core de novo (ver
 * `use-issue-search.ts`). O Esc em si é interceptado via
 * `../hooks/use-escape-interceptor.ts`: sem isso, o Esc global do roteador
 * (`../app.tsx`) desempilharia a home inteira em vez de só fechar a busca.
 */
import { useCallback, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { Spinner } from '../components/spinner.js';
import { TextInput } from '../components/text-input.js';
import { useEscapeInterceptor } from '../hooks/use-escape-interceptor.js';
import { useIssueSearch, type SearchStatusFilter } from '../hooks/use-issue-search.js';
import { useListNavigation } from '../hooks/use-list-navigation.js';
import { useMyIssues, type MyIssue } from '../hooks/use-my-issues.js';
import { useNavigation } from '../navigation.js';
import { symbols } from '../symbols.js';
import { useTheme, type Theme } from '../theme.js';

/** Tamanho máximo do subject antes de truncar com reticências. */
const SUBJECT_MAX_LENGTH = 60;

// Nit do review #120: referência ESTÁVEL para os estados sem lista — um
// literal `[]` inline em cada render seria recriado a cada chamada,
// invalidando memoizações a jusante (`useListNavigation`) sem necessidade.
const EMPTY_ISSUES: MyIssue[] = [];

/** Rótulo do badge de cada filtro rápido de status (tecla `f` cicla, M2-07/#30). */
const STATUS_FILTER_LABELS: Record<SearchStatusFilter, string> = {
  open: 'aberta',
  closed: 'fechada',
  all: 'todas',
};

/** Próximo filtro no ciclo `aberta → fechada → todas → aberta` (tecla `f`). */
function nextStatusFilter(current: SearchStatusFilter): SearchStatusFilter {
  if (current === 'open') return 'closed';
  if (current === 'closed') return 'all';
  return 'open';
}

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

  // --- Busca/filtros inline (M2-07, #30) ---
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SearchStatusFilter>('all');
  const search = useIssueSearch(query, statusFilter);

  // Handler ESTÁVEL: `search.clear` é a única dependência mutável (mas já é
  // estável por construção, ver `use-issue-search.ts`) — fecha a busca e
  // restaura os 3 estados neutros de uma vez (query/filtro/hook de busca).
  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setQuery('');
    setStatusFilter('all');
    search.clear();
  }, [search.clear]);
  // Desvia o Esc GLOBAL (`../app.tsx`) enquanto a busca está aberta — sem
  // isso, Esc desempilharia a home inteira em vez de só fechar a busca.
  useEscapeInterceptor(isSearching, closeSearch);

  const issues = state.status === 'loaded' ? state.issues : EMPTY_ISSUES;

  // Handlers ESTÁVEIS (useCallback + refs, padrão do repo): identidade nova a
  // cada render des/re-subscreve o useInput e pode perder uma tecla rápida.
  const pushRef = useRef(push);
  pushRef.current = push;
  const handleSelect = useCallback((index: number) => {
    if (issues[index] !== undefined) {
      pushRef.current('issue-detail');
    }
  }, [issues]);
  // M2-07 (#30): navegação da lista desligada enquanto a busca está aberta —
  // sem isso, `j`/`k`/Enter digitados no campo de busca também moveriam a
  // seleção (invisível) da lista por baixo.
  const { selectedIndex } = useListNavigation(issues.length, {
    onSelect: handleSelect,
    isActive: !isSearching,
  });

  const retryRef = useRef(retry);
  retryRef.current = retry;
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  const isSearchingRef = useRef(isSearching);
  isSearchingRef.current = isSearching;
  const handleRetryInput = useCallback((input: string) => {
    // M2-07 (#30): "r" digitado como texto de busca não deve disparar retry.
    if (isSearchingRef.current) return;
    if (
      input === 'r' &&
      (statusRef.current === 'error-network' ||
        statusRef.current === 'error-forbidden' ||
        // Fix do review #120: abandono do re-login (Esc) também tem retry.
        statusRef.current === 'auth-aborted')
    ) {
      retryRef.current();
    }
  }, []);
  useInput(handleRetryInput);

  // "/" abre a busca; "f" cicla o filtro rápido de status (só com a busca já
  // aberta). Reason: dentro do campo de texto, "f" digitado NÃO vira
  // caractere da query — é a tecla de controle do filtro, trade-off
  // Com a busca ABERTA, toda letra pertence à query (buscar "workflow" exige
  // digitar "f") — o ciclo de filtro por "f" só vale com a busca fechada.
  const handleSearchControlInput = useCallback((input: string) => {
    if (input === '/' && !isSearchingRef.current) {
      setIsSearching(true);
      return;
    }
    if (input === 'f' && !isSearchingRef.current) {
      setStatusFilter((current) => nextStatusFilter(current));
    }
  }, []);
  useInput(handleSearchControlInput);

  const searchState = search.state;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box>
        <Text bold color={theme.primary}>
          Minhas issues
        </Text>
        <Text color={theme.muted}> [{STATUS_FILTER_LABELS[statusFilter]}]</Text>
        {!isSearching ? (
          <Text color={theme.muted}>
            {'  '}/ busca · f filtro
          </Text>
        ) : null}
      </Box>

      {isSearching ? (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={theme.primary}>Buscar: </Text>
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder="digite para buscar…"
              isActive={isSearching}
            />
            <Text color={theme.muted}> [{STATUS_FILTER_LABELS[statusFilter]}]</Text>
          </Box>

          {searchState.status === 'idle' ? (
            <Box marginTop={1}>
              <Text color={theme.muted}>Digite para buscar ou pressione f para ciclar o filtro de status.</Text>
            </Box>
          ) : null}

          {searchState.status === 'loading' ? (
            <Box marginTop={1}>
              <Text>
                <Spinner /> Buscando...
              </Text>
            </Box>
          ) : null}

          {searchState.status === 'loaded' ? (
            <Box marginTop={1} flexDirection="column">
              {searchState.degraded ? (
                <Text color={theme.warning}>
                  {symbols.warning} {searchState.warnings.join(' ')}
                </Text>
              ) : null}
              <Text>{searchState.content}</Text>
            </Box>
          ) : null}

          {searchState.status === 'error-network' || searchState.status === 'error-forbidden' ? (
            <Box marginTop={1}>
              <Text color={theme.danger}>
                {symbols.cross} {searchState.message}
              </Text>
            </Box>
          ) : null}

          {searchState.status === 'auth-aborted' ? (
            <Box marginTop={1}>
              <Text color={theme.muted}>{searchState.message}</Text>
            </Box>
          ) : null}
        </Box>
      ) : (
        <>
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

          {state.status === 'auth-aborted' ? (
            // Fix do review #120: estado NEUTRO (abandono consciente do re-login,
            // Esc) — `theme.muted`, não `theme.danger` (não é uma falha).
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.muted}>{state.message}</Text>
            </Box>
          ) : null}

          {state.status === 'loaded' ? (
            <Box marginTop={1} flexDirection="column">
              {state.issues.map((issue, index) => (
                <IssueRow key={issue.id} issue={issue} selected={index === selectedIndex} />
              ))}
            </Box>
          ) : null}
        </>
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>
          {isSearching ? (
            <>
              <Text bold color={theme.accent}>
                Esc
              </Text>{' '}
              fecha a busca,{' '}
              <Text bold color={theme.accent}>
                f
              </Text>{' '}
              cicla o filtro.
            </>
          ) : (
            <>
              <Text bold color={theme.accent}>
                ↑/↓
              </Text>{' '}
              navega,{' '}
              <Text bold color={theme.accent}>
                Enter
              </Text>{' '}
              abre a issue,{' '}
              <Text bold color={theme.accent}>
                /
              </Text>{' '}
              busca,{' '}
              <Text bold color={theme.accent}>
                Esc
              </Text>{' '}
              volta.
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
}
