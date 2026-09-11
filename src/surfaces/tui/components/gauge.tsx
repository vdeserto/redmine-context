/**
 * Barra de progresso (#190 — pacote estético).
 *
 * O `Job` do registro (`../job-registry.tsx`) já carregava `progress`, mas a
 * tela de jobs só mostrava o status textual — a extração de mídia (OCR, ffmpeg,
 * whisper) roda em background e o usuário não tinha noção de quanto falta. Este
 * componente dá essa leitura.
 *
 * Glyphs vêm de `../glyphs.js` (`gaugeFull`/`gaugeEmpty`), então a barra degrada
 * para `#`/`-` no terminal legado do Windows pelo MESMO sinal que já degrada os
 * frames braille do spinner — sem caractere Unicode solto na tela.
 *
 * Cores vêm do tema (varredura `no-hardcoded-colors`): o preenchimento usa a cor
 * recebida e o trilho usa `muted`, o que preserva contraste tanto nas paletas
 * escuras quanto nas claras.
 */
import { Text } from 'ink';

import { glyphs } from '../glyphs.js';

/** Largura default da barra, em células. */
const DEFAULT_WIDTH = 20;

/**
 * Converte a fração de progresso em número de células preenchidas.
 *
 * Exportada para teste: as bordas (0, 1 e valores fora da faixa) são o que mais
 * erra em barra de progresso.
 *
 * @param progress - Fração entre 0 e 1; valores fora da faixa são fixados nela.
 * @param width - Largura total da barra em células.
 * @returns Quantidade de células preenchidas, sempre em `[0, width]`.
 */
export function filledCells(progress: number, width: number): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  if (progress >= 1) return width;
  return Math.min(width, Math.max(0, Math.round(progress * width)));
}

/**
 * Renderiza uma barra de progresso com percentual.
 *
 * @param props.progress - Fração entre 0 e 1.
 * @param props.color - Cor do preenchimento (token do tema).
 * @param props.trackColor - Cor do trilho vazio (normalmente `theme.muted`).
 * @param props.width - Largura em células. Default: {@link DEFAULT_WIDTH}.
 * @example
 * <Gauge progress={0.4} color={theme.primary} trackColor={theme.muted} />
 */
export function Gauge({
  progress,
  color,
  trackColor,
  width = DEFAULT_WIDTH,
}: {
  progress: number;
  color: string;
  trackColor: string;
  width?: number;
}) {
  const filled = filledCells(progress, width);
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <Text>
      <Text color={color}>{glyphs.gaugeFull.repeat(filled)}</Text>
      <Text color={trackColor}>{glyphs.gaugeEmpty.repeat(width - filled)}</Text>
      <Text color={trackColor}> {String(percent).padStart(3)}%</Text>
    </Text>
  );
}
