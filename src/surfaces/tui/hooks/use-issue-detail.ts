/**
 * Lógica de dados da tela de detalhe de issue (#31): busca o detalhe
 * completo via o core — resolve a credencial pela cascata (`resolveApiKey`),
 * monta um client HTTP autenticado (`createHttpClient`), busca o payload
 * bruto (`getIssue`) e normaliza para o modelo estável (`normalizeIssue`).
 *
 * Escolha deliberada: `getIssue` + `normalizeIssue` DIRETO, não
 * `fetchIssueBundle` — o bundle serializa para Markdown/JSON (formato de
 * saída da CLI/MCP); a tela de detalhe da TUI precisa do modelo `Issue` em
 * memória para renderizar metadados + paginar/rolar descrição e journals
 * (`../components/scroll-view.tsx`), não de um texto já serializado.
 *
 * Extraída para um hook pelo mesmo motivo de `./use-my-issues.ts`: a busca é
 * assíncrona e precisa ser testável com dependências injetadas — nenhum
 * teste deste arquivo toca keychain ou rede reais.
 *
 * Fronteira do core (ADR-005): a única coisa importada daqui é
 * `../../../index.js` — a tela (`../screens/issue-detail.tsx`) só formata os
 * estados visuais, nunca chama o core diretamente.
 *
 * A instância vem de `REDMINE_URL` (mesma convenção do doctor/home — ver
 * `./use-my-issues.ts`), lida do `env` injetado (default `process.env`).
 *
 * Mandatório (M2-13, #36): a busca é envolvida por `useAuthGuard` — um 401
 * dispara o re-login e retoma a busca sozinha (o estado permanece `loading`
 * até lá); se o re-login for abandonado (Esc), o hook expõe o estado
 * `auth-aborted` (neutro, não um erro), com `retry` disponível.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  createHttpClient,
  getIssue,
  normalizeIssue,
  resolveApiKey,
  RedmineForbiddenError,
  RedmineNotFoundError,
  type CredentialCascadeOptions,
  type HttpClient,
  type Issue,
} from '../../../index.js';
import { useEnvFallbackAllowed } from '../instance.js';
import { ReAuthAbortedError, useAuthGuard } from './use-auth-guard.js';

/**
 * Estado da busca de detalhe de issue, consumido por
 * `../screens/issue-detail.tsx`. `no-selection` cobre o caso defensivo de a
 * tela ser alcançada sem uma issue selecionada (ver
 * `../screens/home-selection.tsx`) — não deveria acontecer no fluxo normal
 * (a home sempre define `selectedIssueId` antes de empilhar esta tela), mas
 * evita uma busca com `issueId` inválido caso aconteça.
 */
export type IssueDetailState =
  | { status: 'no-selection' }
  | { status: 'loading' }
  | { status: 'loaded'; issue: Issue }
  | { status: 'error-network'; message: string }
  | { status: 'error-forbidden'; message: string }
  | { status: 'error-not-found'; message: string }
  | { status: 'auth-aborted'; message: string };

/** Dependências injetáveis do hook — todas opcionais, com defaults de produção via o core. */
export interface UseIssueDetailOptions {
  /** Ambiente consultado para `REDMINE_URL`; default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Resolve a api_key pela cascata M2; default `resolveApiKey` do core. */
  resolveApiKey?: typeof resolveApiKey;
  /** Constrói o client HTTP autenticado; default `createHttpClient` do core. */
  createHttpClient?: typeof createHttpClient;
  /** Busca o payload bruto de `/issues/{id}.json`; default `getIssue` do core. */
  getIssue?: typeof getIssue;
  /** Normaliza o payload bruto no modelo `Issue`; default `normalizeIssue` do core. */
  normalizeIssue?: typeof normalizeIssue;
}

/** Valor retornado pelo hook. */
export interface UseIssueDetailResult {
  /** Estado atual da busca (ver {@link IssueDetailState}). */
  state: IssueDetailState;
  /** Reexecuta a busca do zero — usado pelo retry (tecla `r`) dos estados de erro. */
  retry: () => void;
}

/** Lê `REDMINE_URL` do ambiente, tratando string vazia como ausente (mesma convenção do doctor/home). */
function instanceFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.REDMINE_URL;
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Busca o detalhe completo de uma issue (`getIssue` + `normalizeIssue`) via
 * o core.
 *
 * @param issueId - Id da issue a buscar, ou `undefined` (estado defensivo
 *   `no-selection`, ver {@link IssueDetailState}).
 * @param options - Dependências injetáveis. Ver {@link UseIssueDetailOptions}.
 * @returns O {@link UseIssueDetailResult} atual.
 * @example
 * const { state, retry } = useIssueDetail(selectedIssueId); // deps de produção
 */
export function useIssueDetail(
  issueId: number | undefined,
  options: UseIssueDetailOptions = {},
): UseIssueDetailResult {
  const env = options.env ?? process.env;
  const resolve = options.resolveApiKey ?? resolveApiKey;
  const buildClient = options.createHttpClient ?? createHttpClient;
  const fetchIssue = options.getIssue ?? getIssue;
  const normalize = options.normalizeIssue ?? normalizeIssue;
  // Mandatório (M2-13, #36): ver o JSDoc do módulo.
  const { guard } = useAuthGuard();
  // SEGURANÇA (#187): origem config (URL persistida) → sem env-key instance-agnóstica.
  const allowEnvFallback = useEnvFallbackAllowed();

  const [state, setState] = useState<IssueDetailState>(
    issueId === undefined ? { status: 'no-selection' } : { status: 'loading' },
  );
  const [reloadToken, setReloadToken] = useState(0);

  const retry = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (issueId === undefined) {
      setState({ status: 'no-selection' });
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

        const http: HttpClient = buildClient({ baseUrl: instanceUrl, apiKey });
        const payload = await guard(() => fetchIssue(http, issueId));
        if (cancelled) return;

        setState({ status: 'loaded', issue: normalize(payload) });
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof RedmineNotFoundError) {
          setState({ status: 'error-not-found', message: `Issue #${issueId} não encontrada (404).` });
          return;
        }
        if (cause instanceof RedmineForbiddenError) {
          setState({
            status: 'error-forbidden',
            message: 'Sem permissão para ver esta issue nesta instância (403).',
          });
          return;
        }
        if (cause instanceof ReAuthAbortedError) {
          setState({
            status: 'auth-aborted',
            message: 'login cancelado — pressione r para tentar de novo',
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
    // Reason: `env`/`resolve`/`buildClient`/`fetchIssue`/`normalize`/`guard`
    // são estáveis entre renders com as deps de produção — o efeito só
    // precisa refazer a busca quando `issueId` muda (nova issue selecionada)
    // ou `reloadToken` muda (retry).
  }, [issueId, env, allowEnvFallback, resolve, buildClient, fetchIssue, normalize, guard, reloadToken]);

  return { state, retry };
}
