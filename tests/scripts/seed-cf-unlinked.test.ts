/**
 * Journal com detail `cf` de um custom field desvinculado do tracker da issue (#203).
 * Sem rede nem docker: o `fetch` global vira um Redmine de mentira que imita o real
 * (o detail `cf` só sai se o campo existe; `issue.custom_fields` só traz campos
 * vinculados ao tracker da issue) e o executor do rails runner é um mock que cria,
 * vincula e desvincula o campo nessa mesma instância.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureUnlinkedCustomField } from '../../scripts/lib/seed-cf-unlinked.mjs';

const BASE = 'http://localhost:3080';
const SUBJECT = '[seed] CF desvinculado';
const FIELD_NAME = '[seed] CF desvinculado';
const MARKER = '[seed:cf-desvinculado]';
const TRACKER_ID = 2;
const ISSUES_PATH = `/issues.json?project_id=rc-fixtures&status_id=*&subject=~${encodeURIComponent(SUBJECT)}`;

type Detail = { property: string; name: string; old_value: string | null; new_value: string | null };
type Journal = { id: number; notes: string; details: Detail[] };
type Field = { id: number; name: string; trackerIds: number[] };
type Init = { method?: string; body?: string };

let issue: { id: number; subject: string; tracker: { id: number }; values: Record<number, string>; journals: Journal[] } | null;
let fields: Field[];
let calls: string[];
let runRails: ReturnType<typeof vi.fn>;

function fieldById(id: number) {
  return fields.find((field) => field.id === id);
}

/** Simula o Redmine para os caminhos que o módulo usa. */
async function fakeRedmine(url: string, init?: Init) {
  const path = url.slice(BASE.length);
  const method = init?.method ?? 'GET';
  calls.push(`${method} ${path}`);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

  if (method === 'GET' && path === ISSUES_PATH) {
    const copy = { id: 60, subject: `${SUBJECT} (cópia)` };
    return json(200, { issues: issue ? [copy, { id: issue.id, subject: issue.subject }] : [copy] });
  }
  if (method === 'POST' && path === '/issues.json') {
    issue = { id: 61, subject: body.issue.subject, tracker: { id: TRACKER_ID }, values: {}, journals: [] };
    return json(201, { issue: { id: 61 } });
  }
  if (issue && path.startsWith(`/issues/${issue.id}.json`)) {
    const current = issue;
    const linked = fields.filter((field) => field.trackerIds.includes(current.tracker.id));
    if (method === 'GET') {
      // Como o visible_details do Redmine: detail cf de campo inexistente some.
      const journals = current.journals.map((journal) => ({
        ...journal,
        details: journal.details.filter((detail) => detail.property !== 'cf' || fieldById(Number(detail.name))),
      }));
      const customFields = linked.map((field) => ({ id: field.id, name: field.name, value: current.values[field.id] ?? '' }));
      return json(200, { issue: { id: current.id, subject: current.subject, tracker: current.tracker, custom_fields: customFields, journals } });
    }
    // Como o Redmine: custom field não vinculado ao tracker é ignorado em silêncio.
    const details: Detail[] = [];
    for (const value of body.issue.custom_fields ?? []) {
      if (linked.some((field) => field.id === value.id)) {
        details.push({ property: 'cf', name: String(value.id), old_value: null, new_value: value.value });
        current.values[value.id] = value.value;
      }
    }
    current.journals.push({ id: current.journals.length + 1, notes: body.issue.notes ?? '', details });
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 404 });
}

/** Rails runner de mentira: cria/vincula (imprime o id) ou desvincula do tracker. */
async function fakeRails(ruby: string) {
  const unlink = /IssueCustomField\.find\((\d+)\)\.trackers\.delete\(Tracker\.find\((\d+)\)\)/.exec(ruby);
  if (unlink) {
    const field = fieldById(Number(unlink[1]));
    if (field) {
      field.trackerIds = field.trackerIds.filter((id) => id !== Number(unlink[2]));
    }
    return '';
  }
  const trackerId = Number(/Tracker\.find\((\d+)\)/.exec(ruby)?.[1]);
  let field = fields.find((candidate) => candidate.name === FIELD_NAME);
  if (!field) {
    field = { id: 7, name: FIELD_NAME, trackerIds: [] };
    fields.push(field);
  }
  if (!field.trackerIds.includes(trackerId)) {
    field.trackerIds.push(trackerId);
  }
  return `${field.id}\n`;
}

function markerJournals() {
  return issue?.journals.filter((journal) => journal.notes.startsWith(`${MARKER} `)) ?? [];
}

function journalWithCf(fieldId: number): Journal {
  return { id: 1, notes: `${MARKER} x`, details: [{ property: 'cf', name: String(fieldId), old_value: null, new_value: 'v' }] };
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

describe('ensureUnlinkedCustomField', () => {
  it('cria o CF no tracker da issue, grava o valor, desvincula e o CF continua existindo', async () => {
    await ensureUnlinkedCustomField('rc-fixtures', runRails);

    expect(issue?.subject).toBe(SUBJECT);
    expect(markerJournals()).toHaveLength(1);
    expect(markerJournals()[0].details).toEqual([
      { property: 'cf', name: '7', old_value: null, new_value: expect.any(String) },
    ]);
    expect(fields).toEqual([{ id: 7, name: FIELD_NAME, trackerIds: [] }]);
    expect(runRails).toHaveBeenCalledTimes(2);
    expect(runRails.mock.calls[0][0]).toContain(FIELD_NAME);
    expect(runRails.mock.calls[0][0]).toContain(`Tracker.find(${TRACKER_ID})`);
    expect(runRails.mock.calls[1][0]).toContain(`IssueCustomField.find(7).trackers.delete(Tracker.find(${TRACKER_ID}))`);
  });

  it('re-execução com CF já desvinculado e journal marcado: no-op, sem docker', async () => {
    await ensureUnlinkedCustomField('rc-fixtures', runRails);
    runRails.mockClear();
    calls = [];

    await ensureUnlinkedCustomField('rc-fixtures', runRails);

    expect(runRails).not.toHaveBeenCalled();
    expect(calls.filter((call) => !call.startsWith('GET '))).toEqual([]);
    expect(markerJournals()).toHaveLength(1);
  });

  it('journal marcado mas CF ainda vinculado (desvínculo interrompido): só desvincula', async () => {
    fields = [{ id: 7, name: FIELD_NAME, trackerIds: [TRACKER_ID] }];
    issue = { id: 61, subject: SUBJECT, tracker: { id: TRACKER_ID }, values: {}, journals: [journalWithCf(7)] };

    await ensureUnlinkedCustomField('rc-fixtures', runRails);

    expect(runRails).toHaveBeenCalledTimes(1);
    expect(runRails.mock.calls[0][0]).toContain('trackers.delete');
    expect(fields[0].trackerIds).toEqual([]);
    expect(calls.filter((call) => call.startsWith('PUT '))).toEqual([]);
  });

  it('CF já existe desvinculado e a issue foi recriada: revincula, reusa o id e desvincula', async () => {
    fields = [{ id: 9, name: FIELD_NAME, trackerIds: [] }];

    await ensureUnlinkedCustomField('rc-fixtures', runRails);

    expect(runRails).toHaveBeenCalledTimes(2);
    expect(markerJournals()[0].details[0].name).toBe('9');
    expect(fields[0].trackerIds).toEqual([]);
  });

  it('docker indisponível: lança, sem engolir o erro', async () => {
    runRails = vi.fn(async () => {
      throw new Error('spawn docker ENOENT');
    });

    await expect(ensureUnlinkedCustomField('rc-fixtures', runRails)).rejects.toThrow(/ENOENT/);
  });

  it('rails runner sem id na saída: lança antes do PUT', async () => {
    runRails = vi.fn(async () => 'nada\n');

    await expect(ensureUnlinkedCustomField('rc-fixtures', runRails)).rejects.toThrow(/id/);
    expect(calls.filter((call) => call.startsWith('PUT '))).toEqual([]);
  });

  it('Redmine ignora o CF no PUT (outra instância): lança e não desvincula', async () => {
    runRails = vi.fn(async () => '7\n'); // id que este Redmine não conhece

    await expect(ensureUnlinkedCustomField('rc-fixtures', runRails)).rejects.toThrow(/REDMINE_URL/);
    expect(runRails).toHaveBeenCalledTimes(1);
  });

  it('asserção: lança se o CF do detail continua em issue.custom_fields', async () => {
    runRails = vi.fn(async (ruby: string) => (ruby.includes('trackers.delete') ? '' : fakeRails(ruby))); // desvínculo sem efeito

    await expect(ensureUnlinkedCustomField('rc-fixtures', runRails)).rejects.toThrow(/ASSERT CF desvinculado/);
  });

  it('asserção: lança se o journal marcado não traz detail cf', async () => {
    issue = { id: 61, subject: SUBJECT, tracker: { id: TRACKER_ID }, values: {}, journals: [{ id: 1, notes: `${MARKER} x`, details: [] }] };

    await expect(ensureUnlinkedCustomField('rc-fixtures', runRails)).rejects.toThrow(/ASSERT CF desvinculado/);
    expect(runRails).not.toHaveBeenCalled();
  });
});
