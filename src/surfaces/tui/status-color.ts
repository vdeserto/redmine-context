/**
 * Heurística de cor de status compartilhada entre telas de issue (M2-06/#29,
 * extraída na #31 para ser reaproveitada por `screens/issue-detail.tsx` sem
 * duplicar a lógica antes privada de `screens/home.tsx`).
 *
 * Sempre devolve um token do tema (nunca um literal de cor) — a varredura
 * anti-hardcode (`tests/surfaces/tui/no-hardcoded-colors.test.ts`) cobre
 * qualquer arquivo desta árvore.
 */
import type { Theme } from './theme.js';

/**
 * Cor do badge de status: heurística por nome do status. `theme.primary` é o
 * fallback para status sem correspondência (ex.: "Nova", "Em espera").
 *
 * @param theme - Tema ativo (via `useTheme()` no chamador).
 * @param statusName - Nome do status vindo do Redmine (`issue.status.name`).
 * @returns O token de cor do tema mais adequado ao status.
 * @example
 * statusColor(theme, 'Fechado') // theme.success
 */
export function statusColor(theme: Theme, statusName: string): string {
  const normalized = statusName.toLowerCase();
  if (/fechad|closed|resolvid|resolved|conclu[ií]d/.test(normalized)) {
    return theme.success;
  }
  if (/cancel/.test(normalized)) {
    return theme.danger;
  }
  if (/andamento|progress|curso/.test(normalized)) {
    return theme.warning;
  }
  return theme.primary;
}

/**
 * Cor do badge do FILTRO rápido de status (`f` na home).
 *
 * Coerente com {@link statusColor}, que já pinta "fechado" de `success` e usa
 * `primary` para o estado ativo — assim o badge do filtro e o badge de cada
 * issue na lista não contam histórias diferentes sobre a mesma palavra.
 *
 * `all` fica em `muted` de propósito: é a ausência de filtro, e um badge
 * chamativo aí competiria com o conteúdo. Os dois estados FILTRADOS puxam cor,
 * que é o sinal de "tem filtro ligado".
 *
 * Contraste: todos são tokens do tema, calibrados por paleta (as claras usam
 * cores saturadas, as escuras cores claras) — ver `./palettes.ts`.
 *
 * @param theme - Tema ativo.
 * @param filter - Filtro rápido corrente.
 * @returns O token de cor do tema para o badge.
 */
export function statusFilterColor(theme: Theme, filter: 'open' | 'closed' | 'all'): string {
  if (filter === 'open') return theme.primary;
  if (filter === 'closed') return theme.success;
  return theme.muted;
}
