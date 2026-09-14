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
/** Sequência CSI da seta para a direita (próxima página). */
const ARROW_RIGHT = `${ESC}[C`;
/** Sequência CSI da seta para a esquerda (página anterior). */
const ARROW_LEFT = `${ESC}[D`;
/** Enter (retorno de carro). */
const ENTER = '\r';

/** Harness: repassa `onSelect`/`isActive`/`initialIndex` ao hook. */
function ListHarness({
  itemCount,
  onSelect,
  isActive,
  initialIndex,
  pageSize,
}: {
  itemCount: number;
  onSelect?: (index: number) => void;
  isActive?: boolean;
  initialIndex?: number;
  pageSize?: number;
}) {
  const { selectedIndex } = useListNavigation(itemCount, {
    onSelect,
    isActive,
    initialIndex,
    ...(pageSize !== undefined ? { pageSize } : {}),
  });
  return <Text>{selectedIndex}</Text>;
}

/** Renderiza o harness e devolve um leitor do índice corrente. */
function renderNav(
  itemCount: number,
  options: { pageSize?: number; initialIndex?: number } = {},
): { stdin: { write: (data: string) => void }; selected: () => number } {
  const { stdin, lastFrame } = render(<ListHarness itemCount={itemCount} {...options} />);
  return { stdin, selected: () => Number(lastFrame()) };
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

  it('isActive=false desliga a captura de teclado (M2-07, #30): "j" não move a seleção', () => {
    const { lastFrame, stdin } = render(<ListHarness itemCount={3} isActive={false} />);
    stdin.write('j');
    expect(lastFrame()).toBe('0');
  });

  it('isActive=false também ignora Enter (onSelect não é chamado)', () => {
    const onSelect = vi.fn();
    const { stdin } = render(<ListHarness itemCount={3} onSelect={onSelect} isActive={false} />);
    stdin.write(ENTER);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('TUI: useListNavigation — initialIndex (#31, preservação de seleção entre remounts)', () => {
  it('sem initialIndex, começa em 0 (comportamento original preservado)', () => {
    const { lastFrame } = render(<ListHarness itemCount={3} />);
    expect(lastFrame()).toBe('0');
  });

  it('com itemCount já preenchido no primeiro render, aplica initialIndex direto', () => {
    const { lastFrame } = render(<ListHarness itemCount={3} initialIndex={2} />);
    expect(lastFrame()).toBe('2');
  });

  it('clampa initialIndex fora do intervalo `[0, itemCount - 1]`', () => {
    const { lastFrame } = render(<ListHarness itemCount={3} initialIndex={99} />);
    expect(lastFrame()).toBe('2');
  });

  it('itemCount começando em 0 (lista carregando) e passando a ter itens: aplica initialIndex no primeiro preenchimento', async () => {
    const { lastFrame, rerender } = render(<ListHarness itemCount={0} initialIndex={1} />);
    expect(lastFrame()).toBe('0');

    rerender(<ListHarness itemCount={3} initialIndex={1} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('1');
    });
  });

  it('depois de aplicado, navegar normalmente segue funcionando a partir do initialIndex', async () => {
    const { lastFrame, stdin } = render(<ListHarness itemCount={3} initialIndex={1} />);
    await vi.waitFor(() => expect(lastFrame()).toBe('1'));
    stdin.write('j');
    await vi.waitFor(() => expect(lastFrame()).toBe('2'));
  });
});

describe('useListNavigation: paginação (setas horizontais)', () => {
  // Navegar item a item não escala: uma lista filtrada por status pode ter
  // centenas de entradas.
  it('seta direita avança uma página', async () => {
    const { stdin, selected } = renderNav(100, { pageSize: 10 });

    stdin.write(ARROW_RIGHT);
    await vi.waitFor(() => expect(selected()).toBe(10));

    stdin.write(ARROW_RIGHT);
    await vi.waitFor(() => expect(selected()).toBe(20));
  });

  it('seta esquerda volta uma página', async () => {
    const { stdin, selected } = renderNav(100, { pageSize: 10, initialIndex: 50 });
    await vi.waitFor(() => expect(selected()).toBe(50));

    stdin.write(ARROW_LEFT);
    await vi.waitFor(() => expect(selected()).toBe(40));
  });

  // Ao contrário de ↑/↓, a página NÃO dá a volta: saltar do topo para o fim da
  // lista desorienta.
  it('para nas bordas em vez de dar a volta', async () => {
    const { stdin, selected } = renderNav(25, { pageSize: 10 });

    stdin.write(ARROW_LEFT);
    await vi.waitFor(() => expect(selected()).toBe(0));

    for (let i = 0; i < 5; i += 1) stdin.write(ARROW_RIGHT);
    await vi.waitFor(() => expect(selected()).toBe(24));
  });

  // Failure case: pageSize inválido não pode travar a navegação nem pular zero.
  it.each([0, -3])('pageSize %i ainda avança ao menos um item', async (pageSize) => {
    const { stdin, selected } = renderNav(10, { pageSize });

    stdin.write(ARROW_RIGHT);
    await vi.waitFor(() => expect(selected()).toBe(1));
  });
});
