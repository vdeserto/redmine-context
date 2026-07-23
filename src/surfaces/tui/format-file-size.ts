/**
 * Formatação humanizada de tamanho de arquivo (#32) — usada pela seção de
 * anexos do detalhe da issue para exibir `Attachment.filesize` (bytes,
 * inteiro bruto do Redmine) em um texto curto (B/KB/MB/GB), sem depender de
 * biblioteca externa para uma conta tão simples.
 */

/** Unidades usadas na escalada progressiva (índice 0 = bytes, sem sufixo de escala). */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Formata `bytes` como texto humanizado (ex.: `999B`, `1.5KB`, `2MB`).
 *
 * Escala para a maior unidade em que o valor fica `>= 1` (mas `< 1024`),
 * arredondando para 1 casa decimal — sem casa decimal supérflua quando o
 * valor é inteiro (`1KB`, não `1.0KB`).
 *
 * @param bytes - Tamanho em bytes (`Attachment.filesize`). Valores negativos
 *   nunca deveriam ocorrer (o core normaliza para `>= 0`), mas são tratados
 *   defensivamente como `0` em vez de lançar — consistente com o resto da
 *   normalização (ADR-005: nunca crashar por payload inesperado).
 * @returns O texto humanizado.
 * @example
 * humanizeFileSize(999)  // "999B"
 * humanizeFileSize(1536) // "1.5KB"
 * humanizeFileSize(2 * 1024 * 1024) // "2MB"
 */
export function humanizeFileSize(bytes: number): string {
  const safeBytes = bytes > 0 ? bytes : 0;

  let value = safeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  let rounded = Math.round(value * 10) / 10;
  // O arredondamento pode "estourar" a unidade (1048575 bytes → 1024KB):
  // nesse caso, escala mais um degrau para exibir 1MB, não 1024KB.
  if (rounded >= 1024 && unitIndex < UNITS.length - 1) {
    rounded = Math.round((rounded / 1024) * 10) / 10;
    unitIndex += 1;
  }
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${formatted}${UNITS[unitIndex]}`;
}
