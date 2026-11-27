/**
 * Corpo gravado pelo record-fixtures.mjs (#260): redação de segredos e do host
 * (ADR-003) e a montagem do corpo por tipo, que falha nomeando URL, caso e quem
 * chamou em vez de estourar sem contexto. Sem rede.
 */
import { describe, expect, it } from 'vitest';
import { recordedBody, redact } from '../../scripts/lib/record-body.mjs';

const BASE = 'http://localhost:3084';
const json = { case: 'custom fields sem admin', as: 'nonAdmin', kind: 'json' } as const;
const binary = { case: 'download do anexo', as: 'admin', kind: 'binary' } as const;
const url = '/custom_fields.json';

describe('redact', () => {
  it('redige campos de segredo em qualquer nível e preserva o resto', () => {
    const user = { id: 5, login: 'seed-ana', api_key: 'a'.repeat(40), passwd_changed_on: '2026-11-27' };
    const value = { user, list: [{ token: 't', name: 'x' }], Authorization: 'Basic y', secret_word: 's' };

    expect(redact(value, BASE)).toEqual({
      user: { id: 5, login: 'seed-ana', api_key: '[REDACTED]', passwd_changed_on: '[REDACTED]' },
      list: [{ token: '[REDACTED]', name: 'x' }],
      Authorization: '[REDACTED]',
      secret_word: '[REDACTED]',
    });
  });

  it('não redige campo que só contém a palavra no meio (tokenizer, apikeyring)', () => {
    expect(redact({ tokenizer: 1, apikeyring: 2 }, BASE)).toEqual({ tokenizer: 1, apikeyring: 2 });
  });

  it('reescreve a URL base real para o placeholder canônico em qualquer string', () => {
    const value = { content_url: `${BASE}/attachments/download/3/a.txt`, n: 1, ok: true, none: null };

    expect(redact(value, BASE)).toEqual({
      content_url: 'https://redmine.example/attachments/download/3/a.txt',
      n: 1,
      ok: true,
      none: null,
    });
  });
});

describe('recordedBody', () => {
  it('JSON: corpo parseado e redigido', () => {
    const got = { text: JSON.stringify({ user: { api_key: 'k' } }) };

    expect(recordedBody(json, url, got, BASE)).toEqual({ bodyKind: 'json', body: { user: { api_key: '[REDACTED]' } } });
  });

  it('JSON: corpo vazio (403/404 do Redmine) vira null', () => {
    expect(recordedBody(json, url, { text: '' }, BASE)).toEqual({ bodyKind: 'json', body: null });
  });

  it('JSON: corpo que não é JSON falha com URL, caso e quem chamou, sem o corpo', () => {
    const got = { text: '<html>proxy error</html>' };

    expect(() => recordedBody(json, url, got, BASE)).toThrow(
      'GET /custom_fields.json (custom fields sem admin, como nonAdmin): corpo não é JSON',
    );
    expect(() => recordedBody(json, url, got, BASE)).not.toThrow(/proxy error/);
  });

  it('binário: bytes em base64, sem passar pelo JSON', () => {
    const got = { bytes: Buffer.from('olá') };

    expect(recordedBody(binary, '/a.txt', got, BASE)).toEqual({ bodyKind: 'base64', body: 'b2zDoQ==' });
  });

  it('binário sem bytes falha em vez de gravar a interação sem body', () => {
    expect(() => recordedBody(binary, '/a.txt', {}, BASE)).toThrow(
      'GET /a.txt (download do anexo, como admin): resposta binária sem bytes',
    );
  });
});
