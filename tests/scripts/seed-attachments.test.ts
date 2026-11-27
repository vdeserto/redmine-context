/**
 * Anexos do seed (#204). Sem rede: o `fetch` global vira um Redmine de mentira
 * que guarda issues, recebe uploads e grava um journal por PUT com anexo e por
 * DELETE de anexo, com o detail `attachment` como o Redmine real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureAttachmentHistory, ensureFixtureAttachments } from '../../scripts/lib/seed-attachments.mjs';

// `imageMissing` liga o ramo "demo/fixture-error.png ausente" sem mexer no disco.
const fsState = vi.hoisted(() => ({ imageMissing: false }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, existsSync: (path: URL) => !fsState.imageMissing && fs.existsSync(path) };
});

const BASE = 'http://localhost:3080';
const SUBJECT = '[seed] Anexos no histórico';
const ISSUES_PATH = `/issues.json?project_id=rc-fixtures&status_id=*&subject=~${encodeURIComponent(SUBJECT)}`;

type Detail = { property: string; name: string; old_value: string | null; new_value: string | null };
type Journal = { id: number; notes: string; details: Detail[] };
type Attachment = { id: number; filename: string; content_type: string };
type FakeIssue = { id: number; subject: string; attachments: Attachment[]; journals: Journal[] };
type Init = { method?: string; body?: unknown };

let issues: Record<number, FakeIssue>;
let nextAttachmentId: number;
let deleteStatus: number; // status do DELETE de anexo; 500 não remove nada
let calls: string[];

/** Grava um journal com o detail `attachment` (new_value no envio, old_value na remoção). */
function journalize(issue: FakeIssue, notes: string, attachment: Attachment, removed: boolean) {
  const detail = {
    property: 'attachment',
    name: String(attachment.id),
    old_value: removed ? attachment.filename : null,
    new_value: removed ? null : attachment.filename,
  };
  issue.journals.push({ id: issue.journals.length + 1, notes, details: [detail] });
}

/** Simula o Redmine para os caminhos que o módulo usa. */
async function fakeRedmine(url: string, init?: Init) {
  const path = url.slice(BASE.length);
  const method = init?.method ?? 'GET';
  calls.push(`${method} ${path}`);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

  if (method === 'GET' && path === ISSUES_PATH) {
    // O filtro `~` do Redmine é "contém": a cópia também volta e o cliente descarta.
    const found: { id: number; subject: string }[] = [{ id: 40, subject: `${SUBJECT} (cópia)` }];
    for (const id in issues) {
      found.push(issues[id] as FakeIssue);
    }
    return json(200, { issues: found });
  }
  if (method === 'POST' && path === '/issues.json') {
    issues[41] = { id: 41, subject: body.issue.subject, attachments: [], journals: [] };
    return json(201, { issue: issues[41] });
  }
  if (method === 'POST' && path === '/uploads.json') {
    return json(201, { upload: { token: `token-${calls.length}` } });
  }
  const attachmentMatch = /^\/attachments\/(\d+)\.json$/.exec(path);
  if (method === 'DELETE' && attachmentMatch) {
    if (deleteStatus === 500) {
      return new Response('erro', { status: 500 });
    }
    for (const id in issues) {
      const issue = issues[id] as FakeIssue;
      for (const attachment of issue.attachments) {
        if (attachment.id === Number(attachmentMatch[1])) {
          issue.attachments = issue.attachments.filter((other) => other !== attachment);
          journalize(issue, '', attachment, true); // o DELETE grava journal sem notes
          return new Response(null, { status: deleteStatus });
        }
      }
    }
    return new Response(null, { status: 404 });
  }
  const issueMatch = /^\/issues\/(\d+)\.json/.exec(path);
  const issue = issueMatch ? issues[Number(issueMatch[1])] : undefined;
  if (issue && method === 'GET') {
    return json(200, { issue });
  }
  if (issue && method === 'PUT') {
    for (const upload of body.issue.uploads ?? []) {
      const attachment = { id: nextAttachmentId++, filename: upload.filename, content_type: upload.content_type };
      issue.attachments.push(attachment);
      journalize(issue, body.issue.notes ?? '', attachment, false);
    }
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 404 });
}

/** Chamadas que alteram algo no Redmine. */
function writes() {
  return calls.filter((call) => !call.startsWith('GET '));
}

/** Details `attachment` gravados na issue do histórico. */
function attachmentDetails() {
  const details: Detail[] = [];
  for (const journal of issues[41]?.journals ?? []) {
    details.push(...journal.details);
  }
  return details;
}

beforeEach(() => {
  issues = {};
  nextAttachmentId = 100;
  deleteStatus = 204;
  fsState.imageMissing = false;
  calls = [];
  vi.stubGlobal('fetch', vi.fn(fakeRedmine));
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ensureFixtureAttachments', () => {
  beforeEach(() => {
    issues[7] = { id: 7, subject: 'RC Fixture: issue base 1', attachments: [], journals: [] };
  });

  it('anexa o texto e a imagem da issue base 1, com o content type de cada um', async () => {
    await ensureFixtureAttachments(7);

    expect(issues[7]?.attachments.map((a) => [a.filename, a.content_type])).toEqual([
      ['fixture-note.txt', 'text/plain'],
      ['fixture-error.png', 'image/png'],
    ]);
  });

  it('re-execução não faz upload nem PUT', async () => {
    await ensureFixtureAttachments(7);
    calls = [];

    await ensureFixtureAttachments(7);

    expect(issues[7]?.attachments).toHaveLength(2);
    expect(writes()).toEqual([]);
  });

  it('imagem ausente: anexa só o texto e avisa', async () => {
    fsState.imageMissing = true;

    await ensureFixtureAttachments(7);

    expect(issues[7]?.attachments.map((a) => a.filename)).toEqual(['fixture-note.txt']);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/fixture-error\.png não encontrado/));
  });
});

describe('ensureAttachmentHistory', () => {
  it('cria a issue, grava o anexo adicionado (journal marcado) e o removido (journal do DELETE)', async () => {
    await ensureAttachmentHistory('rc-fixtures');

    expect(issues[41]?.subject).toBe(SUBJECT);
    expect(issues[41]?.attachments.map((a) => a.filename)).toEqual(['seed-added.txt']);
    const added = issues[41]?.journals.find((journal) => journal.details[0]?.new_value === 'seed-added.txt');
    expect(added?.notes).toMatch(/^\[seed:anexo\] /);
    expect(attachmentDetails()).toContainEqual(
      { property: 'attachment', name: '101', old_value: 'seed-removed.txt', new_value: null },
    );
    expect(writes()).toContain('DELETE /attachments/101.json');
  });

  it('re-execução não cria issue, não reenvia nem remove de novo', async () => {
    await ensureAttachmentHistory('rc-fixtures');
    calls = [];

    await ensureAttachmentHistory('rc-fixtures');

    expect(issues[41]?.journals).toHaveLength(3);
    expect(writes()).toEqual([]);
  });

  it('ignora a issue cujo subject só contém o do seed (filtro ~ do Redmine)', async () => {
    await ensureAttachmentHistory('rc-fixtures');

    expect(calls.some((call) => call.startsWith('GET /issues/40.json'))).toBe(false);
  });

  it('seed-removed.txt já anexado (sem remoção no histórico): não reenvia, só o remove', async () => {
    issues[41] = { id: 41, subject: SUBJECT, attachments: [{ id: 200, filename: 'seed-removed.txt', content_type: 'text/plain' }], journals: [] };

    await ensureAttachmentHistory('rc-fixtures');

    // O único upload/PUT é o de seed-added.txt.
    expect(writes()).toEqual(['POST /uploads.json', 'PUT /issues/41.json', 'DELETE /attachments/200.json']);
    expect(issues[41]?.attachments.map((a) => a.filename)).toEqual(['seed-added.txt']);
  });

  it('dois seed-removed.txt anexados: remove só o primeiro', async () => {
    const duplicate = { filename: 'seed-removed.txt', content_type: 'text/plain' };
    issues[41] = { id: 41, subject: SUBJECT, attachments: [{ id: 200, ...duplicate }, { id: 201, ...duplicate }], journals: [] };

    await ensureAttachmentHistory('rc-fixtures');

    expect(writes().filter((call) => call.startsWith('DELETE '))).toEqual(['DELETE /attachments/200.json']);
    expect(issues[41]?.attachments.map((a) => a.id)).toEqual([201, 100]);
  });

  it('DELETE respondendo 200 também conta como removido', async () => {
    deleteStatus = 200;

    await ensureAttachmentHistory('rc-fixtures');

    expect(attachmentDetails()).toContainEqual(
      { property: 'attachment', name: '101', old_value: 'seed-removed.txt', new_value: null },
    );
  });

  it('GET da issue com status != 200: lança com o status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: Init) => {
      if (url === BASE + ISSUES_PATH) {
        return new Response('erro', { status: 500 });
      }
      return fakeRedmine(url, init);
    }));

    await expect(ensureAttachmentHistory('rc-fixtures')).rejects.toThrow(/GET issue de anexos falhou: status 500/);
  });

  it('retoma após DELETE falho: não reenvia o anexo a remover, só o remove', async () => {
    deleteStatus = 500;
    await expect(ensureAttachmentHistory('rc-fixtures')).rejects.toThrow(/DELETE anexo 101.*status 500/);
    deleteStatus = 204;
    calls = [];

    await ensureAttachmentHistory('rc-fixtures');

    expect(writes()).toEqual(['DELETE /attachments/101.json']);
    expect(issues[41]?.attachments.map((a) => a.filename)).toEqual(['seed-added.txt']);
  });

  it('POST da issue com status != 201: lança com o status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: Init) => {
      if (init?.method === 'POST' && url.endsWith('/issues.json')) {
        return new Response('{"errors":["Subject inválido"]}', { status: 422 });
      }
      return fakeRedmine(url, init);
    }));

    await expect(ensureAttachmentHistory('rc-fixtures')).rejects.toThrow(/POST issue de anexos falhou: status 422/);
  });

  it('confere: detail do anexo adicionado ausente lança', async () => {
    await ensureAttachmentHistory('rc-fixtures');
    const journal = issues[41]?.journals[0];
    if (journal) {
      journal.details = [];
    }

    await expect(ensureAttachmentHistory('rc-fixtures')).rejects.toThrow(/ASSERT anexos.*\+seed-added\.txt/);
  });

  it('confere: remoção duplicada no histórico lança', async () => {
    await ensureAttachmentHistory('rc-fixtures');
    const removal = issues[41]?.journals[2];
    if (removal) {
      issues[41]?.journals.push({ ...removal, id: 99 });
    }

    await expect(ensureAttachmentHistory('rc-fixtures')).rejects.toThrow(/ASSERT anexos.*-seed-removed\.txt.*2/);
  });
});
