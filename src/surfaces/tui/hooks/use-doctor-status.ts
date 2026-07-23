/**
 * Lógica de status do painel `doctor` (M2-12, #35): reúne versão do Node, da
 * ferramenta, instância configurada, método de credencial em uso e status de
 * conectividade. Extraída para um hook porque a credencial e a conectividade
 * são assíncronas (cascata de credenciais, rede) e precisam ser testáveis com
 * dependências injetadas — nenhum teste deste arquivo toca keychain ou rede
 * reais.
 *
 * Fronteira do core (ADR-005): a única coisa importada daqui é
 * `describeCredentialSource` + `TOOL_NAME`/`TOOL_VERSION` via `../../../index.js`
 * — a checagem de conectividade usa `fetch` global diretamente (mesmo padrão
 * de baixo nível de `client/http.ts`/`config/login.ts`), porque o doctor testa
 * apenas ALCANÇABILIDADE (GET leve, sem autenticação) — não uma chamada de
 * API do core, então não há nada do core a reexportar para isso.
 *
 * Sem vazamento de segredos: a api_key nunca entra neste módulo — a fonte da
 * credencial é relatada pelo NOME (`'keyring' | 'file' | 'env' | 'none'`), e a
 * checagem de conectividade é uma requisição não autenticada.
 */
import { useEffect, useState } from 'react';

import { describeCredentialSource, TOOL_NAME, TOOL_VERSION, type CredentialSourceKind } from '../../../index.js';

/** Resultado do teste leve de conectividade. */
export type ConnectivityStatus = 'checking' | 'ok' | 'error' | 'skipped';

/** Snapshot completo do painel de diagnóstico exibido por `doctor.tsx`. */
export interface DoctorStatus {
  /** Versão do runtime Node (`process.version`, ou injetada em teste). */
  nodeVersion: string;
  /** Nome do produto (via core). */
  toolName: string;
  /** Versão do produto (via core). */
  toolVersion: string;
  /** Instância configurada (`REDMINE_URL`), ou `undefined` se ausente. */
  instanceUrl: string | undefined;
  /**
   * Fonte da credencial em uso na cascata — NUNCA a api_key em si.
   * `'checking'` enquanto a consulta assíncrona ainda não resolveu.
   */
  credentialMethod: CredentialSourceKind | 'checking';
  /** Resultado do teste leve de conectividade (ver {@link ConnectivityStatus}). */
  connectivity: ConnectivityStatus;
  /** Detalhe do erro de conectividade, se houver — sempre seguro (sem segredos). */
  connectivityDetail: string | undefined;
}

/** Resultado devolvido por um {@link ConnectivityChecker}. */
export interface ConnectivityCheckResult {
  /** `true` se a instância respondeu com sucesso dentro do timeout. */
  ok: boolean;
  /** Detalhe legível da falha (status HTTP ou motivo da exceção). Ausente quando `ok`. */
  detail?: string;
}

/**
 * Executa a checagem de conectividade — injetável para testes (o default de
 * produção usa `fetch` global com timeout via `AbortController`).
 */
export type ConnectivityChecker = (
  instanceUrl: string,
  timeoutMs: number,
) => Promise<ConnectivityCheckResult>;

/** Dependências injetáveis do hook — todas opcionais, com defaults de produção. */
export interface UseDoctorStatusOptions {
  /** Ambiente consultado para `REDMINE_URL`; default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Versão do Node exibida; default `process.version`. */
  nodeVersion?: string;
  /** Resolve a fonte da credencial; default `describeCredentialSource` do core. */
  describeCredentialSource?: typeof describeCredentialSource;
  /** Executa a checagem de conectividade; default via `fetch` global. */
  checkConnectivity?: ConnectivityChecker;
  /** Timeout (ms) da checagem de conectividade; default {@link DEFAULT_CONNECTIVITY_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Timeout default do teste de conectividade — curto o bastante para não travar a tela. */
export const DEFAULT_CONNECTIVITY_TIMEOUT_MS = 3000;

/**
 * Checagem default de conectividade: GET leve (sem autenticação) à instância,
 * com timeout via `AbortController`. Não autenticado de propósito — o doctor
 * testa alcançabilidade de rede, não valida a credencial (isso já é reportado
 * separadamente por `credentialMethod`), então a api_key nunca participa
 * desta requisição.
 */
const defaultCheckConnectivity: ConnectivityChecker = async (instanceUrl, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(instanceUrl, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, detail: reason };
  } finally {
    clearTimeout(timer);
  }
};

/** Lê `REDMINE_URL` do ambiente, tratando string vazia como ausente. */
function instanceFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.REDMINE_URL;
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Reúne o status do doctor: node/tool/instância (síncronos, disponíveis já no
 * primeiro render) + credencial e conectividade (assíncronos, resolvidos via
 * `useEffect` quando há uma instância configurada).
 *
 * @param options - Dependências injetáveis. Ver {@link UseDoctorStatusOptions}.
 * @returns O {@link DoctorStatus} atual — `credentialMethod`/`connectivity`
 *   começam em `'checking'`/`'skipped'` e são atualizados quando a checagem
 *   assíncrona resolve (ou `'skipped'` direto, se não há instância configurada).
 *
 * @example
 * const status = useDoctorStatus(); // deps de produção (process.env, fetch real)
 */
export function useDoctorStatus(options: UseDoctorStatusOptions = {}): DoctorStatus {
  const env = options.env ?? process.env;
  const nodeVersion = options.nodeVersion ?? process.version;
  const resolveSource = options.describeCredentialSource ?? describeCredentialSource;
  const checkConnectivity = options.checkConnectivity ?? defaultCheckConnectivity;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECTIVITY_TIMEOUT_MS;
  const instanceUrl = instanceFromEnv(env);

  const [credentialMethod, setCredentialMethod] = useState<CredentialSourceKind | 'checking'>(
    instanceUrl === undefined ? 'none' : 'checking',
  );
  const [connectivity, setConnectivity] = useState<ConnectivityStatus>(
    instanceUrl === undefined ? 'skipped' : 'checking',
  );
  const [connectivityDetail, setConnectivityDetail] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (instanceUrl === undefined) {
      setCredentialMethod('none');
      setConnectivity('skipped');
      setConnectivityDetail(undefined);
      return;
    }

    let cancelled = false;
    setCredentialMethod('checking');
    setConnectivity('checking');
    setConnectivityDetail(undefined);

    resolveSource(instanceUrl, { env }).then(
      (source) => {
        if (!cancelled) setCredentialMethod(source);
      },
      () => {
        if (!cancelled) setCredentialMethod('none');
      },
    );

    checkConnectivity(instanceUrl, timeoutMs).then(
      (result) => {
        if (cancelled) return;
        setConnectivity(result.ok ? 'ok' : 'error');
        setConnectivityDetail(result.detail);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setConnectivity('error');
        setConnectivityDetail(cause instanceof Error ? cause.message : String(cause));
      },
    );

    return () => {
      cancelled = true;
    };
    // Reason: `env`/`resolveSource`/`checkConnectivity` são estáveis entre
    // renders quando as deps de produção são usadas (defaults do módulo, ou
    // `process.env`) — o efeito só precisa refazer a consulta quando a
    // instância configurada muda.
  }, [instanceUrl]);

  return {
    nodeVersion,
    toolName: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    instanceUrl,
    credentialMethod,
    connectivity,
    connectivityDetail,
  };
}
