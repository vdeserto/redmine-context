/**
 * Testes do roteador da TUI (M2-01), escritos ANTES da implementação (TDD):
 * a tela inicial é a de boas-vindas e a navegação entre telas troca o
 * componente renderizado.
 *
 * Ink liga o listener de input (`useInput`) num `useEffect` — passive effects
 * são flushed de forma assíncrona (fora do tick síncrono de `render()`), e o
 * próprio repaint do stdout também é batched. Por isso as asserções após
 * `stdin.write()` usam `vi.waitFor`: fazem polling do frame em vez de
 * assumir atualização síncrona (evita acoplar o teste ao número exato de
 * ticks internos do Ink).
 */
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { TOOL_NAME, TOOL_VERSION } from '../../../src/index.js';
import { App } from '../../../src/surfaces/tui/app.js';

describe('TUI: roteador de telas', () => {
  it('renderiza a tela inicial (boas-vindas) com nome e versão do produto', () => {
    const { lastFrame } = render(<App />);
    const frame = lastFrame();
    expect(frame).toContain(TOOL_NAME);
    expect(frame).toContain(TOOL_VERSION);
    expect(frame).toContain('?');
  });

  it('navega para a tela de atalhos ao pressionar "?" e troca o componente', async () => {
    const { lastFrame, stdin } = render(<App />);
    stdin.write('?');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Atalhos');
    });
    expect(lastFrame()).not.toContain(TOOL_NAME);
  });

  it('volta para a tela de boas-vindas ao pressionar "b" na tela de atalhos', async () => {
    const { lastFrame, stdin } = render(<App />);
    stdin.write('?');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Atalhos');
    });
    stdin.write('b');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(TOOL_NAME);
    });
  });

  it('atalho global "q" encerra a TUI em qualquer tela', () => {
    const { stdin } = render(<App />);
    expect(() => stdin.write('q')).not.toThrow();
  });
});
