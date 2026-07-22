/**
 * Teste do wire `runTui()`: mocka `ink` e `app.js` para validar apenas a
 * orquestração (renderiza o roteador, aguarda a saída) sem depender de um
 * terminal real.
 */
import { describe, expect, it, vi } from 'vitest';

// vi.mock é hoisted para o topo do arquivo — as mocks referenciadas pela
// factory precisam ser criadas via vi.hoisted() para existir nesse ponto.
const { render, waitUntilExit } = vi.hoisted(() => {
  const waitUntilExit = vi.fn().mockResolvedValue(undefined);
  const render = vi.fn().mockReturnValue({ waitUntilExit });
  return { render, waitUntilExit };
});

vi.mock('ink', () => ({ render }));
vi.mock('../../../src/surfaces/tui/app.js', () => ({ App: (): null => null }));

import { runTui } from '../../../src/surfaces/tui/index.js';

describe('TUI: runTui', () => {
  it('renderiza o roteador e resolve 0 quando o app sai', async () => {
    const code = await runTui();
    expect(render).toHaveBeenCalledTimes(1);
    expect(waitUntilExit).toHaveBeenCalledTimes(1);
    expect(code).toBe(0);
  });
});
