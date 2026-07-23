/**
 * Padrão reutilizável de navegação em listas da TUI (M2-04).
 *
 * Encapsula o `useInput()` comum a toda lista selecionável: setas ↑/↓ (ou
 * `j`/`k`, atalhos vim-like opcionais) movem `selectedIndex` com wrap nas
 * pontas; Enter confirma via `onSelect`. Cada tela de lista (M2-06 é a
 * primeira a consumir isso) só precisa chamar o hook com o total de itens —
 * nenhuma tela reimplementa esse teclado do zero.
 *
 * Esc (voltar) e Ctrl+C (sair) NÃO são tratados aqui — são atalhos globais
 * do roteador (`../app.tsx`, `use-exit-guard.ts`), fora do escopo de uma
 * lista específica.
 */
import { useInput } from 'ink';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/** Opções do hook — todas opcionais. */
export interface UseListNavigationOptions {
  /**
   * Chamado com o índice atual quando o usuário confirma a seleção (Enter).
   * Opcional: uma lista somente de exibição pode omitir e ler apenas
   * `selectedIndex`.
   */
  onSelect?: (index: number) => void;
  /**
   * Desliga a captura de teclado deste hook quando `false` (mesmo padrão de
   * `isActive` do `../components/text-input.tsx`) — necessário quando outro
   * campo da mesma tela está temporariamente "dono" do teclado (ex.: a busca
   * inline da home, M2-07/#30). Default: `true`.
   */
  isActive?: boolean;
  /**
   * Cursor inicial — default `0`. Aplicado assim que `itemCount` deixa de
   * ser `0` pela primeira vez (clampado); mudanças subsequentes NÃO
   * reposicionam o cursor (preservação de seleção entre remounts — #31).
   */
  initialIndex?: number;
}

/** Valor retornado pelo hook. */
export interface UseListNavigationResult {
  /** Índice selecionado (0-based), sempre dentro de `[0, itemCount - 1]`. */
  selectedIndex: number;
  /** Setter direto — útil para resetar a seleção quando a lista troca de conteúdo (ex.: novo filtro). */
  setSelectedIndex: Dispatch<SetStateAction<number>>;
}

/**
 * Hook de navegação em lista: setas/`j`/`k` movem `selectedIndex` com wrap,
 * Enter confirma via `onSelect`.
 *
 * @param itemCount Total de itens navegáveis. `0` desativa a navegação (sem
 *   quebrar — apenas nada acontece, a lista está vazia).
 * @param options Ver {@link UseListNavigationOptions}.
 *
 * @example
 * const { selectedIndex } = useListNavigation(issues.length, {
 *   onSelect: (index) => push('issue-detail'),
 * });
 */
export function useListNavigation(
  itemCount: number,
  options: UseListNavigationOptions = {},
): UseListNavigationResult {
  const { onSelect, isActive = true, initialIndex } = options;
  // Ref (não dep de efeito): a aplicação do `initialIndex` deve acontecer uma
  // única vez, na primeira vez que a lista deixa de estar vazia — mesmo que
  // `initialIndex` mude entre renders (ex.: o contexto de origem re-renderiza
  // por outro motivo).
  const appliedInitialRef = useRef(false);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (itemCount <= 0) {
      // Nada para clampar ainda — o efeito abaixo aplica `initialIndex` assim
      // que `itemCount` deixar de ser 0 (ex.: lista ainda carregando).
      return 0;
    }
    appliedInitialRef.current = true;
    return Math.min(Math.max(initialIndex ?? 0, 0), itemCount - 1);
  });

  useInput(
    (input, key) => {
      if (itemCount <= 0) {
        return;
      }

      if (key.upArrow || input === 'k') {
        setSelectedIndex((current) => (current - 1 + itemCount) % itemCount);
        return;
      }

      if (key.downArrow || input === 'j') {
        setSelectedIndex((current) => (current + 1) % itemCount);
        return;
      }

      if (key.return) {
        onSelect?.(selectedIndex);
      }
    },
    { isActive },
  );

  // Reason: mantém `selectedIndex` dentro dos limites quando `itemCount`
  // encolhe (ex.: um filtro reduz a lista) — evita um índice "fantasma" que
  // aponta para fora do array de itens da tela. Também é o gatilho de
  // aplicação do `initialIndex` (#31): na primeira vez que `itemCount` deixa
  // de ser 0, usa `initialIndex` (se informado) como base em vez do cursor
  // atual — cobre tanto o caso síncrono (lista já não-vazia no primeiro
  // render) quanto o assíncrono (lista carrega depois, ex.: `home.tsx`).
  useEffect(() => {
    setSelectedIndex((current) => {
      if (itemCount <= 0) {
        return 0;
      }
      const base = !appliedInitialRef.current && initialIndex !== undefined ? initialIndex : current;
      appliedInitialRef.current = true;
      return Math.min(Math.max(base, 0), itemCount - 1);
    });
    // Reason: `initialIndex` é intencionalmente OMITIDO das deps — é lido só
    // na aplicação única controlada por `appliedInitialRef`, nunca deve
    // reexecutar este efeito por si só (ver o JSDoc da opção).
  }, [itemCount]);

  return { selectedIndex, setSelectedIndex };
}
