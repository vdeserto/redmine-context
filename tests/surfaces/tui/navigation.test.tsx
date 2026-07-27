/**
 * Testes de navegação da TUI: a pilha de telas (M2-04, evolução do
 * roteador simples do M2-01) e o hook `useNavigation()` isolado do
 * roteador — garante que ele falha alto (erro claro) se usado fora do
 * `Provider`, evitando telas "soltas" renderizadas sem passar pelo
 * roteador.
 */
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import {
  NavigationProvider,
  useNavigation,
  useNavigationStack,
} from '../../../src/surfaces/tui/navigation.js';
import { Catch } from './catch-boundary.js';

/** Componente de teste: chama o hook sem um `NavigationProvider` acima. */
function ScreenWithoutRouter() {
  useNavigation();
  return null;
}

/**
 * Harness de teste: expõe a pilha como texto ("welcome>about") e mapeia
 * teclas para as operações da pilha, para exercitá-las sem depender do
 * roteador real (`app.tsx`).
 */
function StackHarness() {
  const value = useNavigationStack('welcome');

  useInput((input) => {
    if (input === 'a') {
      value.push('about');
    }
    if (input === 'n') {
      value.navigate('about');
    }
    if (input === 'p') {
      value.pop();
    }
    if (input === 'r') {
      value.replace('about');
    }
    if (input === 'z') {
      value.resetTo('welcome');
    }
    if (input === 'x') {
      value.popTo('welcome');
    }
    if (input === 'd') {
      value.popTo('doctor');
    }
  });

  return (
    <NavigationProvider value={value}>
      <Text>{value.stack.join('>')}</Text>
    </NavigationProvider>
  );
}

describe('TUI: useNavigation', () => {
  it('lança erro quando usado fora do NavigationProvider', () => {
    // Ink envolve a árvore num ErrorBoundary interno (componentDidCatch): o
    // erro não escapa síncrono de render(), mas é exibido no frame.
    const { lastFrame } = render(
      <Catch>
        <ScreenWithoutRouter />
      </Catch>,
    );
    expect(lastFrame()).toContain('useNavigation() usado fora de <NavigationProvider>.');
  });
});

describe('TUI: useNavigationStack (pilha push/pop/replace)', () => {
  it('inicia com apenas a tela inicial no topo da pilha', () => {
    const { lastFrame } = render(<StackHarness />);
    expect(lastFrame()).toBe('welcome');
  });

  it('push() empilha uma tela nova sem remover a anterior', async () => {
    const { lastFrame, stdin } = render(<StackHarness />);
    stdin.write('a');
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('welcome>about');
    });
  });

  it('navigate() é um alias de push() (compat com a API do M2-01)', async () => {
    const { lastFrame, stdin } = render(<StackHarness />);
    stdin.write('n');
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('welcome>about');
    });
  });

  it('pop() desempilha, voltando para a tela anterior', async () => {
    const { lastFrame, stdin } = render(<StackHarness />);
    stdin.write('a');
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('welcome>about');
    });
    stdin.write('p');
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('welcome');
    });
  });

  it('pop() na raiz da pilha (1 item) não remove a última tela', () => {
    const { lastFrame, stdin } = render(<StackHarness />);
    stdin.write('p');
    expect(lastFrame()).toBe('welcome');
  });

  it('replace() substitui o topo sem aumentar a profundidade da pilha', async () => {
    const { lastFrame, stdin } = render(<StackHarness />);
    stdin.write('r');
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('about');
    });
  });
});


describe('TUI: popTo — retomada de navegação após um fluxo empilhado (M2-13, #36)', () => {
  it('desempilha repetidamente até target virar o topo', async () => {
    const { lastFrame, stdin } = render(<StackHarness />);
    stdin.write('a'); // welcome>about
    await vi.waitFor(() => expect(lastFrame()).toBe('welcome>about'));
    stdin.write('a'); // welcome>about>about
    await vi.waitFor(() => expect(lastFrame()).toBe('welcome>about>about'));
    stdin.write('x'); // popTo('welcome')
    await vi.waitFor(() => expect(lastFrame()).toBe('welcome'));
  });

  it('cai no fallback de resetTo(target) se target não estiver na pilha (fix review #119)', async () => {
    const { lastFrame, stdin } = render(<StackHarness />);
    stdin.write('a');
    await vi.waitFor(() => expect(lastFrame()).toBe('welcome>about'));
    stdin.write('d'); // popTo('doctor') — não está na pilha
    // Antes do fix: no-op silencioso (pilha inalterada, usuário preso).
    // Depois do fix: equivalente a resetTo('doctor') — zera a pilha para o alvo.
    await vi.waitFor(() => expect(lastFrame()).toBe('doctor'));
  });

  it('target já no topo é um no-op (nada é removido)', () => {
    const { lastFrame, stdin } = render(<StackHarness />);
    stdin.write('x'); // popTo('welcome') — já é o único item
    expect(lastFrame()).toBe('welcome');
  });
});

describe('TUI: resetTo — fim de fluxo multi-tela (fix review #28)', () => {
  it('zera a pilha para uma única tela; pop na raiz não volta ao fluxo encerrado', async () => {
    const { lastFrame, stdin } = render(<StackHarness />);
    stdin.write('a');
    await vi.waitFor(() => expect(lastFrame()).toBe('welcome>about'));
    stdin.write('a');
    await vi.waitFor(() => expect(lastFrame()).toBe('welcome>about>about'));
    stdin.write('z');
    await vi.waitFor(() => expect(lastFrame()).toBe('welcome'));
    stdin.write('p');
    // pop na raiz é no-op — segue em welcome, sem "voltar" ao fluxo zerado.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lastFrame()).toBe('welcome');
  });
});
