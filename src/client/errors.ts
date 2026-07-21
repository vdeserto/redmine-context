/**
 * Erros tipados do client HTTP do Redmine (ADR-003).
 *
 * Union por classe (instanceof + `status`) — o mais simples para o M1.
 * Nenhuma mensagem carrega a api_key: a redação acontece na camada de request
 * (ver `redactSecret` em `./http.ts`) antes de qualquer texto chegar aqui.
 */

/** Erro base de qualquer resposta HTTP ≥ 400 do Redmine. */
export class RedmineHttpError extends Error {
  /** Código HTTP da resposta (ex.: 500). */
  readonly status: number;
  /** URL já redigida (sem api_key) — segura para log. */
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.url = url;
  }
}

/** 401 — api_key ausente/inválida. */
export class RedmineAuthError extends RedmineHttpError {}

/** 403 — autenticado, porém sem permissão para o recurso. */
export class RedmineForbiddenError extends RedmineHttpError {}

/** 404 — recurso inexistente. */
export class RedmineNotFoundError extends RedmineHttpError {}

/**
 * Mapeia um status HTTP para a classe de erro correspondente.
 *
 * @param message - Mensagem já redigida (sem segredos).
 * @param status - Código HTTP da resposta.
 * @param url - URL já redigida (sem api_key).
 * @returns Instância do erro tipado adequado ao status.
 */
export function httpErrorFor(message: string, status: number, url: string): RedmineHttpError {
  switch (status) {
    case 401:
      return new RedmineAuthError(message, status, url);
    case 403:
      return new RedmineForbiddenError(message, status, url);
    case 404:
      return new RedmineNotFoundError(message, status, url);
    default:
      return new RedmineHttpError(message, status, url);
  }
}
