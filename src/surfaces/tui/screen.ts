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
import { ExportScreen } from './screens/export.js';
import { HomeScreen } from './screens/home.js';
import { IssueDetailScreen } from './screens/issue-detail.js';
import { OnboardingApiKeyScreen } from './screens/onboarding/api-key.js';
import { OnboardingLoginScreen } from './screens/onboarding/login.js';
import { OnboardingModeScreen } from './screens/onboarding/mode.js';
import { OnboardingSuccessScreen } from './screens/onboarding/success.js';
import { OnboardingUrlScreen } from './screens/onboarding/url.js';
import { OnboardingValidatingScreen } from './screens/onboarding/validating.js';
import { WelcomeScreen } from './screens/welcome.js';
import { symbols } from './symbols.js';

/** Nomes de tela conhecidos pelo roteador (state machine simples). */
export type ScreenName =
  | 'welcome'
  | 'about'
  | 'doctor'
  | 'config'
  | 'home'
  | 'issue-detail'
  | 'export'
  | 'onboarding-url'
  | 'onboarding-mode'
  | 'onboarding-login'
  | 'onboarding-validating'
  | 'onboarding-api-key'
  | 'onboarding-success';

/** Tela renderizada ao abrir a TUI (base da pilha de navegação). */
export const INITIAL_SCREEN: ScreenName = 'welcome';

/** Entrada do registro de telas: componente renderizável + título para o breadcrumb. */
export interface ScreenEntry {
  /** Componente Ink renderizado para a tela. */
  component: ComponentType;
  /** Título legível — usado pelo breadcrumb fixo (`components/breadcrumb.tsx`). */
  title: string;
}

/**
 * Mapa tela -> entrada, consultado pelo roteador a cada troca e pelo
 * breadcrumb. As três telas de onboarding (M2-05.1, issue #27) usam
 * `Onboarding <separador> <passo>` como título — o mesmo separador do
 * breadcrumb entre frames da pilha (`symbols.pointerSmall`) — para que o
 * caminho fique auto-descritivo mesmo isolado (ex.: "Início › Onboarding › URL").
 */
export const SCREENS: Record<ScreenName, ScreenEntry> = {
  welcome: { component: WelcomeScreen, title: 'Início' },
  about: { component: AboutScreen, title: 'Atalhos' },
  doctor: { component: DoctorScreen, title: 'Doctor' },
  config: { component: ConfigScreen, title: 'Configuração' },
  home: { component: HomeScreen, title: 'Minhas issues' },
  'issue-detail': { component: IssueDetailScreen, title: 'Detalhe da issue' },
  export: { component: ExportScreen, title: 'Exportar' },
  'onboarding-url': { component: OnboardingUrlScreen, title: `Onboarding ${symbols.pointerSmall} URL` },
  'onboarding-mode': { component: OnboardingModeScreen, title: `Onboarding ${symbols.pointerSmall} Modo` },
  'onboarding-login': { component: OnboardingLoginScreen, title: `Onboarding ${symbols.pointerSmall} Login` },
  'onboarding-validating': {
    component: OnboardingValidatingScreen,
    title: `Onboarding ${symbols.pointerSmall} Validando`,
  },
  'onboarding-api-key': {
    component: OnboardingApiKeyScreen,
    title: `Onboarding ${symbols.pointerSmall} api_key`,
  },
  'onboarding-success': {
    component: OnboardingSuccessScreen,
    title: `Onboarding ${symbols.pointerSmall} Sucesso`,
  },
};
