/**
 * Lógica assíncrona da seção "Binários de mídia" da tela doctor (M3-11, #53).
 *
 * Extraída para um hook porque o diagnóstico (`diagnoseBinaries`) é assíncrono
 * (localiza binários no filesystem e lê versão via subprocesso) e precisa ser
 * testável com a dependência injetada — nenhum teste deste arquivo consulta um
 * binário real.
 *
 * Fronteira do core (ADR-005): a única coisa importada daqui é `diagnoseBinaries`
 * via `../../../index.js` — a mesma superfície pública que a CLI consome para o
 * comando `doctor`. Sem reimplementar detecção na TUI.
 */
import { useEffect, useState } from 'react';

import { diagnoseBinaries, type BinaryDiagnosis } from '../../../index.js';

/** Estado da seção "Binários de mídia": carregando + o resultado do diagnóstico. */
export interface MediaBinariesState {
  /** `true` enquanto o diagnóstico assíncrono ainda não resolveu. */
  loading: boolean;
  /** Binários diagnosticados (vazio até resolver, ou se o diagnóstico falhar). */
  binaries: BinaryDiagnosis[];
}

/** Dependências injetáveis do hook — todas opcionais, com defaults de produção. */
export interface UseMediaBinariesOptions {
  /** Executa o diagnóstico; default `diagnoseBinaries` do core. */
  diagnose?: typeof diagnoseBinaries;
}

/**
 * Diagnostica os binários de mídia uma vez, no mount. Nunca lança: se o
 * diagnóstico rejeitar, sai do loading com uma lista vazia (a tela apenas não
 * exibe binários — degradação graciosa).
 *
 * @param options - Deps injetáveis. Ver {@link UseMediaBinariesOptions}.
 * @returns O {@link MediaBinariesState} atual — começa em `loading: true`.
 * @example
 * const { loading, binaries } = useMediaBinaries();
 */
export function useMediaBinaries(options: UseMediaBinariesOptions = {}): MediaBinariesState {
  const diagnose = options.diagnose ?? diagnoseBinaries;
  const [state, setState] = useState<MediaBinariesState>({ loading: true, binaries: [] });

  useEffect(() => {
    let cancelled = false;
    diagnose().then(
      (binaries) => {
        if (!cancelled) setState({ loading: false, binaries });
      },
      () => {
        if (!cancelled) setState({ loading: false, binaries: [] });
      },
    );
    return () => {
      cancelled = true;
    };
    // Reason: `diagnose` é estável entre renders (default do módulo, ou uma dep
    // injetada estável no teste) — o diagnóstico só precisa rodar uma vez.
  }, [diagnose]);

  return state;
}
