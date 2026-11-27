/**
 * Helpers do seed (#254): `api` e a idempotência por marca (`ensureByMarker`).
 * Sem rede: o `fetch` global é trocado por um dublê que responde por URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ensureByMarker, getIssue, putIssue, uploadBytes } from '../../scripts/lib/seed-helpers.mjs';

const BASE = 'http://localhost:3080';

/** Respostas do dublê por caminho; o que não estiver aqui vira 404. */
let responses: Record<string, { status: number; body: string }>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  responses = {};
  fetchMock = vi.fn(async (url: string) => {
    const response = responses[url.slice(BASE.length)] ?? { status: 404, body: '' };
    return new Response(response.body || null, { status: response.status }); // 204 não aceita corpo
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ensureByMarker', () => {
  it('marca presente: não chama create e devolve a entidade existente', async () => {
    responses['/projects.json?limit=100&offset=0'] = {
      status: 200,
      body: JSON.stringify({ projects: [{ id: 3, identifier: 'rc-fixtures' }] }),
    };
    const create = vi.fn();

    const result = await ensureByMarker('project', 'rc-fixtures', create);

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 3, identifier: 'rc-fixtures' });
  });

  it('marca ausente: chama create uma vez e devolve o que ele criou', async () => {
    responses['/users.json?status=*&limit=100&offset=0'] = {
      status: 200,
      body: JSON.stringify({ users: [{ id: 1, login: 'admin' }] }),
    };
    const create = vi.fn(async () => ({ id: 9, login: 'seed-ana' }));

    const result = await ensureByMarker('user', 'seed-ana', create);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 9, login: 'seed-ana' });
  });

  it('não confunde prefixo de outra entidade com a marca', async () => {
    responses['/projects.json?limit=100&offset=0'] = {
      status: 200,
      body: JSON.stringify({ projects: [{ id: 4, identifier: 'rc-fixtures-2' }] }),
    };
    const create = vi.fn(async () => ({ id: 5 }));

    await ensureByMarker('project', 'rc-fixtures', create);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('journal: acha a marca no início das notes da issue', async () => {
    responses['/issues/7.json?include=journals'] = {
      status: 200,
      body: JSON.stringify({ issue: { id: 7, journals: [{ id: 1, notes: '' }, { id: 2, notes: '[seed] comentário' }] } }),
    };
    const create = vi.fn();

    const result = await ensureByMarker('journal', '[seed]', create, 7);

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 2, notes: '[seed] comentário' });
  });

  it('versão e categoria: procuram dentro do projeto pelo nome', async () => {
    responses['/projects/rc-fixtures/versions.json'] = {
      status: 200,
      body: JSON.stringify({ versions: [{ id: 1, name: '[seed] v1.0' }] }),
    };
    responses['/projects/rc-fixtures/issue_categories.json'] = {
      status: 200,
      body: JSON.stringify({ issue_categories: [] }),
    };
    const create = vi.fn(async () => ({ id: 2 }));

    await ensureByMarker('version', '[seed] v1.0', create, 'rc-fixtures');
    await ensureByMarker('category', '[seed] Backend', create, 'rc-fixtures');

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('GET da listagem falha: lança e não cria', async () => {
    responses['/users.json?status=*&limit=100&offset=0'] = { status: 500, body: 'boom' };
    const create = vi.fn();

    await expect(ensureByMarker('user', 'seed-ana', create)).rejects.toThrow(/status 500/);
    expect(create).not.toHaveBeenCalled();
  });

  it('paginação: acha a marca na 2ª página de projetos', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 10, identifier: `outro-${i}` }));
    responses['/projects.json?limit=100&offset=0'] = {
      status: 200,
      body: JSON.stringify({ projects: page1, total_count: 101, offset: 0, limit: 100 }),
    };
    responses['/projects.json?limit=100&offset=100'] = {
      status: 200,
      body: JSON.stringify({ projects: [{ id: 3, identifier: 'rc-fixtures' }], total_count: 101, offset: 100, limit: 100 }),
    };
    const create = vi.fn();

    const result = await ensureByMarker('project', 'rc-fixtures', create);

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 3, identifier: 'rc-fixtures' });
  });

  it('journal: marca seguida de quebra de linha também casa; notes null não quebra', async () => {
    responses['/issues/7.json?include=journals'] = {
      status: 200,
      body: JSON.stringify({ issue: { id: 7, journals: [{ id: 1, notes: null }, { id: 2, notes: '[seed]\nlinha 2' }] } }),
    };
    const create = vi.fn();

    const result = await ensureByMarker('journal', '[seed]', create, 7);

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 2 });
  });

  it('tipo com dono sem parent: lança antes de ir à rede', async () => {
    await expect(ensureByMarker('version', 'v1', vi.fn())).rejects.toThrow(/parent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marca vazia: lança antes de ir à rede', async () => {
    await expect(ensureByMarker('journal', '', vi.fn(), 7)).rejects.toThrow(/marca/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resposta 200 sem a lista esperada: lança em vez de criar duplicado', async () => {
    responses['/projects/rc-fixtures/versions.json'] = { status: 200, body: JSON.stringify({ erro: 'x' }) };
    const create = vi.fn();

    await expect(ensureByMarker('version', 'v1', create, 'rc-fixtures')).rejects.toThrow(/versions/);
    expect(create).not.toHaveBeenCalled();
  });

  it('mensagem de erro corta o corpo da resposta', async () => {
    responses['/users.json?status=*&limit=100&offset=0'] = { status: 500, body: 'x'.repeat(5000) };

    const err = await ensureByMarker('user', 'seed-ana', vi.fn()).catch((e: Error) => e);

    expect((err as Error).message.length).toBeLessThan(500);
  });

  it('tipo desconhecido: lança', async () => {
    await expect(ensureByMarker('planeta', 'x', vi.fn())).rejects.toThrow(/planeta/);
  });
});

describe('api', () => {
  it('manda Basic auth e corpo JSON, e devolve o JSON parseado', async () => {
    responses['/issues.json'] = { status: 201, body: JSON.stringify({ issue: { id: 1 } }) };

    const result = await api('POST', '/issues.json', { issue: { subject: 's' } });

    expect(result).toMatchObject({ status: 201, ok: true, json: { issue: { id: 1 } } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(init.body).toBe('{"issue":{"subject":"s"}}');
  });

  it('corpo que não é JSON vira json null, com o texto preservado', async () => {
    responses['/x'] = { status: 422, body: 'não é json' };

    const result = await api('GET', '/x');

    expect(result).toEqual({ status: 422, ok: false, json: null, text: 'não é json' });
  });
});

describe('putIssue', () => {
  it('aceita 204 e manda os campos dentro de issue', async () => {
    responses['/issues/3.json'] = { status: 204, body: '' };

    await putIssue(3, { notes: 'oi' }, 'journal');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"issue":{"notes":"oi"}}');
  });

  it('status de erro: lança dizendo o que falhou', async () => {
    responses['/issues/3.json'] = { status: 422, body: 'inválido' };

    await expect(putIssue(3, { parent_issue_id: 9 }, 'parent')).rejects.toThrow(/PUT parent issue 3 falhou: status 422/);
  });
});

describe('getIssue', () => {
  it('pede os includes e devolve o objeto issue', async () => {
    responses['/issues/5.json?include=journals,attachments'] = { status: 200, body: JSON.stringify({ issue: { id: 5 } }) };

    expect(await getIssue(5, 'journals,attachments')).toEqual({ id: 5 });
  });

  it('status diferente de 200: lança', async () => {
    await expect(getIssue(5)).rejects.toThrow(/GET issue 5 falhou: status 404/);
  });
});

describe('uploadBytes', () => {
  it('201 com token: devolve o token', async () => {
    responses['/uploads.json'] = { status: 201, body: JSON.stringify({ upload: { token: '7.abc' } }) };

    expect(await uploadBytes(Buffer.from('oi'))).toBe('7.abc');
  });

  it('status diferente de 201: lança', async () => {
    responses['/uploads.json'] = { status: 422, body: 'grande demais' };

    await expect(uploadBytes(Buffer.from('oi'))).rejects.toThrow(/status 422/);
  });

  it('201 sem token ou com corpo inválido: lança com mensagem própria', async () => {
    responses['/uploads.json'] = { status: 201, body: '{}' };
    await expect(uploadBytes(Buffer.from('oi'))).rejects.toThrow(/não retornou token/);

    responses['/uploads.json'] = { status: 201, body: 'não é json' };
    await expect(uploadBytes(Buffer.from('oi'))).rejects.toThrow(/não retornou token/);
  });
});
