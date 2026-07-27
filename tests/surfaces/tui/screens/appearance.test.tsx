/**
 * Testes da tela de Aparência (#190): preview ao navegar, salvar no Enter,
 * cancelar/reverter no Esc. Usa um `ThemeController` mockado (o comportamento de
 * aplicar/persistir o tema é do `App`, testado à parte) e uma pilha de navegação
 * real para observar o `pop()`.
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumeEscapeInterceptor,
  resetEscapeInterceptor,
} from '../../../../src/surfaces/tui/hooks/use-escape-interceptor.js';
import { NavigationProvider, useNavigationStack } from '../../../../src/surfaces/tui/navigation.js';
import { PALETTES } from '../../../../src/surfaces/tui/palettes.js';
import { AppearanceScreen } from '../../../../src/surfaces/tui/screens/appearance.js';
import {
  ThemeControllerProvider,
  ThemeProvider,
  type ThemeController,
} from '../../../../src/surfaces/tui/theme.js';

const ESC = '';
const ARROW_DOWN = `${ESC}[B`;
const ENTER = '\r';

const ORIGINAL_ID = PALETTES[0]!.id;

function makeController(): ThemeController {
  return {
    paletteId: ORIGINAL_ID,
    preview: vi.fn(),
    select: vi.fn().mockResolvedValue(undefined),
  };
}

/** Monta a tela com pilha real (welcome → appearance) para observar o pop(). */
function Harness({ controller }: { controller: ThemeController }) {
  const nav = useNavigationStack('welcome');
  useEffect(() => {
    nav.push('appearance');
  }, []);
  return (
    <ThemeProvider>
      <NavigationProvider value={nav}>
        <ThemeControllerProvider value={controller}>
          <Text>screen:{nav.current}</Text>
          {nav.current === 'appearance' ? <AppearanceScreen /> : null}
        </ThemeControllerProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}

/** Reenvia uma tecla a cada poll até `done` — robusto ao timing do useInput (ver #186). */
async function pressUntil(
  stdin: { write(d: string): void },
  key: string,
  done: () => boolean,
): Promise<void> {
  await vi.waitFor(
    () => {
      if (done()) return;
      stdin.write(key);
      throw new Error('aguardando');
    },
    { timeout: 3000, interval: 40 },
  );
}

afterEach(() => {
  resetEscapeInterceptor();
});

describe('AppearanceScreen (#190)', () => {
  it('lista as paletas e marca a atual', async () => {
    const { lastFrame } = render(<Harness controller={makeController()} />);
    await vi.waitFor(() => expect(lastFrame()).toContain(PALETTES[0]!.label));
    expect(lastFrame()).toContain(PALETTES[1]!.label);
    expect(lastFrame()).toContain('atual');
  });

  it('↑/↓ pré-visualiza a paleta destacada (preview, sem persistir)', async () => {
    const controller = makeController();
    const { stdin } = render(<Harness controller={controller} />);
    await pressUntil(stdin, ARROW_DOWN, () => vi.mocked(controller.preview).mock.calls.length > 0);
    // Preview aplica a paleta seguinte, sem chamar select (não persiste).
    expect(controller.preview).toHaveBeenCalledWith(PALETTES[1]!.id);
    expect(controller.select).not.toHaveBeenCalled();
  });

  it('Enter salva (select) a paleta destacada e volta (pop)', async () => {
    const controller = makeController();
    const { stdin, lastFrame } = render(<Harness controller={controller} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('screen:appearance'));
    await pressUntil(stdin, ENTER, () => vi.mocked(controller.select).mock.calls.length > 0);
    expect(controller.select).toHaveBeenCalledWith(ORIGINAL_ID);
    await vi.waitFor(() => expect(lastFrame()).toContain('screen:welcome'));
  });

  it('Esc (via interceptor global) reverte para a paleta original', async () => {
    const controller = makeController();
    render(<Harness controller={controller} />);
    // Simula o handler global do AppShell, que consulta o interceptor no Esc.
    await vi.waitFor(() => expect(consumeEscapeInterceptor()).toBe(true));
    expect(controller.preview).toHaveBeenCalledWith(ORIGINAL_ID);
  });
});
