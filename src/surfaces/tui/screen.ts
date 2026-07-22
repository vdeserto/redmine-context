/**
 * Registro de telas da TUI (roteador, M2-01).
 *
 * Cada tela é um componente Ink sem props — recebe apenas o contexto de
 * navegação via `useNavigation()`. Adicionar uma tela nova é registrar aqui
 * (`SCREENS`) e estender {@link ScreenName}; o roteador (`app.tsx`) não muda.
 */
import type { ComponentType } from 'react';

import { AboutScreen } from './screens/about.js';
import { WelcomeScreen } from './screens/welcome.js';

/** Nomes de tela conhecidos pelo roteador (state machine simples). */
export type ScreenName = 'welcome' | 'about';

/** Tela renderizada ao abrir a TUI. */
export const INITIAL_SCREEN: ScreenName = 'welcome';

/** Mapa tela -> componente, consultado pelo roteador a cada troca. */
export const SCREENS: Record<ScreenName, ComponentType> = {
  welcome: WelcomeScreen,
  about: AboutScreen,
};
