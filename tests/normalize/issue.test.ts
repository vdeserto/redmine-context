import { describe, expect, it } from 'vitest';

import type { RedmineIssuePayload } from '../../src/client/index.js';
import { normalizeIssue } from '../../src/normalize/index.js';

/**
 * Fixture fiel ao payload de `/issues/{id}.json?include=journals,attachments`
 * de um Redmine real: refs `{ id, name }`, journals com `details[]` brutos e
 * attachments com `content_url`/`digest`.
 */
function fullPayload(): RedmineIssuePayload {
  return {
    id: 100,
    project: { id: 1, name: 'Core' },
    tracker: { id: 1, name: 'Bug' },
    status: { id: 2, name: 'Em andamento' },
    priority: { id: 4, name: 'Alta' },
    author: { id: 5, name: 'Ana Dev' },
    assigned_to: { id: 6, name: 'Bruno Ops' },
    subject: 'Bug crítico no login',
    description: 'Falha ao autenticar via SSO.',
    start_date: '2026-07-18',
    due_date: '2026-07-25',
    done_ratio: 30,
    created_on: '2026-07-19T09:00:00Z',
    updated_on: '2026-07-20T12:00:00Z',
    journals: [
      {
        id: 10,
        user: { id: 5, name: 'Ana Dev' },
        notes: 'Movido para Em andamento',
        created_on: '2026-07-20T12:00:00Z',
        details: [
          { property: 'attr', name: 'status_id', old_value: '1', new_value: '2' },
          { property: 'attr', name: 'assigned_to_id', old_value: null, new_value: '6' },
        ],
      },
      {
        id: 11,
        user: { id: 6, name: 'Bruno Ops' },
        notes: '',
        created_on: '2026-07-20T13:00:00Z',
        details: [],
      },
    ],
    attachments: [
      {
        id: 20,
        filename: 'stacktrace.log',
        filesize: 2048,
        content_type: 'text/plain',
        description: 'Log completo',
        author: { id: 5, name: 'Ana Dev' },
        created_on: '2026-07-20T12:05:00Z',
        content_url: 'https://redmine.example/attachments/download/20/stacktrace.log',
        digest: '9f86d081884c7d659a2feaa0c55ad015',
      },
    ],
    custom_fields: [{ id: 1, name: 'Severidade', value: 'Alta' }],
    relations: [{ id: 30, issue_id: 100, issue_to_id: 101, relation_type: 'precedes' }],
    watchers: [{ id: 9, name: 'Watcher' }],
  };
}

describe('normalizeIssue: payload completo (caso esperado)', () => {
  it('mapeia o núcleo, refs, journals e attachments', () => {
    const issue = normalizeIssue(fullPayload());

    expect(issue.id).toBe(100);
    expect(issue.subject).toBe('Bug crítico no login');
    expect(issue.description).toBe('Falha ao autenticar via SSO.');
    expect(issue.status).toEqual({ id: 2, name: 'Em andamento' });
    expect(issue.priority).toEqual({ id: 4, name: 'Alta' });
    expect(issue.author).toEqual({ id: 5, name: 'Ana Dev' });
    expect(issue.assigned_to).toEqual({ id: 6, name: 'Bruno Ops' });
    expect(issue.project).toEqual({ id: 1, name: 'Core' });
    expect(issue.tracker).toEqual({ id: 1, name: 'Bug' });
    expect(issue.created_on).toBe('2026-07-19T09:00:00Z');
    expect(issue.updated_on).toBe('2026-07-20T12:00:00Z');
  });

  it('preserva details[] brutos dos journals sem interpretar', () => {
    const issue = normalizeIssue(fullPayload());

    expect(issue.journals).toHaveLength(2);
    expect(issue.journals[0]?.notes).toBe('Movido para Em andamento');
    expect(issue.journals[0]?.user).toEqual({ id: 5, name: 'Ana Dev' });
    expect(issue.journals[0]?.details).toEqual([
      { property: 'attr', name: 'status_id', old_value: '1', new_value: '2' },
      { property: 'attr', name: 'assigned_to_id', old_value: null, new_value: '6' },
    ]);
    // Journal detail-only: notes vazia degrada para ausência explícita.
    expect(issue.journals[1]?.notes).toBeUndefined();
    expect(issue.journals[1]?.details).toEqual([]);
  });

  it('mapeia attachments com id/filename/filesize/content_type/digest', () => {
    const attachment = normalizeIssue(fullPayload()).attachments[0];

    expect(attachment).toEqual({
      id: 20,
      filename: 'stacktrace.log',
      filesize: 2048,
      content_type: 'text/plain',
      description: 'Log completo',
      author: { id: 5, name: 'Ana Dev' },
      created_on: '2026-07-20T12:05:00Z',
      content_url: 'https://redmine.example/attachments/download/20/stacktrace.log',
      digest: '9f86d081884c7d659a2feaa0c55ad015',
    });
  });

  it('deixa o escopo da #12 como coleções vazias / ausências explícitas', () => {
    const issue = normalizeIssue(fullPayload());

    expect(issue.custom_fields).toEqual([]);
    expect(issue.relations).toEqual([]);
    expect(issue.children).toEqual([]);
    expect(issue.parent).toBeUndefined();
    expect(issue.watchers).toBeUndefined();
  });
});

describe('normalizeIssue: payload mínimo (edge case)', () => {
  it('normaliza issue com apenas os campos obrigatórios do Redmine', () => {
    const payload: RedmineIssuePayload = {
      id: 7,
      project: { id: 1, name: 'Core' },
      tracker: { id: 1, name: 'Task' },
      status: { id: 1, name: 'Nova' },
      priority: { id: 2, name: 'Normal' },
      author: { id: 5, name: 'Ana Dev' },
      subject: 'Tarefa simples',
      description: '',
      created_on: '2026-07-19T09:00:00Z',
      updated_on: '2026-07-19T09:00:00Z',
    };
    const issue = normalizeIssue(payload);

    expect(issue.id).toBe(7);
    expect(issue.subject).toBe('Tarefa simples');
    // description vazia vira ausência explícita.
    expect(issue.description).toBeUndefined();
    expect(issue.assigned_to).toBeUndefined();
    expect(issue.journals).toEqual([]);
    expect(issue.attachments).toEqual([]);
  });
});

describe('normalizeIssue: journals/attachments ausentes (edge case)', () => {
  it('usa arrays vazios quando as coleções não vêm no payload', () => {
    const payload: RedmineIssuePayload = {
      id: 8,
      project: { id: 1, name: 'Core' },
      tracker: { id: 1, name: 'Task' },
      status: { id: 1, name: 'Nova' },
      priority: { id: 2, name: 'Normal' },
      author: { id: 5, name: 'Ana Dev' },
      subject: 'Sem coleções',
      created_on: '2026-07-19T09:00:00Z',
      updated_on: '2026-07-19T09:00:00Z',
    };
    const issue = normalizeIssue(payload);

    expect(issue.journals).toEqual([]);
    expect(issue.attachments).toEqual([]);
  });
});

describe('normalizeIssue: payload malformado (failure case, NUNCA crash)', () => {
  it('degrada tipos errados sem lançar exceção', () => {
    // Payload propositalmente corrompido: tipos trocados em todos os campos.
    const payload = {
      id: 42,
      project: 'não-é-objeto',
      status: { id: 'x', name: 123 },
      priority: null,
      author: { name: 'sem id' },
      assigned_to: 12345,
      subject: 999,
      description: { unexpected: true },
      created_on: 42,
      updated_on: null,
      journals: 'não-é-array',
      attachments: [null, 42, { id: 'x' }, { id: 21, filename: 7 }],
    } as unknown as RedmineIssuePayload;

    const issue = normalizeIssue(payload);

    expect(issue.id).toBe(42);
    // Refs ausentes/malformadas degradam para placeholder estável.
    expect(issue.project).toEqual({ id: 0, name: '' });
    expect(issue.priority).toEqual({ id: 0, name: '' });
    // Ref sem id não é ref válida.
    expect(issue.author).toEqual({ id: 0, name: '' });
    // Ref com name não-string degrada name para "".
    expect(issue.status).toEqual({ id: 0, name: '' });
    // subject não-string vira "".
    expect(issue.subject).toBe('');
    expect(issue.description).toBeUndefined();
    expect(issue.assigned_to).toBeUndefined();
    expect(issue.created_on).toBe('');
    expect(issue.updated_on).toBe('');
    // journals não-array vira [].
    expect(issue.journals).toEqual([]);
    // attachments: itens inválidos são descartados; só o com id sobrevive.
    expect(issue.attachments).toHaveLength(1);
    expect(issue.attachments[0]?.id).toBe(21);
    expect(issue.attachments[0]?.filename).toBe('');
  });

  it('descarta journals sem id e detalhes malformados', () => {
    const payload = {
      id: 43,
      subject: 'x',
      journals: [
        { notes: 'sem id' },
        { id: 50, created_on: '2026-07-20T00:00:00Z', details: [null, { name: 'só nome' }] },
      ],
    } as unknown as RedmineIssuePayload;

    const issue = normalizeIssue(payload);

    expect(issue.journals).toHaveLength(1);
    expect(issue.journals[0]?.id).toBe(50);
    // detail null descartado; o parcial mantém property/name defensivos.
    expect(issue.journals[0]?.details).toEqual([{ property: '', name: 'só nome' }]);
  });

  it('não lança para payload não-objeto', () => {
    const issue = normalizeIssue(null as unknown as RedmineIssuePayload);
    expect(issue.id).toBe(0);
    expect(issue.journals).toEqual([]);
    expect(issue.attachments).toEqual([]);
  });
});
