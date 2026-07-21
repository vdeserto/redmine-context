/**
 * Prompts interativos do CLI (M1-11) — leitura de linha e senha mascarada.
 *
 * Implementação mínima sobre o `readline` nativo (sem dependência de terceiros):
 * `prompt` lê uma linha com echo normal; `promptPassword` desliga o echo dos
 * caracteres digitados (sem eco — a senha nunca aparece no terminal nem em logs).
 * Os streams de entrada/saída são injetáveis para permitir testes determinísticos.
 */

import { createInterface, type Interface } from 'node:readline';

/** Streams de I/O do prompt; default: `process.stdin` / `process.stdout`. */
export interface PromptIo {
  /** Stream de entrada de onde a resposta é lida. */
  input: NodeJS.ReadableStream;
  /** Stream de saída onde a pergunta (e o echo) é escrita. */
  output: NodeJS.WritableStream;
}

/** I/O default apontando para o processo atual. */
function defaultIo(): PromptIo {
  return { input: process.stdin, output: process.stdout };
}

/**
 * Lê uma linha do usuário com echo normal.
 *
 * @param question - Texto exibido antes da entrada (ex.: `'Usuário: '`).
 * @param io - Streams de I/O (ver {@link PromptIo}). Default: stdin/stdout.
 * @returns A linha digitada (sem o `\n` final).
 * @example
 * const user = await prompt('Usuário: ');
 */
export function prompt(question: string, io: PromptIo = defaultIo()): Promise<string> {
  const rl: Interface = createInterface({ input: io.input, output: io.output });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Lê uma linha sensível (senha, api_key) SEM ecoar os caracteres digitados.
 *
 * A pergunta é escrita normalmente; a partir daí o writer interno do readline é
 * silenciado, de modo que nenhum caractere da entrada aparece no terminal.
 *
 * @param question - Texto exibido antes da entrada (ex.: `'Senha: '`).
 * @param io - Streams de I/O (ver {@link PromptIo}). Default: stdin/stdout.
 * @returns O valor digitado (sem o `\n` final), nunca ecoado.
 * @example
 * const password = await promptPassword('Senha: ');
 */
export function promptPassword(question: string, io: PromptIo = defaultIo()): Promise<string> {
  const { input, output } = io;
  const rl: Interface = createInterface({ input, output, terminal: true });
  // O readline expõe `_writeToOutput` como ponto de extensão do echo.
  const writer = rl as unknown as { _writeToOutput(text: string): void };
  let muted = false;
  writer._writeToOutput = (text: string): void => {
    if (!muted) {
      output.write(text);
    }
    // muted: engole o echo dos caracteres da senha (sem eco).
  };

  output.write(question);
  muted = true;

  return new Promise<string>((resolve) => {
    rl.question('', (answer) => {
      muted = false;
      rl.close();
      output.write('\n');
      resolve(answer);
    });
  });
}
