/**
 * Roteador de telas da TUI (M2-01).
 *
 * State machine simples (`useState<ScreenName>`) que troca o componente
 * renderizado via {@link NavigationProvider} — sem framework de rotas, são
 * poucas telas. Trata também o atalho global de saída (`q`), disponível em
 * qualquer tela. Também é o único lugar que instancia o {@link ThemeProvider}
 * (M2-02) — todas as telas herdam o mesmo tema por estarem abaixo dele.
 */
import { useApp, useInput } from 'ink';
import { useState } from 'react';

import { NavigationProvider } from './navigation.js';
import { INITIAL_SCREEN, SCREENS, type ScreenName } from './screen.js';
import { ThemeProvider } from './theme.js';

/** App raiz da TUI: roteia entre telas e sai do processo com `q`. */
export function App() {
  const [current, setCurrent] = useState<ScreenName>(INITIAL_SCREEN);
  const { exit } = useApp();

  useInput((input) => {
    if (input === 'q') {
      exit();
    }
  });

  const Screen = SCREENS[current];
  return (
    <ThemeProvider>
      <NavigationProvider value={{ current, navigate: setCurrent }}>
        <Screen />
      </NavigationProvider>
    </ThemeProvider>
  );
}
