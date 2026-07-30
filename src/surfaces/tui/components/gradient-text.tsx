/**
 * Texto com GRADIENTE de cores (#190) — zero-dependência (não usa `ink-gradient`).
 *
 * Recebe um texto e uma ramp de cores (hex) e pinta cada caractere interpolando
 * linearmente entre as paradas da ramp. Usado em títulos/destaques para dar o
 * "muitas cores maneiras" sem depender de biblioteca nova. As cores vêm do tema
 * (`theme.gradient`), então nenhuma cor literal aparece nas telas (varredura
 * anti-hardcode) — este componente recebe a ramp como prop (variável).
 *
 * Degrada com elegância: ramp vazia ⇒ texto sem cor; 1 cor ⇒ texto sólido.
 */
import { Text } from 'ink';

/** Converte `#rgb`/`#rrggbb` em `[r,g,b]` (0-255); `undefined` se inválido. */
function hexToRgb(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (m === null) return undefined;
  let h = m[1] as string;
  if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); // #abc → #aabbcc
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Converte `[r,g,b]` em `#rrggbb`. */
function rgbToHex([r, g, b]: [number, number, number]): string {
  const to2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/**
 * Gera `steps` cores interpolando linearmente ao longo da ramp `colors`.
 *
 * @param colors - Paradas de cor (hex).
 * @param steps - Quantidade de cores a produzir (ex.: nº de caracteres).
 * @returns Uma cor hex por passo (vazio se `steps <= 0`).
 */
export function rampColors(colors: readonly string[], steps: number): string[] {
  if (steps <= 0) return [];
  const stops = colors.map(hexToRgb).filter((c): c is [number, number, number] => c !== undefined);
  if (stops.length === 0) return [];
  if (stops.length === 1 || steps === 1) {
    return Array.from({ length: steps }, () => rgbToHex(stops[0] as [number, number, number]));
  }
  const out: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (i / (steps - 1)) * (stops.length - 1); // posição na ramp [0, stops-1]
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = t - lo;
    const a = stops[lo] as [number, number, number];
    const b = stops[hi] as [number, number, number];
    out.push(rgbToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]));
  }
  return out;
}

/**
 * Renderiza `children` (texto) com um gradiente ao longo de `colors`.
 *
 * @param props.children - Texto a colorir.
 * @param props.colors - Ramp de cores (hex); vazia ⇒ sem cor.
 * @param props.bold - Negrito (default `false`, #190). Em alguns terminais
 *   (ex.: Terminal.app do macOS) o atributo BOLD ignora o fg truecolor e
 *   renderiza "preto", ilegível sobre o bg escuro do OSC — por isso o padrão
 *   é sem negrito; o destaque do gradiente já vem da própria ramp de cores.
 */
export function GradientText({
  children,
  colors,
  bold = false,
}: {
  children: string;
  colors: readonly string[];
  bold?: boolean;
}) {
  const chars = [...children];
  const ramp = rampColors(colors, chars.length);
  if (ramp.length === 0) {
    return <Text bold={bold}>{children}</Text>;
  }
  return (
    <Text bold={bold}>
      {chars.map((ch, i) => (
        <Text key={i} color={ramp[i] as string}>
          {ch}
        </Text>
      ))}
    </Text>
  );
}
