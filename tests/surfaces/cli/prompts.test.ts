import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { prompt, promptPassword } from '../../../src/surfaces/cli/prompts.js';

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
