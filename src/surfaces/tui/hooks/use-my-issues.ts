/**
 * Lógica de dados da tela home (M2-06, #29): lista "minhas issues"
 * (`assigned_to_id=me`) via o core — resolve a credencial pela cascata
 * (`resolveApiKey`), monta um client HTTP autenticado (`createHttpClient`) e
 * pagina `/issues.json` (`listIssues`). Extraída para um hook porque toda a
 * busca é assíncrona e precisa ser testável com dependências injetadas —
 * nenhum teste deste arquivo toca keychain ou rede reais.
 *
 * Fronteira do core (ADR-005): a única coisa importada daqui é
 * `../../../index.js` — a tela (`../screens/home.tsx`) só formata os 5
 * estados visuais (`loading`/`empty`/`error-network`/`error-forbidden`/
 * `auth-aborted`) mais o estado "com itens" (`loaded`), nunca chama o core
 * diretamente.
 *
 * A instância vem de `REDMINE_URL` (mesma convenção do doctor/CLI/MCP —
 * ver `use-doctor-status.ts`), lida do `env` injetado (default `process.env`).
 *
 * Fix do review do PR #120: esta era a primeira tela de dados (#29+) a
 * chamar o core autenticado SEM passar pelo `useAuthGuard` (M2-13, #36,
 * mandatório para qualquer chamada assim, ver `./use-auth-guard.ts`) — um 401
 * (api_key expirada/revogada) virava um `error-network` cru em vez de
 * disparar o re-login e retomar a busca automaticamente. A busca (`listIssues`)
 * agora é envolvida por `guard()`: em 401, o estado permanece `loading`
 * durante o re-auth (a `Promise` de `guard()` só resolve/rejeita depois que o
 * usuário loga de novo, ver `use-auth-guard.ts`) e a lista carrega assim que o
 * re-login tem sucesso, sem ação extra do usuário. Se o re-login for
 * abandonado (Esc), `guard()` rejeita com `ReAuthAbortedError` — tratado aqui
 * como o estado próprio `auth-aborted` (não um erro cru), com `retry` (tecla
 * `r`, já existente) disponível para tentar de novo.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  createHttpClient,
  listIssues,
  resolveApiKey,
  RedmineForbiddenError,
  type CredentialCascadeOptions,
  type HttpClient,
  type RedmineIssuePayload,
} from '../../../index.js';
import { ReAuthAbortedError, useAuthGuard } from './use-auth-guard.js';

/** Issue resumida exibida numa linha da lista da home — só os campos usados por `IssueRow`. */
export interface MyIssue {
  /** Id numérico da issue (`#id` na linha). */
  id: number;
  /** Assunto da issue (truncado na exibição, nunca aqui). */
  subject: string;
  /** Nome do status (badge colorido por tema). */
  statusName: string;
}

/**
 * Estado da busca de "minhas issues", consumido por `../screens/home.tsx`.
 * `loading`/`empty`/`error-network`/`error-forbidden` são os 4 estados
 * visuais distintos exigidos pela AC da #29; `loaded` é o estado "normal"
 * com a lista preenchida. `auth-aborted` (fix do review #120) é um 5º
 * estado leve, distinto de `error-network`: o usuário viu o prompt de
 * re-login (401 tratado por `useAuthGuard`) e escolheu conscientemente (Esc)
 * não reautenticar — não é uma falha inesperada, então não usa o vocabulário
 * de erro; `retry` (tecla `r`) segue disponível para tentar de novo.
 */
export type MyIssuesState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'loaded'; issues: MyIssue[] }
  | { status: 'error-network'; message: string }
  | { status: 'error-forbidden'; message: string }
  | { status: 'auth-aborted'; message: string };

/** Dependências injetáveis do hook — todas opcionais, com defaults de produção via o core. */
export interface UseMyIssuesOptions {
  /** Ambiente consultado para `REDMINE_URL`; default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Resolve a api_key pela cascata M2; default `resolveApiKey` do core. */
  resolveApiKey?: typeof resolveApiKey;
  /** Constrói o client HTTP autenticado; default `createHttpClient` do core. */
  createHttpClient?: typeof createHttpClient;
  /** Lista issues paginando `/issues.json`; default `listIssues` do core. */
  listIssues?: typeof listIssues;
}

/** Valor retornado pelo hook. */
export interface UseMyIssuesResult {
  /** Estado atual da busca (ver {@link MyIssuesState}). */
  state: MyIssuesState;
  /** Reexecuta a busca do zero (`status` volta a `loading`) — usado pelo retry (tecla `r`) dos estados de erro. */
  retry: () => void;
}

/** Estreita `unknown` para um objeto indexável, ou `undefined` se não for. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Converte um payload bruto de issue em {@link MyIssue}; `undefined` se
 * `subject`/`status.name` faltarem ou tiverem um shape inesperado — a linha
 * é simplesmente omitida da lista em vez de quebrar a tela inteira.
 */
function toMyIssue(raw: RedmineIssuePayload): MyIssue | undefined {
  const subject = raw.subject;
  const statusName = asRecord(raw.status)?.name;
  if (typeof subject !== 'string' || typeof statusName !== 'string') {
    return undefined;
  }
  return { id: raw.id, subject, statusName };
}

/** Lê `REDMINE_URL` do ambiente, tratando string vazia como ausente (mesma convenção do doctor). */
function instanceFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.REDMINE_URL;
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Lista "minhas issues" (`assigned_to_id=me`) via o core.
 *
 * @param options - Dependências injetáveis. Ver {@link UseMyIssuesOptions}.
 * @returns O {@link UseMyIssuesResult} atual — `state.status` começa em
 *   `'loading'` e é atualizado quando a busca assíncrona resolve.
 *
 * @example
 * const { state, retry } = useMyIssues(); // deps de produção (process.env, core real)
 */
export function useMyIssues(options: UseMyIssuesOptions = {}): UseMyIssuesResult {
  const env = options.env ?? process.env;
  const resolve = options.resolveApiKey ?? resolveApiKey;
  const buildClient = options.createHttpClient ?? createHttpClient;
  const fetchIssues = options.listIssues ?? listIssues;
  // Fix do review #120: a busca é uma chamada autenticada ao core — `guard`
  // (identidade estável, `useCallback` sem deps em `use-auth-guard.ts`) trata
  // 401 disparando o re-login e retomando a operação automaticamente.
  const { guard } = useAuthGuard();

  const [state, setState] = useState<MyIssuesState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  const retry = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    const instanceUrl = instanceFromEnv(env);
    if (instanceUrl === undefined) {
      setState({
        status: 'error-network',
        message: 'Instância não configurada (defina REDMINE_URL).',
      });
      return;
    }

    const cascadeOptions: CredentialCascadeOptions = { env };

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
        // Fix do review #120: envolvida por `guard()` — em 401, a Promise só
        // resolve após o re-login ter sucesso e a busca ser refeita
        // automaticamente; o estado do hook permanece `loading` enquanto isso.
        const raw = await guard(() => fetchIssues(http, { filters: { assigned_to_id: 'me' } }));
        if (cancelled) return;

        const issues = raw.map(toMyIssue).filter((issue): issue is MyIssue => issue !== undefined);
        setState(issues.length === 0 ? { status: 'empty' } : { status: 'loaded', issues });
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof RedmineForbiddenError) {
          setState({
            status: 'error-forbidden',
            message: 'Sem permissão para listar suas issues nesta instância (403).',
          });
          return;
        }
        if (cause instanceof ReAuthAbortedError) {
          // Fix do review #120: abandono consciente do re-login (Esc) — estado
          // neutro dedicado, não um erro cru. `retry` (tecla `r`, já existente
          // na tela) refaz a busca do zero.
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
    // Reason: `env`/`resolve`/`buildClient`/`fetchIssues`/`guard` são estáveis
    // entre renders com as deps de produção (defaults do módulo, ou
    // `process.env`, ou a identidade estável de `useAuthGuard().guard`) — o
    // efeito só precisa refazer a busca quando `reloadToken` muda (retry).
  }, [env, resolve, buildClient, fetchIssues, guard, reloadToken]);

  return { state, retry };
}
