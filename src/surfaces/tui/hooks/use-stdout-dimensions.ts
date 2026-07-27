/**
 * Hook de DIMENSÕES do terminal (#190) — largura/altura atuais do `stdout`, com
 * re-render ao redimensionar (evento `resize`). Zero-dependência (não usa a lib
 * `ink-use-stdout-dimensions`): lê `columns`/`rows` do stream e assina/desassina
 * o listener no efeito.
 *
 * Usado pelo full-screen (`app.tsx`) para preencher a altura da tela. Em ambientes
 * sem TTY (testes com `ink-testing-library`), `rows`/`columns` podem ser
 * `undefined` — o hook devolve `undefined` nessas dimensões e o chamador degrada.
 */
import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

/** Largura e altura atuais do terminal (em colunas/linhas), ou `undefined`. */
export interface StdoutDimensions {
  /** Colunas do terminal, ou `undefined` se indisponível (não-TTY). */
  columns: number | undefined;
  /** Linhas do terminal, ou `undefined` se indisponível (não-TTY). */
  rows: number | undefined;
}

/**
 * Devolve as dimensões atuais do `stdout`, atualizando ao `resize`.
 *
 * @returns `{ columns, rows }` atuais (podem ser `undefined` fora de um TTY).
 */
export function useStdoutDimensions(): StdoutDimensions {
  const { stdout } = useStdout();

  const [dimensions, setDimensions] = useState<StdoutDimensions>(() => ({
    columns: stdout?.columns,
    rows: stdout?.rows,
  }));

  useEffect(() => {
    if (stdout === undefined) return undefined;
    const onResize = (): void => {
      setDimensions({ columns: stdout.columns, rows: stdout.rows });
    };
    stdout.on('resize', onResize);
    // Sincroniza uma vez na montagem (o terminal pode ter mudado antes do efeito).
    onResize();
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return dimensions;
}
