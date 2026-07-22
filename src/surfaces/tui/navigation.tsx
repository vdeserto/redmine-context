/**
 * Contexto de navegação da TUI (M2-01).
 *
 * Expõe a tela atual e `navigate()` para as telas trocarem de tela sem
 * prop-drilling; o roteador (`app.tsx`) é o único lugar que instancia o
 * `Provider` e possui o estado real (`useState<ScreenName>`).
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { ScreenName } from './screen.js';

/** Valor exposto pelo contexto de navegação. */
export interface NavigationValue {
  /** Nome da tela atualmente roteada. */
  current: ScreenName;
  /** Troca a tela atual — dispara o re-render do roteador. */
  navigate(next: ScreenName): void;
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
