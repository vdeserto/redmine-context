/**
 * Decisão de degradação da TUI Ink (M2-03).
 *
 * Centraliza em uma função pura quando o `redmine-context` sem argumentos
 * pode abrir a TUI Ink vs. quando deve cair para o caminho de texto puro da
 * CLI (help). Sinais de degradação (qualquer um basta):
 *
 * - `NO_COLOR` definida (qualquer valor, inclusive string vazia — convenção
 *   de https://no-color.org: a mera presença da variável já sinaliza a
 *   preferência do usuário/ambiente por saída sem formatação);
 * - `CI=true` (ambientes de integração contínua não têm um terminal real);
 * - stdout não é um TTY (pipe, redirecionamento para arquivo, etc.).
 *
 * Pura e testável isoladamente: recebe `env` e `isTTY` em vez de ler
 * `process.env`/`process.stdout` diretamente, seguindo o padrão de
 * dependências injetáveis do CLI (`RunDeps`, ver `./types.ts`).
 */

/**
 * Decide se a TUI Ink pode ser aberta.
 *
 * @param env - Ambiente do processo (ou um subconjunto controlado em testes).
 * @param isTTY - `true` quando o stdout real é um TTY.
 * @returns `true` somente quando não há nenhum sinal de degradação.
 * @example
 * shouldRenderTui(process.env, process.stdout.isTTY === true);
 */
export function shouldRenderTui(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (!isTTY) return false;
  if (env.NO_COLOR !== undefined) return false;
  if (env.CI === 'true') return false;
  return true;
}
