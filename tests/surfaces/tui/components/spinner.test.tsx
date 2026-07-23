/**
 * Testes do `Spinner` (#28) — frames braille avançando por `setInterval`,
 * sem depender de nenhuma lib nova. Escrito ANTES da implementação (TDD).
 *
 * Timers REAIS + `vi.waitFor` (em vez de fake timers): o próprio Ink faz seu
 * repaint de stdout via agendamento interno assíncrono, que não avança em
 * lockstep com `vi.advanceTimersByTime` — mesma escolha de
 * `hooks/use-exit-guard.test.tsx` (M2-04) para o mesmo tipo de timer.
 */
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { Spinner, SPINNER_FRAMES, SPINNER_INTERVAL_MS } from '../../../../src/surfaces/tui/components/spinner.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

describe('TUI: Spinner', () => {
  it('renderiza o primeiro frame imediatamente', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Spinner />
      </ThemeProvider>,
    );
    expect(lastFrame()).toBe(SPINNER_FRAMES[0]);
  });

  it('avança de frame com o tempo (frame muda em relação ao inicial)', async () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Spinner />
      </ThemeProvider>,
    );
    const first = lastFrame();
    await vi.waitFor(
      () => {
        expect(lastFrame()).not.toBe(first);
      },
      { timeout: SPINNER_INTERVAL_MS * 10 },
    );
    expect(SPINNER_FRAMES).toContain(lastFrame());
  });

  it('dá a volta completa e eventualmente recomeça do primeiro frame', async () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Spinner />
      </ThemeProvider>,
    );
    // Espera sair do frame inicial antes de esperar o ciclo completar — do
    // contrário o waitFor passaria de imediato (o frame já começa em índice 0).
    await vi.waitFor(
      () => {
        expect(lastFrame()).not.toBe(SPINNER_FRAMES[0]);
      },
      { timeout: SPINNER_INTERVAL_MS * 10 },
    );
    await vi.waitFor(
      () => {
        expect(lastFrame()).toBe(SPINNER_FRAMES[0]);
      },
      { timeout: SPINNER_INTERVAL_MS * (SPINNER_FRAMES.length + 5) },
    );
  });
});
