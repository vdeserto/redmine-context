/**
 * Tipos compartilhados da superfície CLI (M1-11).
 *
 * Isolados neste módulo para evitar ciclos entre `main.ts` (parse/dispatch) e
 * `commands.ts` (handlers) e manter cada arquivo com um propósito único.
 */

/** Dependências injetáveis do CLI — permitem testar I/O e prompts sem tocar o processo real. */
export interface RunDeps {
  /** Escreve no canal de saída (stdout) — recebe o bundle. */
  stdout(text: string): void;
  /** Escreve no canal de diagnóstico (stderr) — recebe progresso e mensagens. */
  stderr(text: string): void;
  /** Ambiente consultado para `REDMINE_URL` e pela cascata de credenciais. */
  env: NodeJS.ProcessEnv;
  /** Lê uma linha do usuário (ex.: URL, usuário). */
  prompt(question: string): Promise<string>;
  /** Lê um valor sensível sem echo (senha, api_key). */
  promptPassword(question: string): Promise<string>;
}

/** Resultado do parse manual de `argv`: posicionais + flags. */
export interface ParsedArgs {
  /** Argumentos posicionais na ordem (ex.: `['issue', '42']`). */
  positionals: string[];
  /** Flags parseadas: `true` para booleanas, string para as com valor. */
  flags: Map<string, string | boolean>;
}
