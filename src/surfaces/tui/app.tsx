/**
 * Roteador de telas da TUI (M2-01).
 *
 * State machine simples (`useState<ScreenName>`) que troca o componente
 * renderizado via {@link NavigationProvider} — sem framework de rotas, são
 * poucas telas. Trata também o atalho global de saída (`q`), disponível em
 * qualquer tela.
 */
import { useApp, useInput } from 'ink';
import { useState } from 'react';

import { NavigationProvider } from './navigation.js';
import { INITIAL_SCREEN, SCREENS, type ScreenName } from './screen.js';

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
    <NavigationProvider value={{ current, navigate: setCurrent }}>
      <Screen />
    </NavigationProvider>
  );
}
