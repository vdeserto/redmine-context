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
