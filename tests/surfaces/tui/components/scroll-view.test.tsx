/**
 * Testes do `ScrollView` (#31) — viewport rolável genérico: janela de
 * `height` linhas sobre um array `lines` maior, navegável por `j`/`k`/setas
 * (1 linha) e PgUp/PgDn (`height` linhas), com um indicador de posição
 * discreto. Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { ScrollView } from '../../../../src/surfaces/tui/components/scroll-view.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Caractere ESC (0x1B) — prefixo das sequências CSI abaixo. */
const ESC = String.fromCharCode(0x1b);
const ARROW_UP = `${ESC}[A`;
const ARROW_DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

/** Gera `count` linhas de texto simples numeradas, já com `key` estável. */
function makeLines(count: number) {
  return Array.from({ length: count }, (_unused, index) => `linha-${index}`);
}

function renderScrollView(lines: string[], height: number) {
  return render(
    <ThemeProvider>
      <ScrollView lines={lines.map((text) => <Text key={text}>{text}</Text>)} height={height} />
    </ThemeProvider>,
  );
}

describe('TUI: ScrollView — janela inicial', () => {
  it('mostra só as primeiras `height` linhas quando o conteúdo é maior', () => {
    const { lastFrame } = renderScrollView(makeLines(10), 3);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('linha-0');
    expect(frame).toContain('linha-1');
    expect(frame).toContain('linha-2');
    expect(frame).not.toContain('linha-3');
  });

  it('mostra todas as linhas e NÃO desenha indicador quando o conteúdo cabe na janela', () => {
    const { lastFrame } = renderScrollView(makeLines(2), 5);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('linha-0');
    expect(frame).toContain('linha-1');
    expect(frame).not.toContain('/2');
  });

  it('desenha um indicador de posição discreto quando o conteúdo rola', () => {
    const { lastFrame } = renderScrollView(makeLines(10), 3);
    expect(lastFrame()).toContain('/10');
  });
});

describe('TUI: ScrollView — rolagem linha a linha (j/k, setas)', () => {
  it('"j"/seta para baixo avança a janela em 1 linha', async () => {
    const { lastFrame, stdin } = renderScrollView(makeLines(10), 3);
    stdin.write(ARROW_DOWN);
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('linha-1');
      expect(frame).toContain('linha-3');
      expect(frame).not.toContain('linha-0');
    });
  });

  it('"k"/seta para cima retrocede a janela em 1 linha', async () => {
    const { lastFrame, stdin } = renderScrollView(makeLines(10), 3);
    stdin.write(ARROW_DOWN);
    stdin.write(ARROW_DOWN);
    await vi.waitFor(() => expect(lastFrame() ?? '').toContain('linha-2'));
    stdin.write(ARROW_UP);
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('linha-1');
      expect(frame).not.toContain('linha-4');
    });
  });
});

describe('TUI: ScrollView — paginação (PgUp/PgDn)', () => {
  it('PgDn avança a janela em `height` linhas de uma vez', async () => {
    const { lastFrame, stdin } = renderScrollView(makeLines(10), 3);
    stdin.write(PAGE_DOWN);
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('linha-3');
      expect(frame).toContain('linha-5');
      expect(frame).not.toContain('linha-0');
    });
  });

  it('PgUp retrocede a janela em `height` linhas de uma vez', async () => {
    const { lastFrame, stdin } = renderScrollView(makeLines(10), 3);
    stdin.write(PAGE_DOWN);
    stdin.write(PAGE_DOWN);
    await vi.waitFor(() => expect(lastFrame() ?? '').toContain('linha-6'));
    stdin.write(PAGE_UP);
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('linha-3');
      expect(frame).not.toContain('linha-9');
    });
  });
});

describe('TUI: ScrollView — limites (topo/fundo)', () => {
  it('não rola além do topo (k/seta para cima repetida no início não quebra nem passa de 0)', async () => {
    const { lastFrame, stdin } = renderScrollView(makeLines(10), 3);
    const before = lastFrame();
    stdin.write(ARROW_UP);
    stdin.write(ARROW_UP);
    stdin.write(PAGE_UP);
    await new Promise((resolve) => setImmediate(resolve));
    expect(lastFrame()).toBe(before);
  });

  it('não rola além do fundo (PgDn repetido no fim não quebra nem estoura o array)', async () => {
    const { lastFrame, stdin } = renderScrollView(makeLines(10), 3);
    stdin.write(PAGE_DOWN);
    stdin.write(PAGE_DOWN);
    stdin.write(PAGE_DOWN);
    stdin.write(PAGE_DOWN);
    stdin.write(PAGE_DOWN);
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('linha-9');
    });
    const atBottom = lastFrame();
    expect(() => stdin.write(PAGE_DOWN)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(lastFrame()).toBe(atBottom);
    expect(lastFrame() ?? '').toContain('8-10/10');
  });
});

describe('TUI: ScrollView — isActive', () => {
  it('com isActive=false, não captura teclado (janela não muda)', () => {
    const { lastFrame, stdin } = render(
      <ThemeProvider>
        <ScrollView
          lines={makeLines(10).map((text) => <Text key={text}>{text}</Text>)}
          height={3}
          isActive={false}
        />
      </ThemeProvider>,
    );
    const before = lastFrame();
    stdin.write(ARROW_DOWN);
    expect(lastFrame()).toBe(before);
  });
});
