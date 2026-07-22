/**
 * Testes do padrão "duplo Ctrl+C" (M2-04) — primeira pressão arma um aviso
 * temporizado (e cancela uma operação em andamento via `onCancel`, gancho
 * para telas assíncronas futuras); segunda pressão dentro da janela sai do
 * app via `onExit`. Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { useExitGuard } from '../../../../src/surfaces/tui/hooks/use-exit-guard.js';

/** Ctrl+C (0x03) — mesmo byte que o terminal envia para o processo. */
const CTRL_C = String.fromCharCode(0x03);

/** Harness: expõe `armed` como texto e repassa `onExit`/`onCancel` ao hook. */
function ExitGuardHarness({
  onExit,
  onCancel,
  windowMs,
}: {
  onExit: () => void;
  onCancel?: () => void;
  windowMs: number;
}) {
  const { armed } = useExitGuard(onExit, onCancel, windowMs);
  return <Text>{armed ? 'armed' : 'idle'}</Text>;
}

describe('TUI: useExitGuard (duplo Ctrl+C)', () => {
  it('começa desarmado e não sai com uma única pressão de Ctrl+C', async () => {
    const onExit = vi.fn();
    const { lastFrame, stdin } = render(<ExitGuardHarness onExit={onExit} windowMs={2000} />);
    expect(lastFrame()).toBe('idle');

    stdin.write(CTRL_C);
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('armed');
    });
    expect(onExit).not.toHaveBeenCalled();
  });

  it('a primeira pressão cancela a operação em andamento via onCancel', async () => {
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      <ExitGuardHarness onExit={vi.fn()} onCancel={onCancel} windowMs={2000} />,
    );
    stdin.write(CTRL_C);
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('armed');
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a segunda pressão dentro da janela sai do app via onExit', async () => {
    const onExit = vi.fn();
    const { stdin, lastFrame } = render(<ExitGuardHarness onExit={onExit} windowMs={2000} />);
    stdin.write(CTRL_C);
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('armed');
    });
    stdin.write(CTRL_C);
    await vi.waitFor(() => {
      expect(onExit).toHaveBeenCalledTimes(1);
    });
  });

  it('o aviso desarma sozinho depois da janela de tempo expirar', async () => {
    // Reason: `windowMs` precisa ser maior que o intervalo de polling do
    // `vi.waitFor` (padrão 50ms) — do contrário o estado "armed" pode
    // expirar entre uma sondagem e outra, sem nunca ser observado.
    const { stdin, lastFrame } = render(<ExitGuardHarness onExit={vi.fn()} windowMs={200} />);
    stdin.write(CTRL_C);
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('armed');
    });
    await vi.waitFor(
      () => {
        expect(lastFrame()).toBe('idle');
      },
      { timeout: 1000 },
    );
  });

  it('uma pressão depois da janela expirar conta como "primeira" de novo (não sai)', async () => {
    const onExit = vi.fn();
    const { stdin, lastFrame } = render(<ExitGuardHarness onExit={onExit} windowMs={200} />);
    stdin.write(CTRL_C);
    await vi.waitFor(() => expect(lastFrame()).toBe('armed'));
    await vi.waitFor(() => expect(lastFrame()).toBe('idle'), { timeout: 1000 });

    stdin.write(CTRL_C);
    await vi.waitFor(() => expect(lastFrame()).toBe('armed'));
    expect(onExit).not.toHaveBeenCalled();
  });

  it('teclas que não são Ctrl+C são ignoradas pelo guard', () => {
    const onExit = vi.fn();
    const { stdin, lastFrame } = render(<ExitGuardHarness onExit={onExit} windowMs={2000} />);
    stdin.write('x');
    expect(lastFrame()).toBe('idle');
    expect(onExit).not.toHaveBeenCalled();
  });
});
