import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createPromptSession, prompt, promptPassword } from '../../../src/surfaces/cli/prompts.js';

/** Cria streams de I/O em memória e acumula o que é escrito na saída. */
function makeIo() {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
  });
  return { input, output, out: () => written };
}

describe('prompts do CLI', () => {
  it('prompt lê uma linha e escreve a pergunta', async () => {
    const io = makeIo();
    const pending = prompt('Nome: ', { input: io.input, output: io.output });
    io.input.write('victor\n');

    expect(await pending).toBe('victor');
    expect(io.out()).toContain('Nome: ');
  });

  it('promptPassword retorna o valor sem ecoar os caracteres', async () => {
    const io = makeIo();
    const pending = promptPassword('Senha: ', { input: io.input, output: io.output });
    io.input.write('s3cr3t\n');

    const value = await pending;
    expect(value).toBe('s3cr3t');
    expect(io.out()).toContain('Senha: ');
    expect(io.out()).not.toContain('s3cr3t');
  });
});

describe('createPromptSession: prompts sequenciais sobre o MESMO stdin (bug #106)', () => {
  it('três respostas já bufferizadas no stream são consumidas pelos três prompts', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk: Buffer) => { rendered += chunk.toString(); });

    const session = createPromptSession({ input, output });
    // Tudo escrito de uma vez, como um pipe (e como o buffer de um TTY rápido):
    input.write('http://r.example\nadmin\ns3cr3t\n');

    const url = await session.prompt('URL do Redmine: ');
    const user = await session.prompt('Usuário: ');
    const pass = await session.promptPassword('Senha: ');
    session.close();

    expect(url).toBe('http://r.example');
    expect(user).toBe('admin');
    expect(pass).toBe('s3cr3t');
    // Os três rótulos apareceram:
    expect(rendered).toContain('URL do Redmine: ');
    expect(rendered).toContain('Usuário: ');
    expect(rendered).toContain('Senha: ');
    // A senha nunca ecoou:
    expect(rendered).not.toContain('s3cr3t');
  });

  it('respostas digitadas uma a uma (TTY lento) também funcionam', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const session = createPromptSession({ input, output });

    const p1 = session.prompt('Usuário: ');
    input.write('victor\n');
    expect(await p1).toBe('victor');

    const p2 = session.promptPassword('Senha: ');
    input.write('minhasenha\n');
    expect(await p2).toBe('minhasenha');
    session.close();
  });
});
