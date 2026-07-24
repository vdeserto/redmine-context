/**
 * Testes de localização do whisper.cpp e do path canônico do modelo GGUF
 * (M4-01, #57, ADR-002). Escrito ANTES da implementação (TDD). Plataforma/PATH/
 * executabilidade injetados — sem filesystem/binário reais. Provam: {@link findWhisper}
 * detecta os três nomes (whisper-cli/whisper-cpp/main) com prioridade e reporta
 * qual; e {@link whisperModelDir} deriva `<cache>/models` (ponto único p/ a #58).
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findWhisper, whisperModelDir } from '../../src/extract/whisper.js';

describe('extract/whisper: findWhisper', () => {
  it('detecta o binário atual whisper-cli e reporta o nome', () => {
    const found = findWhisper({
      platform: 'darwin',
      pathValue: '/opt/homebrew/bin',
      isExecutable: (p) => p === '/opt/homebrew/bin/whisper-cli',
    });
    expect(found).toEqual({ path: '/opt/homebrew/bin/whisper-cli', binaryName: 'whisper-cli' });
  });

  it('detecta o pacote brew whisper-cpp quando whisper-cli ausente', () => {
    const found = findWhisper({
      platform: 'linux',
      pathValue: '/usr/bin',
      isExecutable: (p) => p === '/usr/bin/whisper-cpp',
    });
    expect(found?.binaryName).toBe('whisper-cpp');
  });

  it('detecta o legado `main` como último recurso', () => {
    const found = findWhisper({
      platform: 'linux',
      pathValue: '/usr/local/bin',
      isExecutable: (p) => p === '/usr/local/bin/main',
    });
    expect(found?.binaryName).toBe('main');
    expect(found?.path).toBe('/usr/local/bin/main');
  });

  it('prioriza whisper-cli sobre main quando ambos existem', () => {
    const present = new Set(['/usr/bin/whisper-cli', '/usr/bin/main']);
    const found = findWhisper({
      platform: 'linux',
      pathValue: '/usr/bin',
      isExecutable: (p) => present.has(p),
    });
    expect(found?.binaryName).toBe('whisper-cli');
  });

  it('retorna undefined quando nenhum binário está presente', () => {
    expect(findWhisper({ platform: 'linux', pathValue: '/usr/bin', isExecutable: () => false })).toBeUndefined();
  });
});

describe('extract/whisper: whisperModelDir', () => {
  it('deriva um caminho absoluto terminando em /models (ponto único p/ a #58)', () => {
    const dir = whisperModelDir();
    expect(dir.endsWith(join('', 'models'))).toBe(true);
    expect(dir).toContain('redmine-context');
  });
});
