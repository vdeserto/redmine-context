/**
 * Testes do hook `useListNavigation` (M2-04) — padrão reutilizável de
 * seleção em listas: setas/`j`/`k` movem o índice selecionado com wrap nas
 * pontas, Enter confirma via `onSelect`. Escrito ANTES da implementação
 * (TDD).
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { useListNavigation } from '../../../../src/surfaces/tui/hooks/use-list-navigation.js';

/** Caractere ESC (0x1B) — prefixo das sequências CSI de seta abaixo. */
const ESC = String.fromCharCode(0x1b);
/** Sequência CSI da seta para cima (mesma decodificada por `parse-keypress` do Ink). */
const ARROW_UP = `${ESC}[A`;
/** Sequência CSI da seta para baixo. */
const ARROW_DOWN = `${ESC}[B`;
/** Enter (retorno de carro). */
const ENTER = '\r';

/** Harness: renderiza o índice selecionado e repassa `onSelect` ao hook. */
function ListHarness({
  itemCount,
  onSelect,
}: {
  itemCount: number;
  onSelect?: (index: number) => void;
}) {
  const { selectedIndex } = useListNavigation(itemCount, { onSelect });
  return <Text>{selectedIndex}</Text>;
}

describe('TUI: useListNavigation', () => {
  it('começa com o índice 0 selecionado', () => {
    const { lastFrame } = render(<ListHarness itemCount={3} />);
    expect(lastFrame()).toBe('0');
  });

  it('seta para baixo avança a seleção', async () => {
    const { lastFrame, stdin } = render(<ListHarness itemCount={3} />);
    stdin.write(ARROW_DOWN);
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('1');
    });
  });

  it('"j" tem o mesmo efeito da seta para baixo', async () => {
    const { lastFrame, stdin } = render(<ListHarness itemCount={3} />);
    stdin.write('j');
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('1');
    });
  });

  it('seta para cima retrocede a seleção', async () => {
    const { lastFrame, stdin } = render(<ListHarness itemCount={3} />);
    stdin.write('j');
    await vi.waitFor(() => expect(lastFrame()).toBe('1'));
    stdin.write(ARROW_UP);
    await vi.waitFor(() => expect(lastFrame()).toBe('0'));
  });

  it('"k" tem o mesmo efeito da seta para cima', async () => {
    const { lastFrame, stdin } = render(<ListHarness itemCount={3} />);
    stdin.write('j');
    await vi.waitFor(() => expect(lastFrame()).toBe('1'));
    stdin.write('k');
    await vi.waitFor(() => expect(lastFrame()).toBe('0'));
  });

  it('avançar a partir do último item dá a volta (wrap) para o primeiro', async () => {
    const { lastFrame, stdin } = render(<ListHarness itemCount={3} />);
    stdin.write('j');
    await vi.waitFor(() => expect(lastFrame()).toBe('1'));
    stdin.write('j');
    await vi.waitFor(() => expect(lastFrame()).toBe('2'));
    stdin.write('j');
    await vi.waitFor(() => expect(lastFrame()).toBe('0'));
  });

  it('retroceder a partir do primeiro item dá a volta (wrap) para o último', async () => {
    const { lastFrame, stdin } = render(<ListHarness itemCount={3} />);
    stdin.write('k');
    await vi.waitFor(() => expect(lastFrame()).toBe('2'));
  });

  it('Enter confirma a seleção chamando onSelect com o índice atual', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(<ListHarness itemCount={3} onSelect={onSelect} />);
    stdin.write('j');
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('1');
    });
    // Reason: o frame já mostra o índice atualizado, mas o `useInput()` do
    // Ink resubscreve seu listener (para capturar o `selectedIndex` mais
    // recente) num efeito passivo separado do commit que atualiza o frame —
    // um tick extra garante que essa resubscrição já rodou antes do Enter.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(1);
    });
  });

  it('lista vazia (itemCount 0) não navega nem quebra', () => {
    const { lastFrame, stdin } = render(<ListHarness itemCount={0} />);
    expect(() => stdin.write('j')).not.toThrow();
    expect(lastFrame()).toBe('0');
  });
});
