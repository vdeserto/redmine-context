/**
 * Testes de localização e versão do `ffmpeg` (M4-01, #57, ADR-002). Escrito
 * ANTES da implementação (TDD). `execFile` é MOCKADO — nenhum ffmpeg real é
 * chamado. Provam: {@link findFfmpeg} delega ao finder injetável (PATH +
 * convencionais) e {@link detectFfmpegVersion} extrai o token da 1ª linha de
 * `ffmpeg -version`, degradando para `undefined` em erro/saída inesperada.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'node:child_process';

import { detectFfmpegVersion, findFfmpeg } from '../../src/extract/ffmpeg.js';

const mockExecFile = vi.mocked(execFile);

/** Callback do execFile na forma (error, stdout, stderr). */
type ExecCb = (error: Error | null, stdout: string, stderr: string) => void;

/** Faz o próximo execFile chamar o callback com o resultado dado. */
function stubExec(error: Error | null, stdout: string): void {
  mockExecFile.mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1] as ExecCb;
    cb(error, stdout, '');
    return { kill: vi.fn() };
  }) as unknown as typeof execFile);
}

describe('extract/ffmpeg: findFfmpeg', () => {
  it('encontra o ffmpeg via PATH injetado', () => {
    const found = findFfmpeg({
      platform: 'linux',
      pathValue: '/usr/bin',
      isExecutable: (p) => p === '/usr/bin/ffmpeg',
    });
    expect(found).toEqual({ path: '/usr/bin/ffmpeg' });
  });

  it('retorna undefined quando ausente', () => {
    expect(findFfmpeg({ platform: 'linux', pathValue: '/usr/bin', isExecutable: () => false })).toBeUndefined();
  });
});

describe('extract/ffmpeg: detectFfmpegVersion', () => {
  it('extrai o token de versão da 1ª linha "ffmpeg version X ..."', async () => {
    stubExec(null, 'ffmpeg version 6.1.1 Copyright (c) 2000-2023\nbuilt with ...');
    await expect(detectFfmpegVersion('/usr/bin/ffmpeg')).resolves.toBe('6.1.1');
  });

  it('aceita versões prefixadas de distro (ex.: n6.0)', async () => {
    stubExec(null, 'ffmpeg version n6.0 Copyright');
    await expect(detectFfmpegVersion('/usr/bin/ffmpeg')).resolves.toBe('n6.0');
  });

  it('undefined quando o binário falha', async () => {
    stubExec(new Error('spawn ENOENT'), '');
    await expect(detectFfmpegVersion('/x/ffmpeg')).resolves.toBeUndefined();
  });

  it('undefined quando a saída não casa o padrão', async () => {
    stubExec(null, 'saída totalmente inesperada');
    await expect(detectFfmpegVersion('/usr/bin/ffmpeg')).resolves.toBeUndefined();
  });
});
