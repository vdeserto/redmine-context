/**
 * Testes da paleta no App (#190) — foca no HOOK `useThemeControllerState` (a
 * lógica real de aplicar/persistir), de forma DETERMINÍSTICA (sem dirigir o App
 * inteiro por teclado, que é flaky entre SOs — ver #186). O fluxo de navegação
 * por teclado até a tela Aparência já é coberto por `screens/appearance.test.tsx`.
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import type { SettingsStore } from '../../../src/index.js';
import { App, useThemeControllerState } from '../../../src/surfaces/tui/app.js';
import { DEFAULT_PALETTE_ID, resolvePalette } from '../../../src/surfaces/tui/palettes.js';
import { DEFAULT_THEME, type ThemeController } from '../../../src/surfaces/tui/theme.js';

/** Captura o estado do hook para poder acionar preview/select fora do render. */
let captured: { theme: { primary: string }; controller: ThemeController } | undefined;
function Probe({
  initial,
  settings,
}: {
  initial?: string;
  settings?: Pick<SettingsStore, 'setPaletteId'>;
}) {
  const state = useThemeControllerState(initial, settings);
  captured = state;
  return <Text>{`id:${state.controller.paletteId}|primary:${state.theme.primary}`}</Text>;
}

describe('useThemeControllerState (#190)', () => {
  it('sem paleta inicial → tema ANSI default e paletteId default', () => {
    const { lastFrame } = render(<Probe />);
    expect(lastFrame()).toContain(`id:${DEFAULT_PALETTE_ID}`);
    expect(lastFrame()).toContain(`primary:${DEFAULT_THEME.primary}`); // 'cyan'
  });

  it('com paleta inicial → resolve o tema hex daquela paleta', () => {
    const { lastFrame } = render(<Probe initial="dracula" />);
    expect(lastFrame()).toContain('id:dracula');
    expect(lastFrame()).toContain(`primary:${resolvePalette('dracula').theme.primary}`);
  });

  it('select troca o tema E PERSISTE via settings', async () => {
    const settings = { setPaletteId: vi.fn().mockResolvedValue(undefined) };
    const { lastFrame } = render(<Probe settings={settings} />);
    await captured!.controller.select('dracula');
    expect(settings.setPaletteId).toHaveBeenCalledWith('dracula');
    await vi.waitFor(() => expect(lastFrame()).toContain('id:dracula'));
  });

  it('preview troca o tema ao vivo SEM persistir', async () => {
    const settings = { setPaletteId: vi.fn().mockResolvedValue(undefined) };
    const { lastFrame } = render(<Probe settings={settings} />);
    captured!.controller.preview('nord');
    await vi.waitFor(() => expect(lastFrame()).toContain('id:nord'));
    expect(settings.setPaletteId).not.toHaveBeenCalled();
  });

  it('select com settings ausente não quebra (persistência best-effort)', async () => {
    const { lastFrame } = render(<Probe />);
    await expect(captured!.controller.select('gruvbox-dark')).resolves.toBeUndefined();
    await vi.waitFor(() => expect(lastFrame()).toContain('id:gruvbox-dark'));
  });
});

describe('App: boot com paleta (#190)', () => {
  it('renderiza com initialPaletteId sem quebrar', () => {
    const settings = { setPaletteId: vi.fn().mockResolvedValue(undefined) };
    const { lastFrame } = render(<App initialPaletteId="dracula" settings={settings} />);
    expect(lastFrame()).toContain('redmine-context'); // tela welcome
  });
});
