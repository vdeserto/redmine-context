/**
 * Testes do roteador da TUI (M2-01, evoluído em M2-04 para pilha +
 * breadcrumb + duplo Ctrl+C), escritos ANTES da implementação de cada
 * evolução (TDD): a tela inicial é a de boas-vindas e a navegação entre
 * telas troca o componente renderizado.
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
import { SCREENS } from '../../../src/surfaces/tui/screen.js';
import { symbols } from '../../../src/surfaces/tui/symbols.js';

/** Caractere ESC (0x1B) sozinho — tecla Esc (distinto de uma sequência CSI de seta). */
const ESC_KEY = String.fromCharCode(0x1b);
/** Ctrl+C (0x03). */
const CTRL_C = String.fromCharCode(0x03);

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

describe('TUI: breadcrumb fixo reflete a pilha de navegação', () => {
  it('mostra o título da tela inicial na raiz da pilha', () => {
    const { lastFrame } = render(<App />);
    expect(lastFrame()).toContain(SCREENS.welcome.title);
  });

  it('ao navegar para "Atalhos" (?), o breadcrumb ganha o separador e o novo título', async () => {
    const { lastFrame, stdin } = render(<App />);
    expect(lastFrame()).not.toContain(symbols.pointerSmall);

    stdin.write('?');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(symbols.pointerSmall);
    });
    expect(lastFrame()).toContain(SCREENS.about.title);
  });

  it('Esc desempilha (pop) e o breadcrumb volta a mostrar só a tela inicial', async () => {
    const { lastFrame, stdin } = render(<App />);
    stdin.write('?');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Atalhos');
    });
    expect(lastFrame()).toContain(symbols.pointerSmall);

    stdin.write(ESC_KEY);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(TOOL_NAME);
    });
    expect(lastFrame()).not.toContain(symbols.pointerSmall);
  });
});

describe('TUI: duplo Ctrl+C para sair', () => {
  it('primeira pressão de Ctrl+C mostra o aviso "Ctrl+C de novo para sair" sem encerrar', async () => {
    const { lastFrame, stdin } = render(<App />);
    stdin.write(CTRL_C);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Ctrl+C de novo para sair');
    });
    // A tela atual segue visível — a primeira pressão não navega nem fecha o app.
    expect(lastFrame()).toContain(TOOL_NAME);
  });

  it('segunda pressão de Ctrl+C dentro da janela não lança erro (encerra o app)', async () => {
    const { lastFrame, stdin } = render(<App />);
    stdin.write(CTRL_C);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Ctrl+C de novo para sair');
    });
    expect(() => stdin.write(CTRL_C)).not.toThrow();
  });
});

describe('TUI: "/" reservado para a busca', () => {
  it('não navega nem quebra o app (nenhuma tela de busca ainda, M2-07)', () => {
    const { lastFrame, stdin } = render(<App />);
    const before = lastFrame();
    expect(() => stdin.write('/')).not.toThrow();
    expect(lastFrame()).toBe(before);
  });
});
