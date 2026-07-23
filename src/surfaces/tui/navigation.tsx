/**
 * Contexto de navegação da TUI (M2-01, evoluído em M2-04 para uma PILHA de
 * telas).
 *
 * Expõe a pilha de telas navegadas — a base (índice 0) é sempre a tela
 * inicial, o topo (`stack.at(-1)`) é a tela renderizada — e as operações que
 * a manipulam: `push` (avança, empilha), `pop` (volta, usado pelo Esc
 * global em `app.tsx`) e `replace` (troca o topo sem aumentar a
 * profundidade). O breadcrumb fixo (`components/breadcrumb.tsx`) lê `stack`
 * direto para renderizar o caminho "Início › Atalhos".
 *
 * `navigate()` é mantido como alias de `push()` — nome original da API do
 * M2-01 — para que as telas existentes (`screens/welcome.tsx`) não
 * precisassem ser reescritas junto desta evolução.
 *
 * O roteador (`app.tsx`) é o único lugar que instancia o `Provider`; o
 * estado real da pilha vive em {@link useNavigationStack}, extraído para cá
 * (em vez de inline no roteador) para poder ser testado isoladamente, sem
 * depender de handlers de teclado.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import type { ScreenName } from './screen.js';

/** Valor exposto pelo contexto de navegação. */
export interface NavigationValue {
  /** Pilha de telas navegadas — a base (índice 0) é sempre a tela inicial. */
  stack: readonly ScreenName[];
  /** Tela atualmente roteada — sempre o topo da pilha (`stack.at(-1)`). */
  current: ScreenName;
  /** Empilha uma nova tela (navegação "para frente"). */
  push(next: ScreenName): void;
  /** Alias de {@link push} — nome original da API do M2-01, mantido por compat. */
  navigate(next: ScreenName): void;
  /** Desempilha a tela atual, voltando à anterior. Nada faz na raiz (pilha com 1 item). */
  pop(): void;
  /** Substitui o topo da pilha por outra tela, sem alterar a profundidade. */
  replace(next: ScreenName): void;
  /** Zera a pilha para uma única tela (fim de fluxo multi-tela). */
  resetTo(next: ScreenName): void;
}

const NavigationContext = createContext<NavigationValue | undefined>(undefined);

/** Provider do contexto de navegação — usado apenas pelo roteador (`app.tsx`). */
export function NavigationProvider({
  value,
  children,
}: {
  value: NavigationValue;
  children: ReactNode;
}) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

/**
 * Hook de navegação consumido pelas telas.
 *
 * @throws {Error} Se chamado fora de um `<NavigationProvider>` — indica erro
 *   de composição (tela renderizada sem passar pelo roteador).
 */
export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (value === undefined) {
    throw new Error('useNavigation() usado fora de <NavigationProvider>.');
  }
  return value;
}

/**
 * Estado real da pilha de navegação — hook interno usado apenas pelo
 * roteador (`app.tsx`), que instancia o `NavigationProvider` com o valor
 * retornado aqui.
 *
 * @param initial Tela na base da pilha (única tela quando o app abre).
 */
export function useNavigationStack(initial: ScreenName): NavigationValue {
  const [stack, setStack] = useState<ScreenName[]>([initial]);

  const push = useCallback((next: ScreenName) => {
    setStack((current) => [...current, next]);
  }, []);

  const pop = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  const replace = useCallback((next: ScreenName) => {
    setStack((current) => [...current.slice(0, -1), next]);
  }, []);

  // Zera a pilha para uma única tela — fim de fluxos multi-tela (ex.: splash
  // do onboarding, logout): sem isso, Esc "voltaria" para telas do fluxo
  // encerrado que continuam empilhadas por baixo.
  const resetTo = useCallback((next: ScreenName) => {
    setStack(() => [next]);
  }, []);

  // Reason: a pilha sempre tem ao menos 1 item (inicializada com `initial`,
  // `pop()` nunca a esvazia) — o fallback só existe para satisfazer
  // `noUncheckedIndexedAccess` do TypeScript, nunca é de fato alcançado.
  const current = stack[stack.length - 1] ?? initial;

  return { stack, current, push, navigate: push, pop, replace, resetTo };
}
