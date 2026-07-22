/**
 * Símbolos da TUI (M2-03).
 *
 * Fonte única de símbolos para as telas — nada de caracteres Unicode
 * hardcoded (ex.: `'✔'`, `'✖'`) espalhados pelo código das telas. Reexporta o
 * conjunto padrão de `figures`, que já detecta o suporte a Unicode do
 * terminal e degrada sozinho para ASCII quando necessário (principalmente no
 * Windows/cmd.exe — ver AC da issue M2-03).
 *
 * As telas importam daqui: `import { symbols } from '../symbols.js'`.
 */
import figures from 'figures';

/** Conjunto de símbolos disponível às telas da TUI (tick, cross, pointer, etc.). */
export const symbols = figures;
