/**
 * Helper de teste (M2-16, #39) — NÃO é uma suíte (sem `.test.` no nome, o
 * runner não a coleta).
 *
 * `ink-testing-library` FIXA `stdout.columns` em `100` (ver
 * `node_modules/ink-testing-library/build/index.js`) e não expõe forma de
 * configurar — então nenhum teste usando o `render()` daquela lib consegue
 * simular 80/60 colunas. Este helper replica o mock de stdout dela (mesmo
 * padrão: `EventEmitter` + array de `frames`) com `columns` PARAMETRIZÁVEL, e
 * chama o `render()` REAL do Ink por baixo — igual a como a própria
 * `ink-testing-library` é implementada.
 *
 * A largura é aplicada em DOIS lugares, de propósito: o mock de `stdout`
 * (para o Yoga/Ink calcular wrap/overflow de `<Box>`/`<Text>` como um
 * terminal real faria) E o `TerminalWidthProvider`
 * (`../../../src/surfaces/tui/hooks/use-terminal-width.js`, consumido pelas
 * telas para orçar o truncamento em `../../../src/surfaces/tui/truncate.js`)
 * — sem os dois, o app renderizaria como se estivesse em 80/60 colunas mas o
 * truncamento calculado pelas telas ainda assumiria a largura de
 * `process.stdout` do processo de teste (que não representa nada aqui).
 */
import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';
import type { ReactElement } from 'react';

import { TerminalWidthProvider } from '../../../src/surfaces/tui/hooks/use-terminal-width.js';

/** Mock de stdout com `columns` mutável (permite simular resize, ver {@link RenderAtWidthResult.setColumns}). */
class WidthStdout extends EventEmitter {
  columns: number;
  frames: string[] = [];
  private _lastFrame: string | undefined;

  constructor(columns: number) {
    super();
    this.columns = columns;
  }

  write = (frame: string): void => {
    this.frames.push(frame);
    this._lastFrame = frame;
  };

  lastFrame = (): string | undefined => this._lastFrame;
}

class NoopStderr extends EventEmitter {
  write = (): void => {};
}

/** Mock de stdin — mesmo padrão de `ink-testing-library` (permite `stdin.write()` simular teclado). */
class WidthStdin extends EventEmitter {
  isTTY = true;
  data: string | null = null;
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  write = (data: string): void => {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  };
  read = (): string | null => {
    const { data } = this;
    this.data = null;
    return data;
  };
}

export interface RenderAtWidthResult {
  lastFrame: () => string | undefined;
  frames: string[];
  stdin: WidthStdin;
  unmount: () => void;
  cleanup: () => void;
  /**
   * Simula um redimensionamento em runtime: atualiza `columns` do stdout
   * mockado (dispara o `resize` interno do próprio Ink, que recalcula o
   * layout) E re-renderiza `tree` sob um `TerminalWidthProvider` com o novo
   * valor (para as telas recalcularem o truncamento). Ver o JSDoc do módulo
   * para por que os dois passos são necessários.
   */
  setColumns: (next: number) => void;
}

/** Renderiza `tree` como se o terminal tivesse `columns` colunas (mock de stdout + provider injetado). */
export function renderAtWidth(tree: ReactElement, columns: number): RenderAtWidthResult {
  const stdout = new WidthStdout(columns);
  const stderr = new NoopStderr();
  const stdin = new WidthStdin();

  const instance = inkRender(<TerminalWidthProvider width={columns}>{tree}</TerminalWidthProvider>, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return {
    lastFrame: stdout.lastFrame,
    frames: stdout.frames,
    stdin,
    unmount: instance.unmount,
    cleanup: instance.cleanup,
    setColumns: (next: number) => {
      stdout.columns = next;
      stdout.emit('resize');
      instance.rerender(<TerminalWidthProvider width={next}>{tree}</TerminalWidthProvider>);
    },
  };
}

/** Remove códigos ANSI (cor/estilo) de `text` — necessário para medir largura VISÍVEL de uma linha. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Largura visível (sem ANSI) de cada linha do frame — usado nas asserções de "sem overflow". */
export function visibleLineWidths(frame: string): number[] {
  return frame.split('\n').map((line) => stripAnsi(line).length);
}
