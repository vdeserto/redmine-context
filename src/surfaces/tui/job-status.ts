/**
 * Mapeamento visual do status de job (#34/M2-11) — ícone (com fallback ASCII
 * via `./symbols.ts`) e cor (token do tema) para cada {@link JobStatus},
 * consumido por `./screens/jobs.tsx`. Mesmo padrão de `./attachment-status.ts`,
 * extraído para um módulo à parte para poder ser testado sem montar a tela.
 *
 * `processing` não tem um ícone estático — o painel usa o `Spinner` já
 * existente (`./components/spinner.tsx`) para esse estado, então
 * {@link jobStatusIcon} devolve `undefined` para ele (ver a doc da função).
 */
import type { JobStatus } from './job-registry.js';
import { symbols } from './symbols.js';
import type { Theme } from './theme.js';

/**
 * Cor (token do tema) do ícone/rótulo de status — nunca uma cor literal
 * (varredura anti-hardcode, `tests/surfaces/tui/no-hardcoded-colors.test.ts`).
 *
 * `pending` = `muted` (neutro, aguardando), `processing` = `primary`
 * (operação ativa, mesma cor do `Spinner`), `done` = `success`, `failed` =
 * `danger`.
 *
 * @param theme - Tema ativo (via `useTheme()` no chamador).
 * @param status - Status do job.
 * @returns O token de cor do tema mais adequado ao status.
 */
export function jobStatusColor(theme: Theme, status: JobStatus): string {
  switch (status) {
    case 'pending':
      return theme.muted;
    case 'processing':
      return theme.primary;
    case 'done':
      return theme.success;
    case 'failed':
      return theme.danger;
    default: {
      // Exaustividade: se a união ganhar um novo membro sem atualizar este
      // switch, o typecheck falha aqui (nunca em runtime).
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
}

/**
 * Ícone estático do status, ou `undefined` para `processing` — nesse caso o
 * painel (`./screens/jobs.tsx`) renderiza o `Spinner` animado existente em
 * vez de um ícone parado.
 *
 * @param status - Status do job.
 * @returns O símbolo (de `./symbols.ts`, com fallback ASCII automático) ou
 *   `undefined`.
 * @example
 * jobStatusIcon('done')       // symbols.tick
 * jobStatusIcon('processing') // undefined — usar <Spinner /> no lugar
 */
export function jobStatusIcon(status: JobStatus): string | undefined {
  switch (status) {
    case 'pending':
      return symbols.circle;
    case 'processing':
      return undefined;
    case 'done':
      return symbols.tick;
    case 'failed':
      return symbols.cross;
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
}

/**
 * Rótulo textual (pt-BR) do status, exibido ao lado do label do job.
 *
 * @param status - Status do job.
 * @returns O rótulo a exibir (ex.: `[concluído]`).
 */
export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return 'pendente';
    case 'processing':
      return 'processando';
    case 'done':
      return 'concluído';
    case 'failed':
      return 'falhou';
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
}
