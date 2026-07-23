/**
 * Testes do `TextInput` (M2-05.1) — input de texto Ink puro reutilizável
 * pelas telas de onboarding: eco normal, eco mascarado (senha) e o toggle
 * `isActive` que evita capturar teclado quando outro campo da mesma tela
 * está com foco. Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TextInput } from '../../../../src/surfaces/tui/components/text-input.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Caractere DEL (0x7f) — tecla Backspace física na maioria dos terminais (ver `parse-keypress` do Ink). */
const BACKSPACE_KEY = String.fromCharCode(0x7f);
/** Enter (retorno de carro). */
const ENTER = '\r';

/**
 * Um tick de microtask — o `useInput()` do Ink resubscreve seu listener
 * (para capturar o valor mais recente) num efeito passivo separado do
 * commit que atualiza o frame; sem esse tick extra, um segundo
 * `stdin.write()` logo em seguida pode rodar contra o closure antigo (mesmo
 * padrão documentado em `../hooks/use-list-navigation.test.tsx`).
 */
async function tick(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Harness controlado: mantém o valor em estado local, como as telas reais fazem. */
function Harness({
  mask,
  isActive,
  onSubmit,
  showMarker = true,
}: {
  mask?: string;
  isActive?: boolean;
  onSubmit?: (value: string) => void;
  /** Renderiza `marker:<value>` para inspeção do estado bruto — desligado no teste de máscara, que existe justamente para provar que o valor bruto NUNCA aparece no frame. */
  showMarker?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <ThemeProvider>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        mask={mask}
        isActive={isActive}
        placeholder="digite aqui"
      />
      {showMarker ? <Text>marker:{value}</Text> : null}
    </ThemeProvider>
  );
}

describe('TUI: TextInput', () => {
  it('mostra o placeholder quando vazio', () => {
    const { lastFrame } = render(<Harness />);
    expect(lastFrame()).toContain('digite aqui');
  });

  it('eco normal: caracteres digitados aparecem no frame', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    stdin.write('abc');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('marker:abc');
    });
  });

  it('backspace (DEL físico) remove o último caractere', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    stdin.write('abc');
    await vi.waitFor(() => expect(lastFrame()).toContain('marker:abc'));
    await tick();
    stdin.write(BACKSPACE_KEY);
    // Reason: "marker:ab" sozinho seria um falso positivo (é substring de
    // "marker:abc") — o `$` de fim de linha garante que o "c" foi mesmo removido.
    await vi.waitFor(() => expect(lastFrame()).toMatch(/marker:ab$/m));
  });

  it('Enter chama onSubmit com o valor atual', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness onSubmit={onSubmit} />);
    stdin.write('abc');
    await vi.waitFor(() => expect(lastFrame()).toContain('marker:abc'));
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('abc');
    });
  });

  it('mask: NUNCA ecoa o valor real — só o caractere de máscara repetido', async () => {
    // showMarker=false: o objetivo deste teste é justamente provar que o
    // valor bruto não aparece em NENHUM lugar do frame — um marker de
    // depuração que reexibisse `value` cru contradiria o próprio teste.
    const { lastFrame, stdin } = render(<Harness mask="•" showMarker={false} />);
    stdin.write('senha123');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('•'.repeat('senha123'.length));
    });
    expect(lastFrame()).not.toContain('senha123');
  });

  it('isActive=false: ignora teclado (não captura digitação)', () => {
    const { lastFrame, stdin } = render(<Harness isActive={false} />);
    stdin.write('abc');
    expect(lastFrame()).toContain('marker:');
    expect(lastFrame()).not.toContain('marker:abc');
  });
});
