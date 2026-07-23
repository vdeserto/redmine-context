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

const TerminalWidthContext = createContext<number | undefined>(undefined);

/** Lê a largura atual do stdout do processo, com fallback para {@link DEFAULT_TERMINAL_WIDTH}. */
function readProcessColumns(): number {
  const columns = process.stdout.columns;
  return typeof columns === 'number' && columns > 0 ? columns : DEFAULT_TERMINAL_WIDTH;
}

/**
 * Provider de largura FIXA — usado pelos testes (injeta 80/60 sem depender do
 * `process.stdout` real). Fora de testes, a árvore da TUI (`../app.tsx`) NÃO
 * usa este provider: `useTerminalWidth()` lê o stdout real diretamente
 * quando nenhum provider está presente.
 */
export function TerminalWidthProvider({ width, children }: { width: number; children: ReactNode }) {
  return <TerminalWidthContext.Provider value={width}>{children}</TerminalWidthContext.Provider>;
}

/**
 * Largura atual do terminal, em colunas.
 *
 * Usa o {@link TerminalWidthProvider} mais próximo se houver (testes); senão
 * lê `process.stdout.columns` e assina o evento `resize` do stdout real para
 * atualizar em runtime — telas que dependem desta largura para orçar
 * truncamento (ver `../truncate.ts`) re-renderizam automaticamente quando o
 * usuário redimensiona o terminal.
 */
export function useTerminalWidth(): number {
  const injected = useContext(TerminalWidthContext);
  const [width, setWidth] = useState(readProcessColumns);

  useEffect(() => {
    // Reason: com um provider injetado (testes), a largura é a fonte da
    // verdade — não assina o stdout real, que nos testes não representa o
    // terminal simulado.
    if (injected !== undefined) return;
    const handleResize = () => setWidth(readProcessColumns());
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, [injected]);

  return injected ?? width;
}
