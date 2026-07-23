/**
 * Testes do hook de largura do terminal (M2-16, #39): valor default lido de
 * `process.stdout.columns`, fallback quando ausente, injeção via
 * `TerminalWidthProvider` (mecanismo usado pelos testes de layout
 * responsivo, ver `../render-at-width.tsx`) e atualização em runtime via o
 * evento `resize` do stdout real quando NENHUM provider está presente.
 * Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TERMINAL_WIDTH,
  TerminalWidthProvider,
  useTerminalWidth,
} from '../../../../src/surfaces/tui/hooks/use-terminal-width.js';

/** Componente-sonda: só expõe a largura atual como texto, para asserção direta. */
function WidthProbe() {
  const width = useTerminalWidth();
  return <Text>{`width:${width}`}</Text>;
}

// Reason: `process.stdout.columns` não é um getter/valor definido no processo
// de teste (não-TTY) — `vi.spyOn(..., 'get')` exige que a propriedade já
// exista como accessor, o que falha aqui (`columns does not exist`).
// `Object.defineProperty` cobre os dois casos (propriedade ausente ou
// presente) e o descriptor original é restaurado no `afterEach`.
const originalColumnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');

function stubColumns(value: number | undefined): void {
  Object.defineProperty(process.stdout, 'columns', { value, configurable: true });
}

afterEach(() => {
  // Reason: sem desmontar, o listener de `resize` assinado por
  // `useTerminalWidth()` (quando não há provider) sobrevive entre os `it()`
  // deste arquivo e acumula no `process.stdout` real (`EventEmitter`
  // compartilhado por toda a suíte) — `MaxListenersExceededWarning` a partir
  // do 11º. Mesmo padrão de `home.test.tsx`/`app.test.tsx`.
  cleanup();
  if (originalColumnsDescriptor !== undefined) {
    Object.defineProperty(process.stdout, 'columns', originalColumnsDescriptor);
  } else {
    Reflect.deleteProperty(process.stdout, 'columns');
  }
});

describe('useTerminalWidth', () => {
  it('sem provider: lê `process.stdout.columns` real', () => {
    stubColumns(132);
    const { lastFrame } = render(<WidthProbe />);
    expect(lastFrame()).toContain('width:132');
  });

  it('sem provider e sem `process.stdout.columns` (ex.: saída não-TTY): cai no fallback', () => {
    stubColumns(undefined);
    const { lastFrame } = render(<WidthProbe />);
    expect(lastFrame()).toContain(`width:${DEFAULT_TERMINAL_WIDTH}`);
  });

  it('com `TerminalWidthProvider`: usa o valor injetado, ignorando o stdout real', () => {
    stubColumns(200);
    const { lastFrame } = render(
      <TerminalWidthProvider width={60}>
        <WidthProbe />
      </TerminalWidthProvider>,
    );
    expect(lastFrame()).toContain('width:60');
  });

  it('runtime: um `resize` do stdout real atualiza a largura (sem provider), sem crash', async () => {
    stubColumns(80);
    const { lastFrame } = render(<WidthProbe />);
    expect(lastFrame()).toContain('width:80');

    stubColumns(60);
    expect(() => process.stdout.emit('resize')).not.toThrow();

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('width:60');
    });
  });

  it('com provider: um `resize` do stdout real NÃO altera a largura injetada', async () => {
    stubColumns(200);
    const { lastFrame } = render(
      <TerminalWidthProvider width={60}>
        <WidthProbe />
      </TerminalWidthProvider>,
    );
    expect(lastFrame()).toContain('width:60');

    process.stdout.emit('resize');
    await new Promise((resolve) => setImmediate(resolve));
    expect(lastFrame()).toContain('width:60');
  });
});
