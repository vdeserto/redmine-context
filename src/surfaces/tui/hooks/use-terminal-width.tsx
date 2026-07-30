/**
 * Hook de largura do terminal (M2-16, #39): lê `process.stdout.columns` com
 * fallback, escuta o evento `resize` do stdout REAL para atualizar em
 * runtime (redimensionamento da janela do terminal), e é injetável via
 * {@link TerminalWidthProvider} para testes.
 *
 * A injeção via contexto existe porque `ink-testing-library` FIXA
 * `stdout.columns` em `100` (não expõe opção de configurar — ver
 * `node_modules/ink-testing-library/build/index.js`), então nenhum teste
 * usando o `render()` daquela lib consegue simular 80/60 colunas só ajustando
 * `process.stdout.columns`. Testes de layout responsivo usam
 * `tests/surfaces/tui/render-at-width.tsx`, que injeta a largura por este
 * provider (e mocka o `stdout` passado ao Ink real com o mesmo valor, para
 * que o PRÓPRIO wrap do Ink também reflita a largura simulada).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** Largura assumida quando `process.stdout.columns` está indisponível (ex.: saída não-TTY). */
export const DEFAULT_TERMINAL_WIDTH = 80;
/** Altura assumida quando `process.stdout.rows` está indisponível. */
export const DEFAULT_TERMINAL_HEIGHT = 24;

const TerminalWidthContext = createContext<number | undefined>(undefined);
/** Altura atual (linhas), provida pelo {@link TerminalSizeProvider}; `undefined` fora dele. */
const TerminalHeightContext = createContext<number | undefined>(undefined);

/** Lê a largura atual do stdout do processo, com fallback para {@link DEFAULT_TERMINAL_WIDTH}. */
function readProcessColumns(): number {
  const columns = process.stdout.columns;
  return typeof columns === 'number' && columns > 0 ? columns : DEFAULT_TERMINAL_WIDTH;
}

/** Lê a altura atual do stdout do processo, com fallback para {@link DEFAULT_TERMINAL_HEIGHT}. */
function readProcessRows(): number {
  const rows = process.stdout.rows;
  return typeof rows === 'number' && rows > 0 ? rows : DEFAULT_TERMINAL_HEIGHT;
}

/**
 * Provider de largura FIXA — usado pelos testes (injeta 80/60 sem depender do
 * `process.stdout` real). Fora de testes, a árvore da TUI (`../app.tsx`) usa o
 * {@link TerminalSizeProvider} (uma única assinatura de `resize`).
 */
export function TerminalWidthProvider({ width, children }: { width: number; children: ReactNode }) {
  return <TerminalWidthContext.Provider value={width}>{children}</TerminalWidthContext.Provider>;
}

/**
 * Provider de TAMANHO do terminal (largura + altura) com UMA ÚNICA assinatura do
 * evento `resize` do stdout (#190 fix). Montado no topo da TUI (`../app.tsx`) para
 * que `useTerminalWidth`/`useTerminalHeight` leiam do contexto em vez de cada
 * consumidor (ex.: cada linha da lista) assinar o próprio `resize` — o que
 * estourava o limite de 10 listeners do EventEmitter (MaxListenersExceededWarning).
 */
export function TerminalSizeProvider({ children }: { children: ReactNode }) {
  const [size, setSize] = useState(() => ({ width: readProcessColumns(), height: readProcessRows() }));
  useEffect(() => {
    const onResize = (): void => setSize({ width: readProcessColumns(), height: readProcessRows() });
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);
  return (
    <TerminalWidthContext.Provider value={size.width}>
      <TerminalHeightContext.Provider value={size.height}>{children}</TerminalHeightContext.Provider>
    </TerminalWidthContext.Provider>
  );
}

/**
 * Largura atual do terminal, em colunas.
 *
 * Usa o provider mais próximo se houver ({@link TerminalSizeProvider} em produção
 * ou {@link TerminalWidthProvider} nos testes); senão (sem provider) lê o stdout
 * real e assina o `resize` — caminho de fallback para uso isolado.
 */
export function useTerminalWidth(): number {
  const injected = useContext(TerminalWidthContext);
  const [width, setWidth] = useState(readProcessColumns);

  useEffect(() => {
    // Com um provider (produção via TerminalSizeProvider, ou testes), a largura é
    // a fonte da verdade — não assina o stdout real por consumidor.
    if (injected !== undefined) return;
    const handleResize = () => setWidth(readProcessColumns());
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, [injected]);

  return injected ?? width;
}

/**
 * Altura atual do terminal, em linhas. Lê do {@link TerminalSizeProvider}; sem ele
 * (uso isolado/testes) cai no fallback {@link DEFAULT_TERMINAL_HEIGHT}.
 */
export function useTerminalHeight(): number {
  return useContext(TerminalHeightContext) ?? DEFAULT_TERMINAL_HEIGHT;
}
