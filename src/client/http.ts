/**
 * Client HTTP base do Redmine — autenticação por api_key e TLS obrigatório (ADR-003).
 *
 * Escopo M1: apenas `GET`. Sem retry, paginação ou timeout sofisticado
 * (issues #9/#10). Usa `fetch` nativo do Node ≥ 20, sem dependência nova.
 */

import { httpErrorFor, type RedmineHttpError } from './errors.js';

/** Logger mínimo — só o nível de aviso é necessário neste módulo. */
export interface Logger {
  warn(message: string): void;
}

/** Parâmetros de query aceitos por uma requisição GET. */
export type QueryParams = Record<string, string | number | boolean>;

/** Opções de construção do client HTTP. */
export interface HttpClientOptions {
  /** URL base da instância Redmine (ex.: `https://redmine.example`). */
  baseUrl: string;
  /** api_key do usuário — enviada por header (ou query, ver `keyInQuery`). */
  apiKey: string;
  /**
   * Envia a api_key como `?key=` em vez do header `X-Redmine-API-Key`.
   * Fallback explícito para proxies que removem headers (ADR-003). Default: `false`.
   */
  keyInQuery?: boolean;
  /**
   * Permite `http://` (sem TLS). Opt-in explícito e ruidoso: emite um `warn`.
   * Default: `false` (só `https://` é aceito).
   */
  insecure?: boolean;
  /** Logger para avisos; default no-op (não introduz lib de logging no M1). */
  logger?: Logger;
}

/** Client HTTP mínimo do M1 — expõe apenas `get`. */
export interface HttpClient {
  /**
   * Executa `GET {baseUrl}{path}` com autenticação e retorna o JSON já parseado.
   *
   * @param path - Caminho absoluto na API (ex.: `/issues/100.json`).
   * @param params - Parâmetros de query opcionais.
   * @returns Corpo da resposta parseado como JSON.
   * @throws {RedmineAuthError} Em 401.
   * @throws {RedmineForbiddenError} Em 403.
   * @throws {RedmineNotFoundError} Em 404.
   * @throws {RedmineHttpError} Em qualquer outro status ≥ 400.
   */
  get(path: string, params?: QueryParams): Promise<unknown>;
}

/** Header do Redmine para autenticação por api_key (ADR-003). */
const API_KEY_HEADER = 'X-Redmine-API-Key';
/** Placeholder usado ao redigir segredos em mensagens/logs. */
const REDACTED = '[REDACTED]';

const noopLogger: Logger = { warn: () => undefined };

/**
 * Remove qualquer ocorrência da api_key (em texto ou em `?key=`) de uma string.
 * Garante que nenhum segredo vaze para mensagens de erro ou logs (ADR-003).
 *
 * @param text - Texto potencialmente contendo o segredo.
 * @param apiKey - Segredo a redigir.
 * @returns Texto com o segredo substituído por `[REDACTED]`.
 */
export function redactSecret(text: string, apiKey: string): string {
  let out = text;
  if (apiKey.length > 0) {
    out = out.split(apiKey).join(REDACTED);
  }
  // Redige também o valor de `key=` na querystring, caso a URL tenha sido montada
  // com um segredo diferente do informado (defesa em profundidade).
  return out.replace(/([?&]key=)[^&#\s]+/gi, `$1${REDACTED}`);
}

/**
 * Valida o esquema da URL base conforme a política de TLS do ADR-003.
 *
 * @param baseUrl - URL base a validar.
 * @param insecure - Se `true`, permite `http://` com aviso ruidoso.
 * @param logger - Logger para o aviso de conexão insegura.
 * @throws {Error} Se `http://` for usado sem `insecure`, ou se o esquema for inválido.
 */
function assertTlsPolicy(baseUrl: string, insecure: boolean, logger: Logger): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`baseUrl inválida: "${baseUrl}". Informe uma URL absoluta (ex.: https://redmine.example).`);
  }

  if (parsed.protocol === 'https:') {
    return;
  }
  if (parsed.protocol === 'http:') {
    if (!insecure) {
      throw new Error(
        `Conexão http:// recusada para "${parsed.origin}": TLS é obrigatório. ` +
          `Use https:// ou, para uma CA interna, configure NODE_EXTRA_CA_CERTS. ` +
          `Para ignorar a verificação (NÃO recomendado), passe insecure: true.`,
      );
    }
    logger.warn(
      `AVISO DE SEGURANÇA: conexão insegura (http://) habilitada para "${parsed.origin}". ` +
        `O tráfego, incluindo a api_key, NÃO é criptografado.`,
    );
    return;
  }
  throw new Error(`Esquema não suportado em baseUrl: "${parsed.protocol}". Use https://.`);
}

/**
 * Cria um client HTTP autenticado para uma instância Redmine.
 *
 * @param options - Configuração do client (ver {@link HttpClientOptions}).
 * @returns Um {@link HttpClient} com o método `get`.
 * @throws {Error} Se `apiKey` for vazia ou a política de TLS for violada.
 * @example
 * const client = createHttpClient({ baseUrl: 'https://redmine.example', apiKey: KEY });
 * const issue = await client.get('/issues/100.json');
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { baseUrl, apiKey, keyInQuery = false, insecure = false } = options;
  const logger = options.logger ?? noopLogger;

  if (apiKey.length === 0) {
    throw new Error('apiKey é obrigatória e não pode ser vazia.');
  }
  assertTlsPolicy(baseUrl, insecure, logger);

  const redact = (text: string): string => redactSecret(text, apiKey);

  /**
   * Monta a URL final da requisição, aplicando params e (se configurado) `?key=`.
   */
  const buildUrl = (path: string, params?: QueryParams): URL => {
    const url = new URL(path, baseUrl);
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        url.searchParams.set(name, String(value));
      }
    }
    if (keyInQuery) {
      url.searchParams.set('key', apiKey);
    }
    return url;
  };

  return {
    async get(path: string, params?: QueryParams): Promise<unknown> {
      const url = buildUrl(path, params);
      // URL segura para log/erro: a api_key nunca aparece em texto.
      const safeUrl = redact(url.toString());

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (!keyInQuery) {
        headers[API_KEY_HEADER] = apiKey;
      }

      let response: Response;
      try {
        response = await fetch(url, { method: 'GET', headers });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Falha de rede ao acessar ${safeUrl}: ${redact(reason)}`);
      }

      if (!response.ok) {
        const message = `GET ${safeUrl} respondeu ${response.status} ${redact(response.statusText)}`;
        const error: RedmineHttpError = httpErrorFor(message, response.status, safeUrl);
        throw error;
      }

      try {
        return (await response.json()) as unknown;
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Resposta de ${safeUrl} não é JSON válido: ${redact(reason)}`);
      }
    },
  };
}
