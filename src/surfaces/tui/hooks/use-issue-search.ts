/**
 * Lógica de dados da busca inline da home (M2-07, issue #30): busca textual
 * + filtro rápido de status via `fetchIssueSearch` do core — orquestração
 * que já combina filtros estruturados (`assigned_to_id=me` + `status_id`)
 * com full-text best-effort (`/search.json`, com degradação sinalizada no
 * payload quando indisponível). Extraído para um hook próprio (em vez de
 * estender `use-my-issues.ts`) porque o gatilho é bem diferente: `useMyIssues`
 * busca uma vez ao montar, enquanto esta busca é retriggada a cada mudança de
 * `query`/`statusFilter` — mas reaproveita deliberadamente o MESMO formato de
 * `MyIssuesState` (`loading`/`error-network`/`error-forbidden`/`auth-aborted`
 * + um estado "carregado") para a tela (`../screens/home.tsx`) tratar os dois
 * hooks de forma consistente.
 *
 * Fronteira do core (ADR-005): a única coisa importada daqui é
 * `../../../index.js` (`fetchIssueSearch`/`resolveApiKey`) — a tela só
 * formata os estados, nunca chama o core diretamente.
 *
 * Debounce de digitação: `query` normalmente muda a cada tecla (controlado
 * pelo `TextInput` da home); disparar `fetchIssueSearch` a cada tecla geraria
 * uma chamada de rede por caractere digitado. Este hook espera
 * `debounceMs` (300ms em produção, {@link DEFAULT_DEBOUNCE_MS}) de silêncio
 * antes de efetivamente buscar — implementado com um `setTimeout` reagendado
 * a cada mudança de `query` (cancelado no cleanup do efeito).
 *
 * 401 via `useAuthGuard` (M2-13, #36, mandatório para qualquer chamada
 * autenticada ao core): a busca é envolvida por `guard()`, mesmo padrão de
 * `use-my-issues.ts` — em 401, o estado permanece `loading` durante o
 * re-auth e a busca é refeita automaticamente após o re-login. Abandono do
 * re-login (Esc) vira o estado `auth-aborted`.
 */
import { useEffect, useRef, useState } from 'react';

import {
  fetchIssueSearch,
  resolveApiKey,
  RedmineForbiddenError,
  type CredentialCascadeOptions,
} from '../../../index.js';
import { useEnvFallbackAllowed } from '../instance.js';
import { ReAuthAbortedError, useAuthGuard } from './use-auth-guard.js';

/** Debounce (ms) default aplicado a `query` antes de disparar a busca. */
export const DEFAULT_DEBOUNCE_MS = 300;

/** Filtro rápido de status (tecla `f` cicla entre os três, ver `../screens/home.tsx`). */
export type SearchStatusFilter = 'open' | 'closed' | 'all';

/**
 * Estado da busca, consumido por `../screens/home.tsx`. Mesmo vocabulário de
 * `MyIssuesState` (`use-my-issues.ts`) + um `idle` inicial próprio: a busca
 * só começa a existir quando há algo para buscar (query não vazia OU filtro
 * de status diferente de `'all'`) — sem isso, `idle` evita uma chamada de
 * rede desnecessária assim que o campo de busca abre vazio.
 */
export type IssueSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; content: string; count: number; degraded: boolean; warnings: string[] }
  | { status: 'error-network'; message: string }
  | { status: 'error-forbidden'; message: string }
  | { status: 'auth-aborted'; message: string };

/** Dependências injetáveis do hook — todas opcionais, com defaults de produção via o core. */
export interface UseIssueSearchOptions {
  /** Ambiente consultado para `REDMINE_URL`; default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Resolve a api_key pela cascata M2; default `resolveApiKey` do core. */
  resolveApiKey?: typeof resolveApiKey;
  /** Orquestra a busca (filtros + full-text best-effort); default `fetchIssueSearch` do core. */
  fetchIssueSearch?: typeof fetchIssueSearch;
  /** Debounce (ms) aplicado a `query`. Default: {@link DEFAULT_DEBOUNCE_MS}. */
  debounceMs?: number;
}

/** Valor retornado pelo hook. */
export interface UseIssueSearchResult {
  /** Estado atual da busca (ver {@link IssueSearchState}). */
  state: IssueSearchState;
  /**
   * Restaura o estado para `idle` IMEDIATAMENTE, cancelando qualquer debounce
   * pendente — usado pelo Esc da home (M2-07, #30) para "limpar a busca"
   * sem esperar o debounce nem disparar uma nova chamada a `fetchIssueSearch`.
   * A tela também deve resetar `query`/`statusFilter` para os valores neutros
   * (`''`/`'all'`) ao chamar isto, para que o próximo efeito não reagende a
   * mesma busca.
   */
  clear: () => void;
}

/** Mapeia o filtro rápido de status para o `status_id` de `/issues.json` (`*` = todas). */
function statusIdFor(filter: SearchStatusFilter): string {
  if (filter === 'open') return 'open';
  if (filter === 'closed') return 'closed';
  return '*';
}

/** Lê `REDMINE_URL` do ambiente, tratando string vazia como ausente (mesma convenção do doctor/home). */
function instanceFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.REDMINE_URL;
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Busca issues (filtros + full-text best-effort) via o core, com debounce de
 * digitação e o filtro rápido de status.
 *
 * @param query - Termo full-text bruto (não debounced) — tipicamente o
 *   `value` do `TextInput` da busca da home.
 * @param statusFilter - Filtro rápido de status (ver {@link SearchStatusFilter}).
 * @param options - Dependências injetáveis. Ver {@link UseIssueSearchOptions}.
 * @returns O {@link UseIssueSearchResult} atual.
 *
 * @example
 * const { state, clear } = useIssueSearch(query, statusFilter); // deps de produção
 */
export function useIssueSearch(
  query: string,
  statusFilter: SearchStatusFilter,
  options: UseIssueSearchOptions = {},
): UseIssueSearchResult {
  const env = options.env ?? process.env;
  const resolve = options.resolveApiKey ?? resolveApiKey;
  const runSearch = options.fetchIssueSearch ?? fetchIssueSearch;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  // Fix do padrão #120 (use-my-issues.ts): qualquer chamada autenticada ao
  // core passa por `guard()` — 401 dispara o re-login e retoma a busca.
  const { guard } = useAuthGuard();
  // SEGURANÇA (#187): origem config (URL persistida) → sem env-key instance-agnóstica.
  const allowEnvFallback = useEnvFallbackAllowed();

  const [state, setState] = useState<IssueSearchState>({ status: 'idle' });
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  // Debounce: só propaga `query` para `debouncedQuery` depois de `debounceMs`
  // de silêncio — reagendado a cada tecla (cleanup cancela o timer anterior).
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, debounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [query, debounceMs]);

  useEffect(() => {
    let cancelled = false;
    const trimmed = debouncedQuery.trim();

    // Nada para buscar: sem texto E sem filtro de status ativo. `idle` evita
    // uma chamada de rede assim que o campo de busca abre vazio.
    if (trimmed.length === 0 && statusFilter === 'all') {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'loading' });

    const instanceUrl = instanceFromEnv(env);
    if (instanceUrl === undefined) {
      setState({
        status: 'error-network',
        message: 'Instância não configurada (defina REDMINE_URL).',
      });
      return;
    }

    const cascadeOptions: CredentialCascadeOptions = { env, allowEnvFallback };

    void (async () => {
      try {
        const apiKey = await resolve(instanceUrl, cascadeOptions);
        if (apiKey === undefined) {
          if (!cancelled) {
            setState({
              status: 'error-network',
              message: `Nenhuma credencial encontrada para ${instanceUrl}.`,
            });
          }
          return;
        }

        const result = await guard(() =>
          runSearch({
            baseUrl: instanceUrl,
            apiKey,
            filters: { assigned_to_id: 'me', status_id: statusIdFor(statusFilter) },
            query: trimmed.length > 0 ? trimmed : undefined,
          }),
        );
        if (cancelled) return;

        setState({
          status: 'loaded',
          content: result.content,
          count: result.count,
          degraded: result.degraded,
          warnings: result.warnings,
        });
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof RedmineForbiddenError) {
          setState({
            status: 'error-forbidden',
            message: 'Sem permissão para buscar issues nesta instância (403).',
          });
          return;
        }
        if (cause instanceof ReAuthAbortedError) {
          setState({
            status: 'auth-aborted',
            message: 'login cancelado — pressione f/digite de novo para tentar',
          });
          return;
        }
        const message = cause instanceof Error ? cause.message : String(cause);
        setState({ status: 'error-network', message });
      }
    })();

    return () => {
      cancelled = true;
    };
    // Reason: `env`/`resolve`/`runSearch`/`guard` são estáveis entre renders
    // com as deps de produção (defaults do módulo, ou `process.env`, ou a
    // identidade estável de `useAuthGuard().guard`) — o efeito só precisa
    // refazer a busca quando `debouncedQuery`/`statusFilter` mudam.
  }, [debouncedQuery, statusFilter, env, allowEnvFallback, resolve, runSearch, guard]);

  // Handler ESTÁVEL (useCallback via ref indireta não é necessário aqui: sem
  // dependências externas mutáveis, `clear` já é estável por construção).
  const clear = useRef((): void => {
    setDebouncedQuery('');
    setState({ status: 'idle' });
  }).current;

  return { state, clear };
}
