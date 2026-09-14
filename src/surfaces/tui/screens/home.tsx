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
 * QUANDO a home está ativa; `f` abre o seletor de status com a busca FECHADA (badge no
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
import { isTyping } from '../hooks/use-typing-guard.js';
import { listWindow } from '../list-window.js';
import { statusFilterLabel, useStatusOptions } from '../hooks/use-status-options.js';
import { useIssueSearch, type SearchStatusFilter } from '../hooks/use-issue-search.js';
import { useListNavigation } from '../hooks/use-list-navigation.js';
import { useMyIssues, type MyIssue } from '../hooks/use-my-issues.js';
import { useTerminalHeight, useTerminalWidth } from '../hooks/use-terminal-width.js';
import { useNavigation } from '../navigation.js';
import { statusColor, statusFilterColor } from '../status-color.js';
import { symbols } from '../symbols.js';
import { useTheme } from '../theme.js';
import type { SearchListItem } from '../../../index.js';
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

/**
 * Linhas ocupadas fora da lista NESTA tela (breadcrumb, cabeçalho, contador,
 * rodapé, paddings). A moldura da aplicação não entra: o shell já entrega a
 * altura sem ela (ver `TerminalHeightProvider` em `../app.tsx`).
 */
const LIST_OVERHEAD_ROWS = 9;
/** Piso da janela da lista (terminais muito baixos). */
const LIST_MIN_HEIGHT = 5;

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
/**
 * Uma linha de RESULTADO DE BUSCA.
 *
 * Espelha o layout do {@link IssueRow} (id · assunto · status), mas a partir do
 * item estruturado da busca — sem passar pelo Markdown do bundle, que traria as
 * fences `<untrusted-content>` para a tela.
 */
function SearchResultRow({ item, selected }: { item: SearchListItem; selected: boolean }) {
  const theme = useTheme();
  const terminalWidth = useTerminalWidth();
  const overhead = fixedRowOverhead(String(item.id).length, item.status.length);
  const subjectBudget = Math.max(terminalWidth - overhead, MIN_SUBJECT_WIDTH);
  return (
    <Box>
      <Text color={theme.primary}>{selected ? `${symbols.pointerSmall} ` : '  '}</Text>
      <Text color={theme.muted}>#{item.id} </Text>
      <Text {...(selected ? { color: theme.primary } : {})}>
        {truncate(item.subject ?? '(sem assunto)', subjectBudget)}
      </Text>
      <Text color={statusColor(theme, item.status)}> [{item.status}]</Text>
      <Text color={theme.muted}> {item.assignee}</Text>
    </Box>
  );
}

function IssueRow({ issue, selected }: { issue: MyIssue; selected: boolean }) {
  const theme = useTheme();
  const terminalWidth = useTerminalWidth();
  const overhead = fixedRowOverhead(String(issue.id).length, issue.statusName.length);
  const subjectBudget = Math.max(terminalWidth - overhead, MIN_SUBJECT_WIDTH);
  return (
    <Box>
      <Text color={theme.primary}>{selected ? `${symbols.pointerSmall} ` : '  '}</Text>
      <Text color={theme.muted}>#{issue.id} </Text>
      {/* SEGURANÇA de contraste (#190): em alguns terminais (ex.: Terminal.app do
          macOS) o atributo BOLD (SGR 1) ignora o fg truecolor e renderiza "preto",
          ilegível sobre o bg escuro do OSC. Por isso a seleção NÃO usa bold — só a
          cor `theme.primary` + a setinha (`symbols.pointerSmall`) a destacam. O
          não-selecionado mantém a cor de texto padrão. */}
      <Text {...(selected ? { color: theme.primary } : {})}>
        {truncate(issue.subject, subjectBudget)}{' '}
      </Text>
      <Text color={statusColor(theme, issue.statusName)}>[{issue.statusName}]</Text>
    </Box>
  );
}

/** Tela home: lista "minhas issues", `↑/↓`/`j`/`k` navegam, `Enter` abre o detalhe. */
export function HomeScreen() {
  const theme = useTheme();
  const { push } = useNavigation();
  // #31: índice preservado entre remounts + registro de qual issue foi aberta
  // (ver o JSDoc do módulo e de `./home-selection.js`).
  const { selectedIndex: persistedIndex, setSelectedIndex: persistIndex, setSelectedIssueId } =
    useHomeSelection();

  // --- Busca/filtros inline (M2-07, #30) ---
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState('');
  // Default ABERTAS, não "todas": a home é a lista de trabalho. Com `all` o
  // Redmine devolve o histórico inteiro (centenas de fechadas), que estoura a
  // tela e enterra o que importa — era o default implícito antes do filtro
  // chegar à lista (a API omite fechadas quando `status_id` não é enviado).
  const [statusFilter, setStatusFilter] = useState<SearchStatusFilter>('open');
  // Seletor de status (#30, revisto): `f` abre uma LISTA em vez de ciclar às
  // cegas — a instância tem uma dezena de status e o usuário não tem como
  // adivinhar qual vem a seguir num ciclo.
  const [isPickingStatus, setIsPickingStatus] = useState(false);
  const statusOptions = useStatusOptions();
  const [statusIndex, setStatusIndex] = useState(0);
  // Seleção dentro dos RESULTADOS da busca: achar o chamado e não conseguir
  // abrir é o mesmo que não ter achado. As setas não são texto, então navegam
  // os resultados enquanto o campo continua recebendo letras.
  const [searchIndex, setSearchIndex] = useState(0);
  const searchIndexRef = useRef(searchIndex);
  searchIndexRef.current = searchIndex;
  // O filtro só vai para a BUSCA quando ela está aberta: com ela fechada, quem
  // aplica o status é a lista (abaixo), e passar o filtro aqui dispararia um
  // request cujo resultado nunca é renderizado — dois GETs por `f` em vez de um.
  const search = useIssueSearch(query, isSearching ? statusFilter : 'all');
  // O filtro rápido (`f`) precisa valer para a LISTA visível — antes ele só
  // alimentava a busca, cujos resultados só aparecem com a busca ABERTA, então
  // trocar o status não mudava nada na tela.
  const { state, retry } = useMyIssues({ statusFilter });

  // Handler ESTÁVEL: `search.clear` é a única dependência mutável (mas já é
  // estável por construção, ver `use-issue-search.ts`) — fecha a busca e
  // restaura os 3 estados neutros de uma vez (query/filtro/hook de busca).
  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setQuery('');
    // O filtro de status NÃO é resetado: desde que ele governa a LISTA (e não
    // só a busca), zerá-lo aqui desfazia uma escolha que o usuário fez ANTES de
    // abrir a busca — `f`, depois `/`, depois `Esc` devolvia [Todas].
    search.clear();
  }, [search.clear]);
  // Desvia o Esc GLOBAL (`../app.tsx`) enquanto a busca está aberta — sem
  // isso, Esc desempilharia a home inteira em vez de só fechar a busca.
  // Resultado novo, cursor no topo: manter o índice de uma busca anterior faria
  // o Enter abrir uma issue que não é a que está sob o cursor.
  useEffect(() => {
    setSearchIndex(0);
    searchIndexRef.current = 0;
  }, [query, statusFilter]);

  useEscapeInterceptor(isSearching, closeSearch);
  const closeStatusPicker = useCallback(() => setIsPickingStatus(false), []);
  useEscapeInterceptor(isPickingStatus, closeStatusPicker);

  const issues = state.status === 'loaded' ? state.issues : EMPTY_ISSUES;
  // Altura da lista: o terminal menos a moldura, breadcrumb, cabeçalho, contador
  // e rodapé. A lista rola DENTRO dessa janela em vez de empurrar o resto da
  // tela para fora — e a mesma altura é o salto de uma página.
  const listHeight = Math.max(LIST_MIN_HEIGHT, useTerminalHeight() - LIST_OVERHEAD_ROWS);

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
    // Também desligada com o SELETOR DE STATUS aberto: o Ink entrega a tecla a
    // todos os handlers, então o Enter que aplica o filtro abria a issue
    // selecionada por baixo, ao mesmo tempo.
    isActive: !isSearching && !isPickingStatus,
    initialIndex: persistedIndex,
    // Uma página = uma tela da janela visível (ver ../list-window.ts).
    pageSize: listHeight,
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
  const isPickingStatusRef = useRef(isPickingStatus);
  isPickingStatusRef.current = isPickingStatus;
  const optionsRef = useRef(statusOptions);
  optionsRef.current = statusOptions;
  const statusIndexRef = useRef(statusIndex);
  statusIndexRef.current = statusIndex;
  const filterRef = useRef(statusFilter);
  filterRef.current = statusFilter;
  const searchItemsRef = useRef<readonly SearchListItem[]>([]);
  searchItemsRef.current = search.state.status === 'loaded' ? search.state.items : [];
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

  // "/" abre a busca; "f" abre o seletor de status. Ambos só FORA de campo de
  // texto: com a busca aberta toda letra pertence à query (buscar "workflow"
  // exige digitar "f") — ver ../hooks/use-typing-guard.ts.
  const handleSearchControlInput = useCallback((input: string) => {
    if (isPickingStatusRef.current) return;
    if (input === '/' && !isTyping()) {
      setIsSearching(true);
      return;
    }
    if (input === 'f' && !isTyping()) {
      // Abre já posicionado no filtro atual, para o usuário ver onde está.
      const start = Math.max(0, optionsRef.current.findIndex((o) => o.value === filterRef.current));
      statusIndexRef.current = start;
      setStatusIndex(start);
      setIsPickingStatus(true);
    }
  }, []);
  useInput(handleSearchControlInput);

  // Navegação do seletor de status.
  const handleStatusPickerInput = useCallback(
    (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean }) => {
      if (!isPickingStatusRef.current) return;
      const total = optionsRef.current.length;
      // A ref avança JUNTO com o estado: sincronizá-la só no render faz o
      // `Enter` logo após um `j`/`k` ler o índice ANTIGO (o React ainda não
      // commitou) e aplicar o filtro errado — mesmo defeito que o TextInput
      // tinha ao perder teclas digitadas rápido.
      const move = (delta: number): void => {
        const next = (statusIndexRef.current + delta + total) % total;
        statusIndexRef.current = next;
        setStatusIndex(next);
      };
      if (key.upArrow || input === 'k') {
        move(-1);
        return;
      }
      if (key.downArrow || input === 'j') {
        move(1);
        return;
      }
      if (key.return) {
        const picked = optionsRef.current[statusIndexRef.current];
        if (picked !== undefined) setStatusFilter(picked.value);
        setIsPickingStatus(false);
      }
    },
    [],
  );
  useInput(handleStatusPickerInput);

  // Navegação dos RESULTADOS da busca (setas + Enter). O campo de texto ignora
  // setas e Enter, então não há disputa: as letras seguem indo para a query.
  const handleSearchResultsInput = useCallback(
    (_input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean }) => {
      const items = searchItemsRef.current;
      if (!isSearchingRef.current || items.length === 0) return;
      if (key.upArrow) {
        setSearchIndex((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (key.downArrow) {
        setSearchIndex((i) => (i + 1) % items.length);
        return;
      }
      if (key.return) {
        const picked = items[searchIndexRef.current];
        if (picked !== undefined) {
          setSelectedIssueIdRef.current(picked.id);
          pushRef.current('issue-detail');
        }
      }
    },
    [],
  );
  useInput(handleSearchResultsInput);

  // #34 (M2-11): "t" abre o painel de jobs da sessão (`./jobs.js`) — só fora
  // da busca (mesma guarda de "/"/"f" acima: dentro do campo, "t" é texto da
  // query, não um atalho).
  const handleJobsShortcut = useCallback((input: string) => {
    if (input === 't' && !isTyping()) {
      pushRef.current('jobs');
    }
  }, []);
  useInput(handleJobsShortcut);

  const listWindow_ = listWindow(issues.length, selectedIndex, listHeight);

  const searchState = search.state;

  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1}>
      <Box>
        <Text color={theme.primary}>
          Minhas issues
        </Text>
        <Text color={statusFilterColor(theme, statusFilter, statusFilterLabel(statusOptions, statusFilter))}>
          {' '}
          [{statusFilterLabel(statusOptions, statusFilter)}]
        </Text>
        {/* A contagem é o SINAL de que o filtro foi aplicado: sem ela, trocar
            para um status que devolve o mesmo conjunto parecia não fazer nada. */}
        {state.status === 'loaded' ? (
          <Text color={theme.muted}>
            {` ${glyphs.middleDot} ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`}
          </Text>
        ) : null}
        {!isSearching && !isPickingStatus ? (
          <Text color={theme.muted}>
            {`  / busca ${glyphs.middleDot} f filtro ${glyphs.middleDot} t jobs`}
          </Text>
        ) : null}
      </Box>

      {isPickingStatus ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.primary}>Filtrar por status</Text>
          {statusOptions.map((option, i) => {
            const selected = i === statusIndex;
            const current = option.value === statusFilter;
            // Divisor entre os AGREGADOS do Redmine e os status da instância:
            // sem ele, "Fechadas" (agregado) e "Fechada" (status) ficam coladas
            // e parecem duplicata.
            const firstConcrete = typeof option.value === 'number' && typeof statusOptions[i - 1]?.value !== 'number';
            return (
              <Box key={String(option.value)} flexDirection="column">
                {firstConcrete ? (
                  <Text color={theme.border}>{`  ${'─'.repeat(18)}`}</Text>
                ) : null}
              <Box>
                <Text color={selected ? theme.primary : theme.muted}>
                  {selected ? symbols.pointer : ' '}{' '}
                </Text>
                <Text color={statusFilterColor(theme, option.value, option.label)}>
                  {option.label}
                </Text>
                {current ? <Text color={theme.muted}> {symbols.tick} atual</Text> : null}
              </Box>
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text color={theme.muted}>
              <Text color={theme.accent}>{`${glyphs.arrowUp}/${glyphs.arrowDown}`}</Text> escolhe{' '}
              {glyphs.middleDot} <Text color={theme.accent}>Enter</Text> aplica {glyphs.middleDot}{' '}
              <Text color={theme.accent}>Esc</Text> cancela
            </Text>
          </Box>
        </Box>
      ) : null}

      {isSearching ? (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={theme.primary}>Buscar: </Text>
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder={`digite para buscar${glyphs.ellipsis}`}
              isActive={isSearching}
            />
            <Text color={statusFilterColor(theme, statusFilter, statusFilterLabel(statusOptions, statusFilter))}>
              {' '}
              [{statusFilterLabel(statusOptions, statusFilter)}]
            </Text>
          </Box>

          {searchState.status === 'idle' ? (
            <Box marginTop={1}>
              <Text color={theme.muted}>Digite para buscar. Esc fecha a busca (o filtro de status é o f com a busca fechada).</Text>
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
              {/* Renderiza os itens ESTRUTURADOS, não o Markdown do bundle: o
                  `content` carrega fences `<untrusted-content>` — marcação
                  anti prompt-injection destinada ao LLM, que na interface é só
                  ruído para quem lê. */}
              {searchState.items.length === 0 ? (
                <Text color={theme.muted}>nenhuma issue encontrada</Text>
              ) : (
                searchState.items.map((item, index) => (
                  <SearchResultRow key={item.id} item={item} selected={index === searchIndex} />
                ))
              )}
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
                <Text color={theme.accent}>
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
                <Text color={theme.accent}>
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
              {/* Janela que ACOMPANHA o cursor: renderizar a lista inteira
                  estourava a altura do terminal com centenas de itens — o
                  rodapé saía da tela e o cursor, no topo, sumia. */}
              {state.issues.slice(listWindow_.start, listWindow_.end).map((issue, index) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  selected={listWindow_.start + index === selectedIndex}
                />
              ))}
              {state.issues.length > listWindow_.end - listWindow_.start ? (
                <Text color={theme.muted}>
                  {`  ${listWindow_.start + 1}-${listWindow_.end} de ${state.issues.length}`}
                  {listWindow_.start > 0 ? ` ${glyphs.arrowUp}` : ''}
                  {listWindow_.end < state.issues.length ? ` ${glyphs.arrowDown}` : ''}
                </Text>
              ) : null}
            </Box>
          ) : null}
        </>
      )}

      {/* Espaçador: ancora os atalhos no RODAPÉ (estilo nano/nvim/tmux). */}
      <Box flexGrow={1} />
      <Box marginTop={1}>
        <Text color={theme.muted}>
          {isSearching ? (
            <>
              <Text color={theme.accent}>
                Esc
              </Text>{' '}
              fecha a busca,{' '}
              <Text color={theme.accent}>{`${glyphs.arrowUp}/${glyphs.arrowDown}`}</Text> navega os
              resultados,{' '}
              <Text color={theme.accent}>Enter</Text> abre. O filtro é o{' '}
              <Text color={theme.accent}>f</Text> com a busca fechada.
            </>
          ) : (
            <>
              <Text color={theme.accent}>
                {`${glyphs.arrowUp}/${glyphs.arrowDown}`}
              </Text>{' '}
              navega,{' '}
              <Text color={theme.accent}>
                {`${glyphs.arrowLeft}/${glyphs.arrowRight}`}
              </Text>{' '}
              página,{' '}
              <Text color={theme.accent}>
                Enter
              </Text>{' '}
              abre a issue,{' '}
              <Text color={theme.accent}>
                /
              </Text>{' '}
              busca,{' '}
              <Text color={theme.accent}>
                t
              </Text>{' '}
              jobs,{' '}
              <Text color={theme.accent}>
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
