/**
 * Login por senha (Basic auth) para descobrir a api_key do usuário (M1-07).
 *
 * Fluxo: `GET {baseUrl}/users/current.json` com `Authorization: Basic
 * base64(user:pass)`. A senha nunca é logada nem persistida; qualquer texto
 * que possa vazar (mensagens de rede/parse) é redigido antes de compor um erro.
 *
 * A política de TLS (https obrigatório; `insecure` apenas com aviso ruidoso) é
 * reutilizada de `client/http.ts` via {@link validateBaseUrl} — não duplicada.
 * O fallback de 2FA (copiar a api_key em `/my/account`) segue o ADR-003.
 */

import { Buffer } from 'node:buffer';

import { RedmineAuthError, redactSecret, validateBaseUrl, type Logger } from '../client/index.js';

/** Opções do login por senha. */
export interface LoginOptions {
  /** URL base da instância Redmine (ex.: `https://redmine.example`). */
  baseUrl: string;
  /** Login/identificador do usuário no Redmine. */
  username: string;
  /** Senha em texto puro — usada só para o header Basic, nunca logada. */
  password: string;
  /** Permite `http://` (sem TLS) com aviso ruidoso. Default: `false`. */
  insecure?: boolean;
  /** Logger para o aviso de conexão insegura; default no-op. */
  logger?: Logger;
}

/** Resultado do login: api_key descoberta e identidade mínima do usuário. */
export interface LoginResult {
  /** api_key do usuário, extraída de `/users/current.json`. */
  apiKey: string;
  /** Identidade mínima do usuário autenticado. */
  user: {
    /** Id numérico do usuário no Redmine. */
    id: number;
    /** Login do usuário. */
    login: string;
    /** Nome de exibição (`firstname lastname`, ou `login` se ausentes). */
    name: string;
  };
}

const noopLogger: Logger = { warn: () => undefined };

/**
 * Erro de login por senha que não se enquadra num status HTTP tipado do client
 * (entrada inválida, REST desabilitada, corpo inesperado, falha de rede/parse).
 * Sempre construído com a mensagem já redigida — nunca carrega a senha.
 */
export class RedmineLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Remove barras finais da baseUrl preservando o subpath. */
function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** Estreita `unknown` para um objeto indexável, ou `undefined` se não for. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Retorna a string se o campo for uma string não vazia, senão `undefined`. */
function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Autentica por senha e descobre a api_key do usuário.
 *
 * @param options - Ver {@link LoginOptions}.
 * @returns {@link LoginResult} com a api_key e a identidade do usuário.
 * @throws {RedmineLoginError} Entrada inválida, corpo sem usuário/api_key,
 *   REST desabilitada, falha de rede ou JSON inválido (senha sempre redigida).
 * @throws {RedmineAuthError} Em 401 — com instrução de fallback 2FA (ADR-003).
 * @throws {Error} Se a política de TLS for violada (via `validateBaseUrl`).
 * @example
 * const { apiKey, user } = await loginWithPassword({
 *   baseUrl: 'https://redmine.example',
 *   username: 'alice',
 *   password: '****',
 * });
 */
export async function loginWithPassword(options: LoginOptions): Promise<LoginResult> {
  const { baseUrl, username, password, insecure = false } = options;
  const logger = options.logger ?? noopLogger;

  if (username.length === 0) {
    throw new RedmineLoginError('username é obrigatório e não pode ser vazio.');
  }
  if (password.length === 0) {
    throw new RedmineLoginError('password é obrigatório e não pode ser vazio.');
  }

  // Reusa a política de TLS do client (ADR-003) — pode lançar antes de qualquer fetch.
  validateBaseUrl(baseUrl, insecure, logger);

  // Redige a senha de qualquer texto de baixo nível antes de compor uma mensagem.
  const redact = (text: string): string => redactSecret(text, password);

  const origin = trimTrailingSlash(baseUrl);
  const url = `${origin}/users/current.json`;
  const accountUrl = `${origin}/my/account`;
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Basic ${token}`,
  };

  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new RedmineLoginError(redact(`Falha de rede ao acessar ${url}: ${reason}`));
  }

  if (response.status === 401) {
    throw new RedmineAuthError(
      `Autenticação falhou (401): usuário ou senha inválidos. ` +
        `Se a conta usa autenticação de dois fatores (2FA), o login por senha não funciona — ` +
        `copie sua api_key em ${accountUrl} e informe-a diretamente.`,
      401,
      url,
    );
  }

  if (!response.ok) {
    throw new RedmineLoginError(
      redact(`GET ${url} respondeu ${response.status} ${response.statusText}.`),
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new RedmineLoginError(redact(`Resposta de ${url} não é JSON válido: ${reason}`));
  }

  const rawUser = asRecord(asRecord(body)?.user);
  const id = rawUser?.id;
  const login = rawUser ? stringField(rawUser, 'login') : undefined;
  if (rawUser === undefined || typeof id !== 'number' || login === undefined) {
    throw new RedmineLoginError(
      `Resposta de ${url} não contém um usuário válido (campos id/login ausentes).`,
    );
  }

  const apiKey = stringField(rawUser, 'api_key');
  if (apiKey === undefined) {
    throw new RedmineLoginError(
      `A resposta não contém api_key: a REST API pode estar desabilitada ou a conta não ter permissão. ` +
        `Habilite a REST API e copie sua api_key em ${accountUrl}.`,
    );
  }

  const firstname = stringField(rawUser, 'firstname');
  const lastname = stringField(rawUser, 'lastname');
  const name = [firstname, lastname].filter((part) => part !== undefined).join(' ') || login;

  return { apiKey, user: { id, login, name } };
}

/** Opções da validação de uma api_key colada diretamente (fallback de 2FA). */
export interface ValidateApiKeyOptions {
  /** URL base da instância Redmine (ex.: `https://redmine.example`). */
  baseUrl: string;
  /** api_key colada pelo usuário — usada só para o header, nunca logada. */
  apiKey: string;
  /** Permite `http://` (sem TLS) com aviso ruidoso. Default: `false`. */
  insecure?: boolean;
  /** Logger para o aviso de conexão insegura; default no-op. */
  logger?: Logger;
}

/**
 * Valida uma api_key colada diretamente pelo usuário (fallback de 2FA do
 * ADR-003, quando `loginWithPassword` falha com 401) contra `GET
 * {baseUrl}/users/current.json`, autenticando com o header
 * `X-Redmine-API-Key` em vez de Basic auth. A key nunca é logada; qualquer
 * texto que possa vazar é redigido antes de compor um erro — mesma política
 * de {@link loginWithPassword}.
 *
 * @param options - Ver {@link ValidateApiKeyOptions}.
 * @returns {@link LoginResult} com a própria api_key (ecoada de volta, para
 *   simetria com {@link loginWithPassword}) e a identidade do usuário.
 * @throws {RedmineLoginError} Entrada inválida, corpo sem usuário, REST
 *   desabilitada, falha de rede ou JSON inválido (key sempre redigida).
 * @throws {RedmineAuthError} Em 401 — api_key inválida ou expirada.
 * @throws {Error} Se a política de TLS for violada (via `validateBaseUrl`).
 * @example
 * const { apiKey, user } = await validateApiKey({
 *   baseUrl: 'https://redmine.example',
 *   apiKey: pastedKey,
 * });
 */
export async function validateApiKey(options: ValidateApiKeyOptions): Promise<LoginResult> {
  const { baseUrl, apiKey, insecure = false } = options;
  const logger = options.logger ?? noopLogger;

  if (apiKey.length === 0) {
    throw new RedmineLoginError('api_key é obrigatória e não pode ser vazia.');
  }

  // Reusa a política de TLS do client (ADR-003) — pode lançar antes de qualquer fetch.
  validateBaseUrl(baseUrl, insecure, logger);

  // Redige a key de qualquer texto de baixo nível antes de compor uma mensagem.
  const redact = (text: string): string => redactSecret(text, apiKey);

  const origin = trimTrailingSlash(baseUrl);
  const url = `${origin}/users/current.json`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Redmine-API-Key': apiKey,
  };

  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new RedmineLoginError(redact(`Falha de rede ao acessar ${url}: ${reason}`));
  }

  if (response.status === 401) {
    throw new RedmineAuthError(
      `Autenticação falhou (401): api_key inválida ou expirada. Copie a api_key atual em ${accountUrlFor(origin)}.`,
      401,
      url,
    );
  }

  if (!response.ok) {
    throw new RedmineLoginError(
      redact(`GET ${url} respondeu ${response.status} ${response.statusText}.`),
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new RedmineLoginError(redact(`Resposta de ${url} não é JSON válido: ${reason}`));
  }

  const rawUser = asRecord(asRecord(body)?.user);
  const id = rawUser?.id;
  const login = rawUser ? stringField(rawUser, 'login') : undefined;
  if (rawUser === undefined || typeof id !== 'number' || login === undefined) {
    throw new RedmineLoginError(
      `Resposta de ${url} não contém um usuário válido (campos id/login ausentes).`,
    );
  }

  const firstname = stringField(rawUser, 'firstname');
  const lastname = stringField(rawUser, 'lastname');
  const name = [firstname, lastname].filter((part) => part !== undefined).join(' ') || login;

  return { apiKey, user: { id, login, name } };
}

/** Monta a URL de `/my/account` a partir da origem já sem barra final. */
function accountUrlFor(origin: string): string {
  return `${origin}/my/account`;
}
