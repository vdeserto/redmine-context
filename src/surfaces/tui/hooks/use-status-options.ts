/**
 * Opções do filtro de status da home (#30, revisto).
 *
 * O ciclo `todas → abertas → fechadas` não servia a uma instância real: todos os
 * status de trabalho (Nova, Fila, Estimativa, Atribuída, Em Andamento,
 * Validação…) são ABERTOS, então alternar entre "todas" e "abertas" devolvia a
 * mesma lista e o filtro parecia quebrado.
 *
 * Este hook carrega os status DA INSTÂNCIA (`/issue_statuses.json`, já memoizado
 * por `fetchEnumerations`) e os oferece como opções, com os dois agregados úteis
 * no topo. Degrada em silêncio: sem permissão ou sem rede, sobram os agregados —
 * o mesmo comportamento de antes, nunca um erro na tela.
 */
import { useEffect, useState } from 'react';

import {
  createHttpClient,
  fetchEnumerations,
  resolveApiKey,
  type CredentialCascadeOptions,
} from '../../../index.js';
import { useEnvFallbackAllowed } from '../instance.js';
import type { SearchStatusFilter } from './use-issue-search.js';

/** Uma opção do seletor: o valor do filtro + o rótulo exibido. */
export interface StatusOption {
  /** Valor aplicado ao filtro. */
  readonly value: SearchStatusFilter;
  /** Rótulo legível (nome do status na instância, ou o agregado). */
  readonly label: string;
}

/** Agregados sempre disponíveis, mesmo sem as enumerações da instância. */
const BASE_OPTIONS: readonly StatusOption[] = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abertas' },
  { value: 'closed', label: 'Fechadas' },
];

/** Lê `REDMINE_URL` do ambiente, tratando string vazia como ausente. */
function instanceFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.REDMINE_URL;
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** Opções injetáveis (testes não tocam a rede). */
export interface UseStatusOptionsOptions {
  /** Ambiente consultado para `REDMINE_URL`; default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Resolve a api_key pela cascata; default `resolveApiKey` do core. */
  resolveApiKey?: typeof resolveApiKey;
  /** Constrói o client HTTP; default `createHttpClient` do core. */
  createHttpClient?: typeof createHttpClient;
  /** Busca as enumerações; default `fetchEnumerations` do core. */
  fetchEnumerations?: typeof fetchEnumerations;
}

/**
 * Opções do filtro de status: agregados + os status reais da instância.
 *
 * @param options - Dependências injetáveis (ver {@link UseStatusOptionsOptions}).
 * @returns A lista de opções; só os agregados enquanto carrega ou se falhar.
 * @example
 * const options = useStatusOptions();
 * // [{ value: 'all', label: 'Todas' }, ..., { value: 7, label: 'Atribuída' }]
 */
export function useStatusOptions(options: UseStatusOptionsOptions = {}): readonly StatusOption[] {
  const env = options.env ?? process.env;
  const resolve = options.resolveApiKey ?? resolveApiKey;
  const buildClient = options.createHttpClient ?? createHttpClient;
  const loadEnumerations = options.fetchEnumerations ?? fetchEnumerations;
  const allowEnvFallback = useEnvFallbackAllowed();

  const [statuses, setStatuses] = useState<readonly StatusOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const instanceUrl = instanceFromEnv(env);
    if (instanceUrl === undefined) return undefined;

    void (async () => {
      try {
        const cascade: CredentialCascadeOptions = { env, allowEnvFallback };
        const apiKey = await resolve(instanceUrl, cascade);
        if (apiKey === undefined || cancelled) return;

        const enums = await loadEnumerations(
          buildClient({ baseUrl: instanceUrl, apiKey }),
          instanceUrl,
        );
        if (cancelled) return;

        // Ordem estável por id: a lista não pode dançar entre renders.
        setStatuses(
          [...enums.status.entries()]
            .sort(([a], [b]) => a - b)
            .map(([id, label]) => ({ value: id, label })),
        );
      } catch {
        // Enriquecimento, não dado essencial: sem os status da instância o
        // seletor segue com os agregados.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [env, allowEnvFallback, resolve, buildClient, loadEnumerations]);

  return statuses.length === 0 ? BASE_OPTIONS : [...BASE_OPTIONS, ...statuses];
}

/**
 * Rótulo de um filtro, resolvido contra as opções carregadas.
 *
 * @param options - Opções disponíveis.
 * @param filter - Filtro corrente.
 * @returns O rótulo da opção, ou `#id` se o status não constar (degradação).
 */
export function statusFilterLabel(
  options: readonly StatusOption[],
  filter: SearchStatusFilter,
): string {
  const found = options.find((option) => option.value === filter);
  if (found !== undefined) return found.label;
  return typeof filter === 'number' ? `#${filter}` : filter;
}
