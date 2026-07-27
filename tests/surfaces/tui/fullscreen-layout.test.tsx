/**
 * Guarda do full-screen (#190, achado B2 da review): o container do AppShell usa
 * `minHeight` (não `height` fixo). Com `height` fixo, o Yoga ENCOLHE/AMOSTRA linhas
 * quando o conteúdo é maior que a tela (listas home/jobs viram uma amostragem
 * arbitrária — corrupção). Com `minHeight`, o container cresce e TODOS os itens
 * são renderizados (o terminal real corta o excesso, sem corromper).
 *
 * Espelha a estrutura do container do AppShell (`app.tsx`).
 */
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

const ITEMS = Array.from({ length: 20 }, (_, i) => `linha-${i}`);

describe('full-screen: container com minHeight (B2)', () => {
  it('minHeight preserva TODOS os itens de uma lista mais alta que a "tela"', () => {
    const { lastFrame } = render(
      <Box minHeight={5} width={40} flexDirection="column">
        {ITEMS.map((label) => (
          <Text key={label}>{label}</Text>
        ))}
      </Box>,
    );
    for (const label of ITEMS) {
      expect(lastFrame(), `esperava "${label}" no frame`).toContain(label);
    }
  });

  it('CONTRA-PROVA: height fixo AMOSTRA/perde itens (o bug que o minHeight evita)', () => {
    const { lastFrame } = render(
      <Box height={5} width={40} flexDirection="column">
        {ITEMS.map((label) => (
          <Text key={label}>{label}</Text>
        ))}
      </Box>,
    );
    const present = ITEMS.filter((label) => (lastFrame() ?? '').includes(label));
    // Com height fixo < conteúdo, nem todos os itens sobrevivem (prova o risco).
    expect(present.length).toBeLessThan(ITEMS.length);
  });
});
