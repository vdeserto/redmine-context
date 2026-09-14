import { describe, expect, it } from 'vitest';

import { statusColor, statusFilterColor } from '../../../src/surfaces/tui/status-color.js';
import { DEFAULT_THEME } from '../../../src/surfaces/tui/theme.js';

const THEME = DEFAULT_THEME;

describe('statusColor: heurística por nome do status', () => {
  // Caso esperado: os nomes que o Redmine brasileiro usa para "terminado".
  it.each(['Fechado', 'Fechada', 'Closed', 'Resolvido', 'Concluída'])(
    '"%s" é success',
    (name) => {
      expect(statusColor(THEME, name)).toBe(THEME.success);
    },
  );

  it.each(['Em andamento', 'In Progress', 'Em curso'])('"%s" é warning', (name) => {
    expect(statusColor(THEME, name)).toBe(THEME.warning);
  });

  it('cancelado é danger', () => {
    expect(statusColor(THEME, 'Cancelado')).toBe(THEME.danger);
  });

  // Edge case: a heurística não conhece todos os workflows do mundo — status
  // desconhecido cai em primary, nunca sem cor.
  it.each(['Nova', 'Atribuída', 'Estimativa', ''])('"%s" cai no fallback primary', (name) => {
    expect(statusColor(THEME, name)).toBe(THEME.primary);
  });

  it('é insensível a maiúsculas', () => {
    expect(statusColor(THEME, 'FECHADO')).toBe(statusColor(THEME, 'fechado'));
  });
});

describe('statusFilterColor: badge do filtro rápido', () => {
  // "Todas" é a AUSÊNCIA de filtro: badge discreto, para não competir com o
  // conteúdo da lista.
  it('all fica em muted', () => {
    expect(statusFilterColor(THEME, 'all')).toBe(THEME.muted);
  });

  // Os estados FILTRADOS puxam cor — é o sinal de "tem filtro ligado".
  it('open e closed puxam cor do tema', () => {
    expect(statusFilterColor(THEME, 'open')).toBe(THEME.primary);
    expect(statusFilterColor(THEME, 'closed')).toBe(THEME.success);
  });

  // Coerência com statusColor: "fechado" é success nos dois lugares, senão o
  // badge do filtro e o badge da issue contariam histórias diferentes sobre a
  // mesma palavra.
  it('concorda com statusColor para "fechado"', () => {
    expect(statusFilterColor(THEME, 'closed')).toBe(statusColor(THEME, 'Fechado'));
  });

  // Contraste: nunca devolve literal — só token do tema, que é calibrado por
  // paleta (ver ../../../src/surfaces/tui/palettes.ts).
  it.each(['open' as const, 'closed' as const, 'all' as const])(
    'devolve um token do tema para %s',
    (filter) => {
      expect(Object.values(THEME)).toContain(statusFilterColor(THEME, filter));
    },
  );
});
