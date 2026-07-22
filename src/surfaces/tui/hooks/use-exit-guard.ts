/**
 * Padrão "duplo Ctrl+C" da TUI (M2-04): a primeira pressão cancela uma
 * operação em andamento (gancho `onCancel` — ainda sem consumidor no M2-04,
 * mas já pronto para telas assíncronas futuras: login em validação no
 * M2-05.2, job rodando no M2-11) e arma um aviso visual temporizado; uma
 * segunda pressão dentro da janela de tempo encerra o app via `onExit`. Fora
 * da janela, a pressão seguinte volta a contar como a "primeira".
 *
 * Isolado do roteador (`../app.tsx`) para poder ser testado sem depender do
 * resto da árvore de telas — `app.tsx` só liga `onExit` a `useApp().exit()`.
 *
 * Requer que o app rode com `exitOnCtrlC: false` no `render()` do Ink
 * (`../index.ts`) — do contrário, o próprio Ink intercepta Ctrl+C antes de
 * `useInput()` rodar e sai do processo na primeira pressão, sem chance deste
 * hook aplicar o padrão de duas pressões.
 */
import { useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

/** Tempo (ms) que o aviso de saída fica armado antes de expirar sozinho. */
export const EXIT_GUARD_WINDOW_MS = 2000;

/** Valor retornado pelo hook. */
export interface UseExitGuardResult {
  /** `true` enquanto o aviso "pressione Ctrl+C de novo para sair" deve aparecer. */
  armed: boolean;
}

/**
 * Liga o handler global de Ctrl+C do app.
 *
 * @param onExit Chamado na segunda pressão dentro da janela de tempo.
 * @param onCancel Chamado na primeira pressão (cancela uma operação em
 *   andamento, se houver). Opcional.
 * @param windowMs Janela de tempo em que a segunda pressão conta como
 *   confirmação de saída. Parametrizável para testes; usa
 *   {@link EXIT_GUARD_WINDOW_MS} por padrão em produção.
 */
export function useExitGuard(
  onExit: () => void,
  onCancel?: () => void,
  windowMs: number = EXIT_GUARD_WINDOW_MS,
): UseExitGuardResult {
  const [armed, setArmed] = useState(false);
  // Reason: `armedRef` é a fonte de verdade lida de forma síncrona dentro do
  // handler de input — evita depender da closure presa ao `armed` da última
  // renderização (o handler de `useInput` é recriado a cada render, mas o
  // `ref` sempre reflete o estado mais recente, mesmo entre pressões rápidas).
  const armedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useInput((input, key) => {
    if (!(key.ctrl && input === 'c')) {
      return;
    }

    if (armedRef.current) {
      onExit();
      return;
    }

    onCancel?.();
    armedRef.current = true;
    setArmed(true);

    if (timeoutRef.current !== undefined) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      armedRef.current = false;
      setArmed(false);
    }, windowMs);
  });

  return { armed };
}
