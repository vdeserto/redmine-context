/**
 * Testes da resolução de instância da TUI no boot (#187) — `resolveTuiInstance`.
 * REDMINE_URL vence; sem ela, usa a persistida e popula `env.REDMINE_URL` para os
 * hooks de dados; a origem é reportada para as telas config/doctor.
 */

import { describe, expect, it, vi } from 'vitest';

import type { SettingsStore } from '../../../src/index.js';
import { resolveTuiInstance } from '../../../src/surfaces/tui/index.js';

/** SettingsStore fake com a URL persistida controlável. */
function fakeSettings(persisted: string | undefined): SettingsStore & {
  clearInstanceUrl: ReturnType<typeof vi.fn>;
} {
  return {
    getInstanceUrl: vi.fn().mockResolvedValue(persisted),
    setInstanceUrl: vi.fn().mockResolvedValue(undefined),
    clearInstanceUrl: vi.fn().mockResolvedValue(undefined),
  };
}

describe('resolveTuiInstance (#187)', () => {
  it('REDMINE_URL presente → origin env, não consulta a persistida', async () => {
    const env = { REDMINE_URL: 'https://env.example' } as NodeJS.ProcessEnv;
    const settings = fakeSettings('https://persisted.example');

    const info = await resolveTuiInstance(env, settings);

    expect(info).toMatchObject({ url: 'https://env.example', origin: 'env' });
    expect(settings.getInstanceUrl).not.toHaveBeenCalled();
    expect(env.REDMINE_URL).toBe('https://env.example');
  });

  it('sem REDMINE_URL mas com persistida → origin config e POPULA env', async () => {
    const env = {} as NodeJS.ProcessEnv;
    const settings = fakeSettings('https://persisted.example');

    const info = await resolveTuiInstance(env, settings);

    expect(info).toMatchObject({ url: 'https://persisted.example', origin: 'config' });
    // Populou o ambiente para os hooks de dados lerem sem mudança.
    expect(env.REDMINE_URL).toBe('https://persisted.example');
  });

  it('sem nenhuma fonte → origin none, sem url, env intacto', async () => {
    const env = {} as NodeJS.ProcessEnv;
    const settings = fakeSettings(undefined);

    const info = await resolveTuiInstance(env, settings);

    expect(info.origin).toBe('none');
    expect(info.url).toBeUndefined();
    expect(env.REDMINE_URL).toBeUndefined();
  });

  it('clearPersisted (origem config) limpa o store E o env.REDMINE_URL do boot (#187)', async () => {
    const env = {} as NodeJS.ProcessEnv;
    const settings = fakeSettings('https://persisted.example');

    const info = await resolveTuiInstance(env, settings);
    expect(env.REDMINE_URL).toBe('https://persisted.example'); // populado no boot

    await info.clearPersisted();

    expect(settings.clearInstanceUrl).toHaveBeenCalledTimes(1);
    // Sem isto, os hooks continuariam vendo a instância "logada" após o logout.
    expect(env.REDMINE_URL).toBeUndefined();
  });

  it('clearPersisted (origem env) NÃO apaga a REDMINE_URL real do ambiente', async () => {
    const env = { REDMINE_URL: 'https://env.example' } as NodeJS.ProcessEnv;
    const settings = fakeSettings('https://persisted.example');

    const info = await resolveTuiInstance(env, settings);
    await info.clearPersisted();

    expect(settings.clearInstanceUrl).toHaveBeenCalledTimes(1);
    expect(env.REDMINE_URL).toBe('https://env.example');
  });

  it('falha ao ler a persistida degrada para none (não lança)', async () => {
    const env = {} as NodeJS.ProcessEnv;
    const settings: SettingsStore = {
      getInstanceUrl: vi.fn().mockRejectedValue(new Error('disco morreu')),
      setInstanceUrl: vi.fn(),
      clearInstanceUrl: vi.fn(),
    };

    const info = await resolveTuiInstance(env, settings);

    expect(info.origin).toBe('none');
    expect(env.REDMINE_URL).toBeUndefined();
  });
});
