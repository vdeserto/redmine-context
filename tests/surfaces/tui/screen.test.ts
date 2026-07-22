/**
 * Testes do registro de telas (`screen.ts`, M2-04) — cada entrada precisa
 * expor um componente renderizável e um título legível, consumido pelo
 * breadcrumb (`components/breadcrumb.tsx`).
 */
import { describe, expect, it } from 'vitest';

import { INITIAL_SCREEN, SCREENS } from '../../../src/surfaces/tui/screen.js';

describe('TUI: registro de telas (SCREENS)', () => {
  it('a tela inicial existe no registro', () => {
    expect(SCREENS[INITIAL_SCREEN]).toBeDefined();
  });

  it('toda entrada do registro tem um componente e um título não vazio', () => {
    for (const [name, entry] of Object.entries(SCREENS)) {
      expect(typeof entry.component, `${name}.component`).toBe('function');
      expect(typeof entry.title, `${name}.title`).toBe('string');
      expect(entry.title.length, `${name}.title`).toBeGreaterThan(0);
    }
  });
});
