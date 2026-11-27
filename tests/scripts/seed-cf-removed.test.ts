/**
 * Journal com detail `cf` de um custom field removido (#203).
 * Sem rede nem docker: o `fetch` global vira um Redmine de mentira e o executor
 * do rails runner é um mock que cria/remove o campo nessa mesma instância.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRemovedCustomField } from '../../scripts/lib/seed-cf-removed.mjs';

const BASE = 'http://localhost:3080';
const SUBJECT = '[seed] CF removido';
const FIELD_NAME = '[seed] CF removido';
const MARKER = '[seed:cf-removido]';
const ISSUES_PATH = `/issues.json?project_id=rc-fixtures&status_id=*&subject=~${encodeURIComponent(SUBJECT)}`;

type Detail = { property: string; name: string; old_value: string | null; new_value: string | null };
type Journal = { id: number; notes: string; details: Detail[] };
type Field = { id: number; name: string };
type Init = { method?: string; body?: string };

let issue: { id: number; subject: string; journals: Journal[] } | null;
let fields: Field[];
let calls: string[];
let runRails: ReturnType<typeof vi.fn>;

/** Simula o Redmine para os caminhos que o módulo usa. */
async function fakeRedmine(url: string, init?: Init) {
  const path = url.slice(BASE.length);
  const method = init?.method ?? 'GET';
  calls.push(`${method} ${path}`);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

  if (method === 'GET' && path === '/custom_fields.json') {
    return json(200, { custom_fields: [{ id: 1, name: 'Severidade' }, ...fields] });
  }
  if (method === 'GET' && path === ISSUES_PATH) {
    const copy = { id: 60, subject: `${SUBJECT} (cópia)` };
    return json(200, { issues: issue ? [copy, issue] : [copy] });
  }
  if (method === 'POST' && path === '/issues.json') {
    issue = { id: 61, subject: body.issue.subject, journals: [] };
    return json(201, { issue });
  }
  if (issue && path.startsWith(`/issues/${issue.id}.json`)) {
    if (method === 'GET') {
      return json(200, { issue });
    }
    // Como o Redmine: custom field desconhecido é ignorado em silêncio.
    const details: Detail[] = [];
    for (const value of body.issue.custom_fields ?? []) {
      if (fields.some((field) => field.id === value.id)) {
        details.push({ property: 'cf', name: String(value.id), old_value: null, new_value: value.value });
      }
    }
    issue.journals.push({ id: issue.journals.length + 1, notes: body.issue.notes ?? '', details });
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 404 });
}

/** Rails runner de mentira: `puts cf.id` cria o campo; `destroy_all` remove. */
async function fakeRails(ruby: string) {
  if (ruby.includes('destroy_all')) {
    fields = fields.filter((field) => field.name !== FIELD_NAME);
    return '';
  }
  if (!fields.some((field) => field.name === FIELD_NAME)) {
    fields.push({ id: 7, name: FIELD_NAME });
  }
  return `${fields.find((field) => field.name === FIELD_NAME)?.id}\n`;
}

function markerJournals() {
  return issue?.journals.filter((journal) => journal.notes.startsWith(`${MARKER} `)) ?? [];
}

beforeEach(() => {
  issue = null;
  fields = [];
  calls = [];
  runRails = vi.fn(fakeRails);
  vi.stubGlobal('fetch', vi.fn(fakeRedmine));
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ensureRemovedCustomField', () => {
  it('cria o CF, grava o valor num journal marcado, remove o CF e o detail sobrevive', async () => {
    await ensureRemovedCustomField('rc-fixtures', runRails);

    expect(issue?.subject).toBe(SUBJECT);
    expect(markerJournals()).toHaveLength(1);
    expect(markerJournals()[0].details).toEqual([
      { property: 'cf', name: '7', old_value: null, new_value: expect.any(String) },
    ]);
    expect(fields).toEqual([]);
    expect(runRails).toHaveBeenCalledTimes(2);
    expect(runRails.mock.calls[0][0]).toContain(FIELD_NAME);
    expect(runRails.mock.calls[1][0]).toContain('destroy_all');
  });

  it('re-execução com CF já removido e journal marcado: no-op, sem docker', async () => {
    await ensureRemovedCustomField('rc-fixtures', runRails);
    runRails.mockClear();
    calls = [];

    await ensureRemovedCustomField('rc-fixtures', runRails);

    expect(runRails).not.toHaveBeenCalled();
    expect(calls.filter((call) => !call.startsWith('GET '))).toEqual([]);
    expect(markerJournals()).toHaveLength(1);
  });

  it('journal marcado mas CF ainda existe (remoção interrompida): só remove', async () => {
    fields = [{ id: 7, name: FIELD_NAME }];
    issue = {
      id: 61,
      subject: SUBJECT,
      journals: [{ id: 1, notes: `${MARKER} x`, details: [{ property: 'cf', name: '7', old_value: null, new_value: 'v' }] }],
    };

    await ensureRemovedCustomField('rc-fixtures', runRails);

    expect(runRails).toHaveBeenCalledTimes(1);
    expect(runRails.mock.calls[0][0]).toContain('destroy_all');
    expect(fields).toEqual([]);
    expect(calls.filter((call) => call.startsWith('PUT '))).toEqual([]);
  });

  it('CF já existe sem journal (PUT interrompido): reusa o id, sem criar de novo', async () => {
    fields = [{ id: 9, name: FIELD_NAME }];

    await ensureRemovedCustomField('rc-fixtures', runRails);

    expect(runRails).toHaveBeenCalledTimes(1);
    expect(runRails.mock.calls[0][0]).toContain('destroy_all');
    expect(markerJournals()[0].details[0].name).toBe('9');
  });

  it('docker indisponível: lança, sem engolir o erro', async () => {
    runRails = vi.fn(async () => {
      throw new Error('spawn docker ENOENT');
    });

    await expect(ensureRemovedCustomField('rc-fixtures', runRails)).rejects.toThrow(/ENOENT/);
  });

  it('rails runner sem id na saída: lança antes do PUT', async () => {
    runRails = vi.fn(async () => 'nada\n');

    await expect(ensureRemovedCustomField('rc-fixtures', runRails)).rejects.toThrow(/id/);
    expect(calls.filter((call) => call.startsWith('PUT '))).toEqual([]);
  });

  it('Redmine ignora o CF no PUT (outra instância): lança e não remove nada', async () => {
    runRails = vi.fn(async (ruby: string) => (ruby.includes('destroy_all') ? '' : '7\n')); // id que o Redmine não conhece

    await expect(ensureRemovedCustomField('rc-fixtures', runRails)).rejects.toThrow(/REDMINE_URL/);
    expect(runRails).toHaveBeenCalledTimes(1);
  });

  it('asserção: lança se o CF do detail ainda aparece em /custom_fields.json', async () => {
    runRails = vi.fn(async (ruby: string) => (ruby.includes('destroy_all') ? '' : fakeRails(ruby))); // remoção sem efeito

    await expect(ensureRemovedCustomField('rc-fixtures', runRails)).rejects.toThrow(/ASSERT CF removido/);
  });

  it('asserção: lança se o journal marcado não tem detail cf', async () => {
    issue = { id: 61, subject: SUBJECT, journals: [{ id: 1, notes: `${MARKER} x`, details: [] }] };

    await expect(ensureRemovedCustomField('rc-fixtures', runRails)).rejects.toThrow(/ASSERT CF removido/);
    expect(runRails).not.toHaveBeenCalled();
  });
});
