// @ts-check
//
// record-body.mjs — corpo de cada interação gravada pelo record-fixtures.mjs (#260).
//
// Segredos nunca entram no arquivo (ADR-003): `redact` troca o valor de todo campo
// de segredo por "[REDACTED]" e a URL base real pelo placeholder canônico. O corpo
// é montado pelo tipo da requisição; corpo inválido falha nomeando URL, caso e quem
// chamou, sem copiar o corpo para a mensagem.

/** Placeholder estável que substitui a URL base real nas fixtures versionadas. */
export const CANONICAL_BASE = 'https://redmine.example';
const REDACTED = '[REDACTED]';
/** Nomes de campo cujo VALOR é redigido (palavra inteira entre `_` ou nas pontas). */
const SECRET_KEY = /(^|_)(api_?key|token|password|passwd|authorization|secret)($|_)/i;

/**
 * Redige recursivamente os campos de segredo e reescreve a URL base real.
 * @param {unknown} value
 * @param {string} base URL base real, sem barra final
 * @returns {unknown}
 */
export function redact(value, base) {
  if (typeof value === 'string') {
    return value.split(base).join(CANONICAL_BASE);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, base));
  }
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key in value) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(value[key], base);
    }
    return out;
  }
  return value;
}

/**
 * Corpo gravado: JSON redigido (vazio → null) ou bytes em base64.
 * @param {{ case: string, as: string, kind: 'json' | 'binary' }} request
 * @param {string} url caminho com query, só para a mensagem de erro
 * @param {{ text?: string, bytes?: Buffer }} got
 * @param {string} base URL base real
 * @returns {{ bodyKind: 'json' | 'base64', body: unknown }}
 */
export function recordedBody(request, url, got, base) {
  const where = `GET ${url} (${request.case}, como ${request.as})`;
  if (request.kind === 'binary') {
    if (!got.bytes) {
      throw new Error(`${where}: resposta binária sem bytes`);
    }
    return { bodyKind: 'base64', body: got.bytes.toString('base64') };
  }
  if (!got.text) {
    return { bodyKind: 'json', body: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(got.text);
  } catch {
    throw new Error(`${where}: corpo não é JSON`);
  }
  return { bodyKind: 'json', body: redact(parsed, base) };
}
