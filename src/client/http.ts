/**
 * Client HTTP base do Redmine — autenticação por api_key e TLS obrigatório (ADR-003).
 *
 * `GET` (JSON) com retry/backoff exponencial (issue #10) para 429/5xx/erros de
 * rede, mais `getBinary` (download bruto de anexos, issue #48) que herda a mesma
 * auth/TLS/retry sem parse JSON. Sem paginação ou timeout sofisticado (issue #9).
 * Usa `fetch` nativo do Node ≥ 20, sem dependência nova.
 */

import { httpErrorFor, type RedmineHttpError } from './errors.js';

/** Logger mínimo — só o nível de aviso é necessário neste módulo. */
export interface Logger {
  warn(message: string): void;
}

/** Parâmetros de query aceitos por uma requisição GET. */
export type QueryParams = Record<string, string | number | boolean>;

/**
 * Ajustes do retry com backoff exponencial (issue #10). Só se aplica a falhas
 * transientes: 429, 5xx e erros de rede. Erros 4xx (exceto 429) nunca retentam.
 */
export interface RetryOptions {
  /** Número máximo de tentativas (inclui a primeira). Default: 3; mínimo 1. */
  maxAttempts?: number;
  /** Atraso base em ms para o backoff exponencial (`base * 2^tentativa`). Default: 250. */
  baseDelayMs?: number;
}

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
  /** Política de retry para falhas transientes. Ver {@link RetryOptions}. */
  retry?: RetryOptions;
}

/** Client HTTP do core — expõe `get` (JSON) e `getBinary` (download bruto). */
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

  /**
   * Executa `GET {baseUrl}{path}` autenticado e retorna o corpo BRUTO como um
   * stream de bytes, SEM parse JSON — usado para baixar anexos (M3-06, ADR-004).
   *
   * Reusa a mesma autenticação, política de TLS e retry/backoff transiente de
   * {@link get}; os erros são os mesmos tipos ({@link RedmineHttpError} e
   * subclasses). O chamador é responsável por consumir/encerrar o stream.
   *
   * @param path - Caminho absoluto na API (ex.: `/attachments/download/7/foo.png`).
   * @param params - Parâmetros de query opcionais.
   * @returns Stream de leitura dos bytes da resposta.
   * @throws {RedmineAuthError} Em 401.
   * @throws {RedmineForbiddenError} Em 403.
   * @throws {RedmineNotFoundError} Em 404.
   * @throws {RedmineHttpError} Em qualquer outro status ≥ 400.
   * @throws {Error} Se a resposta vier sem corpo.
   */
  getBinary(path: string, params?: QueryParams): Promise<ReadableStream<Uint8Array>>;
}

/** Header do Redmine para autenticação por api_key (ADR-003). */
const API_KEY_HEADER = 'X-Redmine-API-Key';
/** Placeholder usado ao redigir segredos em mensagens/logs. */
const REDACTED = '[REDACTED]';

const noopLogger: Logger = { warn: () => undefined };

/** Tentativas default quando `retry.maxAttempts` não é informado. */
const DEFAULT_MAX_ATTEMPTS = 3;
/** Atraso base (ms) default do backoff quando `retry.baseDelayMs` não é informado. */
const DEFAULT_BASE_DELAY_MS = 250;

/** Aguarda `ms` milissegundos; isolado num `setTimeout` para ser mockável com fake timers. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Indica se um status HTTP é transiente e merece nova tentativa.
 * Retentam: 429 (throttling) e 5xx (falha do servidor). Demais 4xx são definitivos.
 *
 * @param status - Código HTTP da resposta.
 * @returns `true` se vale a pena retentar.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Calcula o atraso do backoff exponencial com jitter para a tentativa `attempt` (0-based).
 * `baseDelay * 2^attempt` mais um jitter aleatório pequeno para evitar thundering herd.
 *
 * @param attempt - Índice da tentativa já realizada (0 na primeira falha).
 * @param baseDelayMs - Atraso base em milissegundos.
 * @returns Atraso, em milissegundos, antes da próxima tentativa.
 */
function backoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * baseDelayMs;
  return exponential + jitter;
}

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
    // URLs são percent-encoded: uma key com caracteres URL-unsafe não casaria
    // com a forma bruta acima.
    const encoded = encodeURIComponent(apiKey);
    if (encoded !== apiKey) {
      out = out.split(encoded).join(REDACTED);
    }
  }
  // Redige também o valor de `key=` na querystring, caso a URL tenha sido montada
  // com um segredo diferente do informado (defesa em profundidade).
  return out.replace(/([?&]key=)[^&#\s]+/gi, `$1${REDACTED}`);
}

/**
 * Valida o esquema da URL base conforme a política de TLS do ADR-003.
 *
 * Exportada para ser reutilizada por outros fluxos de autenticação (ex.: login
 * por senha em `config/login.ts`), evitando duplicar a política de TLS.
 *
 * @param baseUrl - URL base a validar.
 * @param insecure - Se `true`, permite `http://` com aviso ruidoso.
 * @param logger - Logger para o aviso de conexão insegura.
 * @throws {Error} Se `http://` for usado sem `insecure`, ou se o esquema for inválido.
 */
export function validateBaseUrl(baseUrl: string, insecure: boolean, logger: Logger): void {
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
  const maxAttempts = Math.max(1, options.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = options.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  if (apiKey.length === 0) {
    throw new Error('apiKey é obrigatória e não pode ser vazia.');
  }
  validateBaseUrl(baseUrl, insecure, logger);

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

  /**
   * Executa a requisição `GET` com autenticação e retry transiente, devolvendo a
   * `Response` já validada (status < 400) mais a URL redigida para mensagens de
   * erro. Compartilhado por {@link HttpClient.get} (JSON) e
   * {@link HttpClient.getBinary} (bytes), para que ambos herdem a MESMA política
   * de auth/TLS/retry e os mesmos erros tipados (issue #10, #48).
   *
   * @param path - Caminho absoluto na API.
   * @param params - Parâmetros de query opcionais.
   * @param accept - Valor do header Accept (JSON, ou coringa para binário).
   * @returns A resposta bem-sucedida e a URL já redigida (sem a api_key).
   */
  const requestWithRetry = async (
    path: string,
    params: QueryParams | undefined,
    accept: string,
  ): Promise<{ response: Response; safeUrl: string }> => {
    const url = buildUrl(path, params);
    // URL segura para log/erro: a api_key nunca aparece em texto.
    const safeUrl = redact(url.toString());

    const headers: Record<string, string> = { Accept: accept };
    if (!keyInQuery) {
      headers[API_KEY_HEADER] = apiKey;
    }

    // Retry com backoff exponencial: só falhas transientes (429/5xx/rede) retentam.
    // `attempt` é 0-based; a última tentativa (attempt === maxAttempts - 1) sempre
    // propaga o erro tipado original, sem embrulhar (issue #10).
    for (let attempt = 0; ; attempt++) {
      const lastAttempt = attempt >= maxAttempts - 1;

      let response: Response;
      try {
        response = await fetch(url, { method: 'GET', headers });
      } catch (cause) {
        if (!lastAttempt) {
          await sleep(backoffDelay(attempt, baseDelayMs));
          continue;
        }
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Falha de rede ao acessar ${safeUrl}: ${redact(reason)}`);
      }

      if (!response.ok) {
        if (isRetryableStatus(response.status) && !lastAttempt) {
          await sleep(backoffDelay(attempt, baseDelayMs));
          continue;
        }
        const message = `GET ${safeUrl} respondeu ${response.status} ${redact(response.statusText)}`;
        const error: RedmineHttpError = httpErrorFor(message, response.status, safeUrl);
        throw error;
      }

      return { response, safeUrl };
    }
  };

  return {
    async get(path: string, params?: QueryParams): Promise<unknown> {
      const { response, safeUrl } = await requestWithRetry(path, params, 'application/json');
      try {
        return (await response.json()) as unknown;
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Resposta de ${safeUrl} não é JSON válido: ${redact(reason)}`);
      }
    },

    async getBinary(path: string, params?: QueryParams): Promise<ReadableStream<Uint8Array>> {
      const { response, safeUrl } = await requestWithRetry(path, params, '*/*');
      // Uma resposta 2xx sem corpo (ex.: 204) não tem o que baixar.
      if (response.body === null) {
        throw new Error(`Resposta binária de ${safeUrl} veio sem corpo.`);
      }
      return response.body;
    },
  };
}
