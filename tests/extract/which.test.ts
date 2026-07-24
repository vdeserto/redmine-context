/**
 * Testes de {@link findExecutable} (M4-01, #57, ADR-002). Escrito ANTES da
 * implementação (TDD). A plataforma, o `PATH` e o predicado de executabilidade
 * são injetados — nenhum acesso ao filesystem real. Provam: prioridade por nome,
 * PATH antes dos convencionais, sufixo `.exe` no Windows, escolha dos dirs
 * convencionais por SO, e a ausência (undefined).
 */
import { describe, expect, it, vi } from 'vitest';

import { findExecutable, isExecutable, type ConventionalDirs } from '../../src/extract/which.js';

const DIRS: ConventionalDirs = {
  unix: ['/opt/homebrew/bin', '/usr/local/bin'],
  windows: ['C:\\tools\\bin'],
};

describe('extract/which: findExecutable', () => {
  it('encontra no PATH (unix) e retorna path + binaryName que casou', () => {
    const isExec = vi.fn((p: string) => p === '/usr/bin/ffmpeg');
    const found = findExecutable(['ffmpeg'], DIRS, {
      platform: 'linux',
      pathValue: '/usr/bin:/sbin',
      isExecutable: isExec,
    });
    expect(found).toEqual({ path: '/usr/bin/ffmpeg', binaryName: 'ffmpeg' });
  });

  it('prioridade por NOME: prefere whisper-cli a main mesmo com main também presente', () => {
    const present = new Set(['/opt/homebrew/bin/whisper-cli', '/usr/bin/main']);
    const found = findExecutable(['whisper-cli', 'main'], DIRS, {
      platform: 'darwin',
      pathValue: '/usr/bin',
      isExecutable: (p) => present.has(p),
    });
    expect(found?.binaryName).toBe('whisper-cli');
    expect(found?.path).toBe('/opt/homebrew/bin/whisper-cli');
  });

  it('PATH vem antes dos locais convencionais dentro do mesmo nome', () => {
    const present = new Set(['/usr/bin/main', '/opt/homebrew/bin/main']);
    const found = findExecutable(['main'], DIRS, {
      platform: 'darwin',
      pathValue: '/usr/bin',
      isExecutable: (p) => present.has(p),
    });
    expect(found?.path).toBe('/usr/bin/main');
  });

  it('cai nos locais convencionais quando não está no PATH', () => {
    const found = findExecutable(['ffmpeg'], DIRS, {
      platform: 'darwin',
      pathValue: '/nada',
      isExecutable: (p) => p === '/usr/local/bin/ffmpeg',
    });
    expect(found?.path).toBe('/usr/local/bin/ffmpeg');
  });

  it('Windows: aplica sufixo .exe e usa os dirs convencionais do Windows', () => {
    const found = findExecutable(['ffmpeg'], DIRS, {
      platform: 'win32',
      pathValue: '',
      isExecutable: (p) => p === 'C:\\tools\\bin\\ffmpeg.exe',
    });
    expect(found?.path).toBe('C:\\tools\\bin\\ffmpeg.exe');
    expect(found?.binaryName).toBe('ffmpeg');
  });

  it('retorna undefined quando nenhum candidato é executável', () => {
    const found = findExecutable(['ffmpeg', 'main'], DIRS, {
      platform: 'linux',
      pathValue: '/usr/bin',
      isExecutable: () => false,
    });
    expect(found).toBeUndefined();
  });

  it('PATH vazio/indefinido não quebra (só consulta convencionais)', () => {
    const found = findExecutable(['ffmpeg'], DIRS, {
      platform: 'linux',
      pathValue: undefined,
      isExecutable: (p) => p === '/opt/homebrew/bin/ffmpeg',
    });
    expect(found?.path).toBe('/opt/homebrew/bin/ffmpeg');
  });
});

describe('extract/which: isExecutable', () => {
  it('retorna false para um caminho inexistente (não lança)', () => {
    expect(isExecutable('/definitivamente/nao/existe/xyz-123')).toBe(false);
  });
});
