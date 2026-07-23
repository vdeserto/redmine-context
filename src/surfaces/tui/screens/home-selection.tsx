/**
 * Estado de seleção da home (#31), compartilhado entre `./home.tsx` e
 * `./issue-detail.tsx` sem prop-drilling.
 *
 * O roteador (`../screen.ts`/`../app.tsx`) renderiza cada tela SEM props e só
 * mantém montado o TOPO da pilha — ao empilhar `issue-detail` (Enter sobre
 * uma issue na home), `HomeScreen` é desmontada. Isso cria dois problemas que
 * este módulo resolve com um único contexto:
 *
 * 1. **Qual issue abrir**: `issue-detail` precisa saber o `id` da issue
 *    selecionada para buscá-la via `../hooks/use-issue-detail.js` — sem
 *    props entre telas, o único jeito de repassar essa informação é um
 *    estado compartilhado escrito pela home (`setSelectedIssueId`) e lido
 *    pelo detalhe (`selectedIssueId`).
 * 2. **Posição da lista ao voltar**: `selectedIndex` de
 *    `../hooks/use-list-navigation.js` vive num `useState` LOCAL ao
 *    componente — ele reseta para `0` a cada remount. Sem preservá-lo aqui,
 *    Esc/`b` a partir do detalhe devolveria o usuário ao topo da lista,
 *    mesmo que a issue aberta fosse a 10ª.
 *
 * Instanciado uma vez em `../app.tsx`, envolvendo toda a árvore de telas —
 * mesmo padrão do `OnboardingProvider` (`./onboarding/onboarding-context.tsx`),
 * que resolve o mesmo tipo de problema (estado compartilhado entre telas sem
 * props) para o fluxo de onboarding.
 *
 * ## Alternativas descartadas
 *
 * - **Adicionar parâmetros às telas** (`SCREENS` passaria a aceitar props):
 *   afetaria as 12 telas do registro (`../screen.ts`) e o contrato do
 *   roteador inteiro por uma necessidade de só duas telas — desproporcional.
 * - **Singleton de módulo** (uma variável fora de qualquer componente React,
 *   sem `Context`): funciona em produção, mas vaza estado entre execuções de
 *   teste (`render()` de um teste não reresetaria o singleton do teste
 *   seguinte) — um `Context` reinstanciado a cada `render()` evita esse
 *   acoplamento oculto.
 * - **Guardar no próprio `NavigationValue`** (`../navigation.tsx`): esse
 *   contrato é sobre QUAIS telas existem na pilha, não sobre o estado interno
 *   de uma tela específica — misturar os dois tornaria `navigation.tsx`
 *   acoplado a detalhes da home/detalhe de issue.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/** Valor exposto pelo contexto de seleção da home. */
export interface HomeSelectionValue {
  /**
   * Índice da linha destacada na lista da home — sobrevive ao push/pop de
   * `issue-detail` (ver o JSDoc do módulo). Semente lida por `initialIndex`
   * de `../hooks/use-list-navigation.js`.
   */
  selectedIndex: number;
  /** Atualiza o índice destacado — chamado pela home a cada mudança do cursor. */
  setSelectedIndex: (index: number) => void;
  /** Id da issue aberta em `issue-detail`, ou `undefined` antes de qualquer seleção. */
  selectedIssueId: number | undefined;
  /** Registra a issue selecionada — chamado pela home ao empilhar `issue-detail` (Enter). */
  setSelectedIssueId: (id: number) => void;
}

const HomeSelectionContext = createContext<HomeSelectionValue | undefined>(undefined);

/**
 * Provider do contexto de seleção da home — instanciado uma vez em
 * `../app.tsx`, envolvendo toda a árvore de telas (ver o JSDoc do módulo).
 */
export function HomeSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedIndex, setSelectedIndexState] = useState(0);
  const [selectedIssueId, setSelectedIssueIdState] = useState<number | undefined>(undefined);

  // Identidades ESTÁVEIS (useCallback sem deps, padrão do repo) — evita
  // resubscrições desnecessárias em quem os usa como dependência de efeito
  // (ex.: `../screens/home.tsx`).
  const setSelectedIndex = useCallback((index: number) => {
    setSelectedIndexState(index);
  }, []);
  const setSelectedIssueId = useCallback((id: number) => {
    setSelectedIssueIdState(id);
  }, []);

  const value: HomeSelectionValue = {
    selectedIndex,
    setSelectedIndex,
    selectedIssueId,
    setSelectedIssueId,
  };

  return <HomeSelectionContext.Provider value={value}>{children}</HomeSelectionContext.Provider>;
}

/**
 * Hook de seleção da home consumido por `./home.tsx`/`./issue-detail.tsx`.
 *
 * @throws {Error} Se chamado fora de um `<HomeSelectionProvider>` — indica
 *   erro de composição (tela renderizada sem passar pelo roteador).
 */
export function useHomeSelection(): HomeSelectionValue {
  const value = useContext(HomeSelectionContext);
  if (value === undefined) {
    throw new Error('useHomeSelection() usado fora de <HomeSelectionProvider>.');
  }
  return value;
}
