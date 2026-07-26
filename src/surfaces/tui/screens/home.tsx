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
 * estados. `Enter` sobre a issue selecionada empilha `issue-detail`
 * (`./issue-detail.js`, detalhe real desde a #31).
 *
 * Fix do review do PR #120: `useMyIssues` agora envolve a busca com
 * `useAuthGuard` (#36) — 401 relogina e retoma a busca sozinho (o estado
 * fica `loading` até lá, nenhuma tela nova aqui). Se o re-login for
 * abandonado (Esc), o hook expõe o 5º estado `auth-aborted` (neutro, não um
 * erro) — renderizado aqui igual aos banners de erro, com o mesmo `r` de
 * retry.
 *
 * M2-07 (#30) acrescenta a busca/filtros inline: `/` abre um `TextInput`
 * QUANDO a home está ativa; `f` cicla o filtro com a busca FECHADA (badge no
 * cabeçalho); Esc fecha a busca sem refetch, interceptado via
 * `../hooks/use-escape-interceptor.ts` para não desempilhar a home.
 *
 * #31 (detalhe) acrescenta `./home-selection.js`: a tela é DESMONTADA ao
 * empilhar `issue-detail`, então seleção (`selectedIndex` + issue escolhida)
 * vive num contexto acima da pilha (padrão do `OnboardingProvider`) — ver o
 * JSDoc de `./home-selection.js`.
 *
 * M2-16 (#39): o subject de cada linha é truncado (`../truncate.js`) com um
 * orçamento de largura CALCULADO por linha (`../hooks/use-terminal-width.js`
 * menos o espaço fixo de ponteiro/`#id`/badge de status, ver
 * `fixedRowOverhead` abaixo) — sem isso, um subject comprido sobrepõe o badge
 * de status da mesma linha em terminais estreitos (o Ink não reflui `<Text>`
 * IRMÃS dentro de um `<Box>` em linha; ver o JSDoc de `../truncate.ts`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { Spinner } from '../components/spinner.js';
import { TextInput } from '../components/text-input.js';
import { glyphs } from '../glyphs.js';
import { useEscapeInterceptor } from '../hooks/use-escape-interceptor.js';
import { useIssueSearch, type SearchStatusFilter } from '../hooks/use-issue-search.js';
import { useListNavigation } from '../hooks/use-list-navigation.js';
import { useMyIssues, type MyIssue } from '../hooks/use-my-issues.js';
import { useTerminalWidth } from '../hooks/use-terminal-width.js';
import { useNavigation } from '../navigation.js';
import { statusColor } from '../status-color.js';
import { symbols } from '../symbols.js';
import { useTheme } from '../theme.js';
import { truncate } from '../truncate.js';
import { useHomeSelection } from './home-selection.js';

/** Largura mínima garantida ao subject, mesmo em terminais muito estreitos. */
const MIN_SUBJECT_WIDTH = 8;

/** `paddingX={1}` dos dois lados do `Box` raiz da tela (ver o JSX abaixo). */
const SCREEN_PADDING_X = 2;

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

/**
 * Espaço fixo ocupado pela linha FORA do subject (M2-16, #39): ponteiro (2),
 * `#id ` (id + `#`/espaço), 1 espaço final após o subject, `[status]`
 * (colchetes + nome) e o `paddingX` da tela. O que sobrar da largura do
 * terminal é o orçamento do subject.
 */
function fixedRowOverhead(idLength: number, statusLength: number): number {
  const POINTER_WIDTH = 2;
  const ID_PREFIX_WIDTH = 1 + idLength + 1; // "#" + dígitos + espaço
  const SUBJECT_TRAILING_SPACE = 1;
  const STATUS_BRACKETS_WIDTH = 2 + statusLength; // "[" + nome + "]"
  return POINTER_WIDTH + ID_PREFIX_WIDTH + SUBJECT_TRAILING_SPACE + STATUS_BRACKETS_WIDTH + SCREEN_PADDING_X;
}

/** Uma linha da lista: `#id` em `theme.muted`, subject truncado ao orçamento de largura, badge de status. */
function IssueRow({ issue, selected }: { issue: MyIssue; selected: boolean }) {
  const theme = useTheme();
  const terminalWidth = useTerminalWidth();
  const overhead = fixedRowOverhead(String(issue.id).length, issue.statusName.length);
  const subjectBudget = Math.max(terminalWidth - overhead, MIN_SUBJECT_WIDTH);
  return (
    <Box>
      <Text color={theme.primary}>{selected ? `${symbols.pointerSmall} ` : '  '}</Text>
      <Text color={theme.muted}>#{issue.id} </Text>
      <Text bold={selected}>{truncate(issue.subject, subjectBudget)} </Text>
      <Text color={statusColor(theme, issue.statusName)}>[{issue.statusName}]</Text>
    </Box>
  );
}

/** Tela home: lista "minhas issues", `↑/↓`/`j`/`k` navegam, `Enter` abre o detalhe. */
export function HomeScreen() {
  const theme = useTheme();
  const { push } = useNavigation();
  const { state, retry } = useMyIssues();
  // #31: índice preservado entre remounts + registro de qual issue foi aberta
  // (ver o JSDoc do módulo e de `./home-selection.js`).
  const { selectedIndex: persistedIndex, setSelectedIndex: persistIndex, setSelectedIssueId } =
    useHomeSelection();

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
  const setSelectedIssueIdRef = useRef(setSelectedIssueId);
  setSelectedIssueIdRef.current = setSelectedIssueId;
  const handleSelect = useCallback((index: number) => {
    const issue = issues[index];
    if (issue !== undefined) {
      setSelectedIssueIdRef.current(issue.id);
      pushRef.current('issue-detail');
    }
  }, [issues]);
  // #30: navegação desligada com a busca aberta; #31: cursor semeado com a
  // última posição persistida (sobrevive ao unmount via home-selection).
  const { selectedIndex } = useListNavigation(issues.length, {
    onSelect: handleSelect,
    isActive: !isSearching,
    initialIndex: persistedIndex,
  });

  // Espelha `selectedIndex` ao contexto — a cópia externa sobrevive ao
  // unmount desta tela (ver ./home-selection.js).
  const persistIndexRef = useRef(persistIndex);
  persistIndexRef.current = persistIndex;
  useEffect(() => {
    persistIndexRef.current(selectedIndex);
  }, [selectedIndex]);

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

  // #34 (M2-11): "t" abre o painel de jobs da sessão (`./jobs.js`) — só fora
  // da busca (mesma guarda de "/"/"f" acima: dentro do campo, "t" é texto da
  // query, não um atalho).
  const handleJobsShortcut = useCallback((input: string) => {
    if (input === 't' && !isSearchingRef.current) {
      pushRef.current('jobs');
    }
  }, []);
  useInput(handleJobsShortcut);

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
            {`  / busca ${glyphs.middleDot} f filtro ${glyphs.middleDot} t jobs`}
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
                {`${glyphs.arrowUp}/${glyphs.arrowDown}`}
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
                t
              </Text>{' '}
              jobs,{' '}
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
