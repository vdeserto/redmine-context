import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isTyping,
  resetTypingGuard,
  useTypingGuard,
} from '../../../../src/surfaces/tui/hooks/use-typing-guard.js';

/** Componente mínimo que registra (ou não) a digitação. */
function Field({ active }: { active: boolean }) {
  useTypingGuard(active);
  return null;
}

afterEach(() => resetTypingGuard());

describe('useTypingGuard', () => {
  it('começa sem digitação', () => {
    expect(isTyping()).toBe(false);
  });

  // Caso esperado: campo ativo suspende os atalhos de letra.
  it('marca digitação enquanto o campo está ativo', () => {
    const { unmount } = render(<Field active />);
    expect(isTyping()).toBe(true);

    unmount();
    expect(isTyping()).toBe(false);
  });

  // Campo montado mas INATIVO (ex.: o de senha antes de o foco chegar nele)
  // não pode bloquear atalho nenhum.
  it('campo inativo não marca digitação', () => {
    render(<Field active={false} />);
    expect(isTyping()).toBe(false);
  });

  // Edge case: mais de um campo na mesma tela (usuário + senha). A ordem de
  // desmontagem entre eles não é garantida — por isso um contador, não um
  // booleano: desmontar um não pode liberar os atalhos enquanto o outro digita.
  it('conta campos simultâneos e só libera no último', () => {
    const a = render(<Field active />);
    const b = render(<Field active />);
    expect(isTyping()).toBe(true);

    a.unmount();
    expect(isTyping()).toBe(true);

    b.unmount();
    expect(isTyping()).toBe(false);
  });

  // Failure case: desmontagens extras não podem deixar o contador negativo, o
  // que travaria `isTyping()` em false para sempre.
  it('não deixa o contador negativo', () => {
    const { unmount } = render(<Field active />);
    unmount();
    resetTypingGuard();

    const again = render(<Field active />);
    expect(isTyping()).toBe(true);
    again.unmount();
    expect(isTyping()).toBe(false);
  });
});
