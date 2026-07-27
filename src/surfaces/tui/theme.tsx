/**
 * Tema central da TUI (M2-02).
 *
 * Fonte de literais de cor da TUI (junto de `palettes.ts`, #190, que guarda os
 * hex das paletas como DADOS de objeto, não como props JSX): toda tela consome
 * cores via {@link useTheme}, nunca com `color="magenta"` direto no JSX — a
 * varredura `tests/surfaces/tui/no-hardcoded-colors.test.ts` garante isso em CI
 * (ela pega `color=`/`backgroundColor=` com literal; as chaves `primary:` de
 * `palettes.ts` não são props, por isso passam). Centralizar aqui/em `palettes.ts`
 * torna trocar a paleta uma mudança localizada.
 *
 * ## Paleta e guideline de uso
 *
 * Combinação sóbria sobre fundo escuro (a paleta padrão de 16 cores do
 * terminal, resolvida pelo próprio emulador — sem hex fixo, para respeitar o
 * esquema de cores do usuário):
 *
 * - **primary** (`cyan`) — cor de identidade/foco: títulos, item selecionado,
 *   estado ativo. É a cor mais usada na TUI; se uma tela parece "sem cor
 *   nenhuma", provavelmente falta um `primary` nela.
 * - **accent** (`magenta`) — destaque raro: uma call-to-action pontual (ex.:
 *   a tecla que o usuário deve apertar agora). Usar com moderação — se
 *   `accent` aparece em toda linha da tela, ele deixou de ser um destaque.
 * - **muted** (`gray`) — texto secundário/de apoio: dicas, timestamps,
 *   metadados. Substitui o uso solto de `dimColor` por um tom deliberado.
 * - **success** (`green`) / **warning** (`yellow`) / **danger** (`red`) —
 *   reservadas para *estado*, nunca para decoração: resultado de uma
 *   operação (sucesso/erro) ou um alerta acionável. Não usar `danger` só
 *   porque "fica bonito" — é reservada para sinalizar problema real.
 *
 * Reaproveita os nomes de cor nativos do Ink/chalk (paleta ANSI de 16 cores),
 * então funciona em qualquer terminal sem depender de suporte a true color.
 */
import { createContext, useContext, type ReactNode } from 'react';

/**
 * Tokens semânticos de cor da TUI.
 *
 * Os valores são nomes de cor aceitos por `color`/`backgroundColor` do Ink
 * (ver guideline de uso no topo do arquivo).
 */
export interface Theme {
  /** Identidade/foco: títulos, seleção, estado ativo. */
  primary: string;
  /** Destaque raro: uma call-to-action pontual por tela. */
  accent: string;
  /** Texto secundário/de apoio: dicas, metadados. */
  muted: string;
  /** Resultado positivo de uma operação. */
  success: string;
  /** Alerta acionável, não bloqueante. */
  warning: string;
  /** Erro ou operação que falhou. */
  danger: string;
  /** Bordas de Box (painéis, cards, modais). Discreta por padrão. */
  border: string;
  /**
   * Segunda cor de identidade (opcional) — variedade em listas/cabeçalhos sem
   * abusar do `accent`. Ausente ⇒ cai em {@link Theme.primary}.
   */
  secondary?: string;
  /**
   * Cor de FUNDO da paleta (opcional, #190). RESERVADA — hoje NÃO é consumida:
   * o full-screen usa o alt-screen sem pintar um fundo sólido (pintar deixava uma
   * emenda no topo e um retângulo que não cobria a tela toda — #190 polish). Fica
   * na paleta para um eventual modo "fundo temático" opt-in no futuro.
   */
  background?: string;
  /**
   * Ramp de cores (2+ hex) para efeitos de GRADIENTE em títulos/breadcrumb
   * (opcional, #190). Ausente ⇒ texto sólido em {@link Theme.primary}.
   */
  gradient?: readonly string[];
}

/** Tema padrão da TUI — ver guideline de uso na documentação do arquivo. */
export const DEFAULT_THEME: Theme = {
  primary: 'cyan',
  accent: 'magenta',
  muted: 'gray',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  border: 'gray',
};

const ThemeContext = createContext<Theme | undefined>(undefined);

/**
 * Provider do tema — envolve toda a árvore da TUI em `app.tsx`.
 *
 * Aceita um `theme` customizado (para testes ou temas alternativos
 * futuros); sem ele, usa {@link DEFAULT_THEME}.
 */
export function ThemeProvider({
  theme = DEFAULT_THEME,
  children,
}: {
  theme?: Theme;
  children: ReactNode;
}) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/**
 * Hook de tema consumido pelas telas — única forma permitida de obter uma
 * cor na TUI (ver varredura anti-hardcode).
 *
 * @throws {Error} Se chamado fora de um `<ThemeProvider>` — indica erro de
 *   composição (tela renderizada sem passar pelo roteador/`app.tsx`).
 */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === undefined) {
    throw new Error('useTheme() usado fora de <ThemeProvider>.');
  }
  return theme;
}

/**
 * Controlador de PALETA (#190) — permite ao seletor de tema trocar a paleta ao
 * vivo (preview ao navegar) e confirmar (persistindo). Fornecido pelo `App`, que
 * mantém o estado da paleta ativa e o repassa ao {@link ThemeProvider}.
 */
export interface ThemeController {
  /** Id da paleta atualmente ativa. */
  readonly paletteId: string;
  /** Aplica uma paleta AO VIVO, sem persistir (preview ao navegar no seletor). */
  preview(id: string): void;
  /** Aplica E persiste a paleta (Enter no seletor). */
  select(id: string): Promise<void>;
}

const ThemeControllerContext = createContext<ThemeController | undefined>(undefined);

/** Provider do controlador de paleta — montado pelo `App`. */
export function ThemeControllerProvider({
  value,
  children,
}: {
  value: ThemeController;
  children: ReactNode;
}) {
  return <ThemeControllerContext.Provider value={value}>{children}</ThemeControllerContext.Provider>;
}

/**
 * Hook do controlador de paleta — usado pelo seletor de tema.
 *
 * @throws {Error} Se chamado fora de um `<ThemeControllerProvider>`.
 */
export function useThemeController(): ThemeController {
  const controller = useContext(ThemeControllerContext);
  if (controller === undefined) {
    throw new Error('useThemeController() usado fora de <ThemeControllerProvider>.');
  }
  return controller;
}

/**
 * Mapeamento previsto para `@inkjs/ui` (dependência já presente no projeto,
 * ainda não consumida por nenhuma tela — nada é importado daqui, isso é só o
 * plano de integração para quando o primeiro componente entrar).
 *
 * `@inkjs/ui` recebe cores por `extendTheme(defaultTheme, { components })`
 * (ver docs da lib). Quando isso acontecer, a extensão deve ler os tokens
 * daqui em vez de duplicar paleta:
 *
 * ```tsx
 * import { extendTheme, defaultTheme } from '@inkjs/ui';
 * import { DEFAULT_THEME } from './theme.js';
 *
 * const inkUiTheme = extendTheme(defaultTheme, {
 *   components: {
 *     Spinner: { styles: { frame: () => ({ color: DEFAULT_THEME.primary }) } },
 *     Select: {
 *       styles: {
 *         focusIndicator: () => ({ color: DEFAULT_THEME.primary }),
 *         highlightedText: () => ({ color: DEFAULT_THEME.accent }),
 *       },
 *     },
 *     // ...demais componentes do @inkjs/ui conforme forem adotados.
 *   },
 * });
 * ```
 *
 * Se `@inkjs/ui` ganhar suporte a um tema dinâmico (não apenas estático no
 * módulo), essa extensão deve ser recalculada dentro de um hook que chame
 * {@link useTheme} — hoje o tema é estático, então o esboço acima já é
 * suficiente como referência.
 */
