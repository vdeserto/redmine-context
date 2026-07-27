/**
 * Integração da paleta no App (#190): navegar até Aparência e salvar PERSISTE a
 * paleta via o SettingsStore injetado (o controlador de tema é montado pelo App).
 */
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SettingsStore } from '../../../src/index.js';
import { App } from '../../../src/surfaces/tui/app.js';
import { resetEscapeInterceptor } from '../../../src/surfaces/tui/hooks/use-escape-interceptor.js';
import { DEFAULT_PALETTE_ID } from '../../../src/surfaces/tui/palettes.js';

const ENTER = '\r';

function settingsMock(): Pick<SettingsStore, 'setPaletteId'> & { setPaletteId: ReturnType<typeof vi.fn> } {
  return { setPaletteId: vi.fn().mockResolvedValue(undefined) };
}

/** Reenvia uma tecla até `done` (robusto ao timing do useInput). */
async function pressUntil(stdin: { write(d: string): void }, key: string, done: () => boolean): Promise<void> {
  await vi.waitFor(
    () => {
      if (done()) return;
      stdin.write(key);
      throw new Error('aguardando');
    },
    { timeout: 4000, interval: 40 },
  );
}

afterEach(() => resetEscapeInterceptor());

describe('App: paleta (#190)', () => {
  it('renderiza com initialPaletteId sem quebrar (boot com paleta)', () => {
    const { lastFrame } = render(<App initialPaletteId="dracula" settings={settingsMock()} />);
    expect(lastFrame()).toContain('redmine-context'); // tela welcome
  });

  it("tecla 'a' abre Aparência e Enter PERSISTE a paleta via settings", async () => {
    const settings = settingsMock();
    const { stdin, lastFrame } = render(<App settings={settings} />);

    // welcome → aparência
    await pressUntil(stdin, 'a', () => (lastFrame() ?? '').includes('paleta de cores'));
    // Enter salva a paleta destacada (a atual, default) → persiste.
    await pressUntil(stdin, ENTER, () => settings.setPaletteId.mock.calls.length > 0);

    expect(settings.setPaletteId).toHaveBeenCalledWith(DEFAULT_PALETTE_ID);
  });
});
