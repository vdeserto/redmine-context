/**
 * Testes do interceptor pontual de Esc (M2-07, #30) — usado pela busca da
 * home para desviar o Esc global (`pop()`, `../../../../src/surfaces/tui/app.tsx`)
 * enquanto o campo de busca está ativo. Escrito ANTES da implementação (TDD).
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumeEscapeInterceptor,
  resetEscapeInterceptor,
  useEscapeInterceptor,
} from '../../../../src/surfaces/tui/hooks/use-escape-interceptor.js';

/** Harness: registra `onEscape` enquanto `active` (controlado via `globalThis`). */
function Harness({ onEscape }: { onEscape: () => void }) {
  const [active, setActive] = useState(false);
  (globalThis as { __setActive?: (value: boolean) => void }).__setActive = setActive;
  useEscapeInterceptor(active, onEscape);
  return <Text>{active ? 'active' : 'inactive'}</Text>;
}

function setActive(value: boolean): void {
  (globalThis as { __setActive?: (value: boolean) => void }).__setActive?.(value);
}

afterEach(() => {
  resetEscapeInterceptor();
  delete (globalThis as { __setActive?: unknown }).__setActive;
});

describe('useEscapeInterceptor / consumeEscapeInterceptor', () => {
  it('sem interceptor registrado, consumeEscapeInterceptor() devolve false e não chama nada', () => {
    expect(consumeEscapeInterceptor()).toBe(false);
  });

  it('com o interceptor ativo, consumeEscapeInterceptor() chama onEscape e devolve true', async () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    setActive(true);

    await vi.waitFor(() => {
      expect(consumeEscapeInterceptor()).toBe(true);
    });
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('desregistra quando active vira false — consumeEscapeInterceptor() volta a devolver false', async () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    setActive(true);
    await vi.waitFor(() => {
      expect(consumeEscapeInterceptor()).toBe(true);
    });

    setActive(false);
    await vi.waitFor(() => {
      expect(consumeEscapeInterceptor()).toBe(false);
    });
  });

  it('desregistra ao desmontar o componente', async () => {
    const onEscape = vi.fn();
    const { unmount } = render(<Harness onEscape={onEscape} />);
    setActive(true);
    await vi.waitFor(() => {
      expect(consumeEscapeInterceptor()).toBe(true);
    });

    unmount();
    expect(consumeEscapeInterceptor()).toBe(false);
  });

  it('sempre lê a versão mais recente de onEscape (via ref)', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onEscape={first} />);
    setActive(true);
    await vi.waitFor(() => {
      expect(consumeEscapeInterceptor()).toBe(true);
    });
    expect(first).toHaveBeenCalledOnce();

    rerender(<Harness onEscape={second} />);
    consumeEscapeInterceptor();
    expect(second).toHaveBeenCalledOnce();
  });
});
