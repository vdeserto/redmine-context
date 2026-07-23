/**
 * Registro de telas da TUI (roteador, M2-01; título adicionado no M2-04).
 *
 * Cada tela é um componente Ink sem props — recebe apenas o contexto de
 * navegação via `useNavigation()`. Cada entrada também carrega um `title`
 * legível, consumido pelo breadcrumb fixo (`components/breadcrumb.tsx`)
 * para renderizar o caminho da pilha ("Início › Atalhos"). Adicionar uma
 * tela nova é registrar aqui (`SCREENS`) e estender {@link ScreenName}; o
 * roteador (`app.tsx`) não muda.
 */
import type { ComponentType } from 'react';

import { AboutScreen } from './screens/about.js';
import { ConfigScreen } from './screens/config.js';
import { DoctorScreen } from './screens/doctor.js';
import { WelcomeScreen } from './screens/welcome.js';

/** Nomes de tela conhecidos pelo roteador (state machine simples). */
export type ScreenName = 'welcome' | 'about' | 'doctor' | 'config';

/** Tela renderizada ao abrir a TUI (base da pilha de navegação). */
export const INITIAL_SCREEN: ScreenName = 'welcome';

/** Entrada do registro de telas: componente renderizável + título para o breadcrumb. */
export interface ScreenEntry {
  /** Componente Ink renderizado para a tela. */
  component: ComponentType;
  /** Título legível — usado pelo breadcrumb fixo (`components/breadcrumb.tsx`). */
  title: string;
}

/** Mapa tela -> entrada, consultado pelo roteador a cada troca e pelo breadcrumb. */
export const SCREENS: Record<ScreenName, ScreenEntry> = {
  welcome: { component: WelcomeScreen, title: 'Início' },
  about: { component: AboutScreen, title: 'Atalhos' },
  doctor: { component: DoctorScreen, title: 'Doctor' },
  config: { component: ConfigScreen, title: 'Configuração' },
};
