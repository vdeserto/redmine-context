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
 * Sessão de prompts compartilhando UMA única `readline.Interface`.
 *
 * Abrir e fechar interfaces sucessivas sobre o mesmo stdin perde entrada
 * bufferizada e pausa o stream (bug #106: o login travava entre o prompt de
 * usuário e o de senha). A sessão cria a interface de forma lazy no primeiro
 * prompt e a mantém viva até `close()`.
 */
export interface PromptSession {
  /** Lê uma linha com echo normal. */
  prompt(question: string): Promise<string>;
  /** Lê uma linha sensível SEM ecoar os caracteres. */
  promptPassword(question: string): Promise<string>;
  /** Encerra a interface (idempotente). Obrigatório ao fim do fluxo. */
  close(): void;
}

/**
 * Cria uma {@link PromptSession} sobre os streams informados.
 *
 * @param io - Streams de I/O (ver {@link PromptIo}). Default: stdin/stdout.
 * @returns Sessão com `prompt`/`promptPassword`/`close`.
 * @example
 * const session = createPromptSession();
 * const user = await session.prompt('Usuário: ');
 * const pass = await session.promptPassword('Senha: ');
 * session.close();
 */
export function createPromptSession(io: PromptIo = defaultIo()): PromptSession {
  let rl: Interface | undefined;
  let muted = false;
  // Fila própria: o readline EMITE 'line' assim que a entrada chega (pipes e
  // colagens entregam várias linhas de uma vez) e eventos sem ouvinte com
  // pergunta pendente se perderiam — segunda metade do bug #106.
  const pending: string[] = [];
  const waiters: Array<(line: string) => void> = [];

  const ensure = (): Interface => {
    if (rl === undefined) {
      const created = createInterface({ input: io.input, output: io.output });
      const writer = created as unknown as { _writeToOutput(text: string): void };
      writer._writeToOutput = (text: string): void => {
        if (!muted) {
          io.output.write(text);
        }
        // muted: engole o echo dos caracteres sensíveis.
      };
      created.on('line', (line: string) => {
        const waiter = waiters.shift();
        if (waiter) {
          waiter(line);
        } else {
          pending.push(line);
        }
      });
      // EOF (Ctrl+D / pipe encerrado) com prompt pendente: resolve vazio para o
      // fluxo falhar com mensagem clara em vez de o processo morrer em silêncio.
      created.on('close', () => {
        while (waiters.length > 0) {
          waiters.shift()?.('');
        }
      });
      rl = created;
    }
    return rl;
  };

  const nextLine = (): Promise<string> => {
    const queued = pending.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise<string>((resolve) => {
      waiters.push(resolve);
    });
  };

  const ask = async (question: string, mute: boolean): Promise<string> => {
    ensure();
    io.output.write(question);
    muted = mute;
    try {
      return await nextLine();
    } finally {
      muted = false;
      if (mute) {
        io.output.write('\n');
      }
    }
  };

  return {
    prompt: (question) => ask(question, false),
    promptPassword: (question) => ask(question, true),
    close: (): void => {
      rl?.close();
      rl = undefined;
    },
  };
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
