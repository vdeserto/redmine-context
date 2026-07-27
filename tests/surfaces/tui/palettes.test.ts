/**
 * Testes das paletas de cores da TUI (#190) — integridade dos dados + resolução.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_PALETTE_ID, PALETTES, resolvePalette } from '../../../src/surfaces/tui/palettes.js';

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const REQUIRED_TOKENS = ['primary', 'accent', 'muted', 'success', 'warning', 'danger', 'border'] as const;

describe('paletas (#190)', () => {
  it('todas têm id único, label e tokens obrigatórios em hex de 6 dígitos', () => {
    const ids = new Set<string>();
    expect(PALETTES.length).toBeGreaterThanOrEqual(6);
    for (const palette of PALETTES) {
      expect(palette.id, `id kebab-case`).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(palette.id), `id duplicado: ${palette.id}`).toBe(false);
      ids.add(palette.id);
      expect(palette.label.length).toBeGreaterThan(0);
      for (const token of REQUIRED_TOKENS) {
        expect(palette.theme[token], `${palette.id}.${token}`).toMatch(HEX6);
      }
      // Tokens de riqueza (#190): fundo hex + ramp de gradiente com ≥ 2 paradas.
      expect(palette.theme.background, `${palette.id}.background`).toMatch(HEX6);
      expect((palette.theme.gradient ?? []).length).toBeGreaterThanOrEqual(2);
      for (const g of palette.theme.gradient ?? []) expect(g).toMatch(HEX6);
    }
  });

  it('DEFAULT_PALETTE_ID é a primeira da lista e é resolvível', () => {
    expect(DEFAULT_PALETTE_ID).toBe(PALETTES[0]!.id);
    expect(resolvePalette(DEFAULT_PALETTE_ID).id).toBe(DEFAULT_PALETTE_ID);
  });

  it('resolvePalette com id conhecido devolve a paleta certa', () => {
    for (const palette of PALETTES) {
      expect(resolvePalette(palette.id).id).toBe(palette.id);
    }
  });

  it('resolvePalette com id desconhecido ou undefined cai na default', () => {
    expect(resolvePalette('paleta-inexistente').id).toBe(DEFAULT_PALETTE_ID);
    expect(resolvePalette(undefined).id).toBe(DEFAULT_PALETTE_ID);
  });
});
