import { describe, expect, it } from 'vitest';

import type { RedmineIssuePayload } from '../../src/client/index.js';
import { normalizeIssue } from '../../src/normalize/index.js';

/**
 * Fixtures fiéis ao payload de
 * `/issues/{id}.json?include=journals,attachments,relations,children` de um
 * Redmine real, focadas no escopo da issue #12: custom_fields, relations,
 * parent/children e watchers.
 */
function base(): RedmineIssuePayload {
  return {
    id: 200,
    project: { id: 1, name: 'Core' },
    tracker: { id: 1, name: 'Feature' },
    status: { id: 1, name: 'Nova' },
    priority: { id: 2, name: 'Normal' },
    author: { id: 5, name: 'Ana Dev' },
    subject: 'Escopo #12',
    created_on: '2026-07-19T09:00:00Z',
    updated_on: '2026-07-19T09:00:00Z',
  };
}

describe('normalizeIssue #12: custom_fields', () => {
  it('preserva raw_value bruto e normaliza value só na ausência', () => {
    const payload: RedmineIssuePayload = {
      ...base(),
      custom_fields: [
        { id: 1, name: 'Texto', value: 'Alta' },
        { id: 2, name: 'Multi', value: ['a', 'b'] },
        { id: 3, name: 'Vazio', value: '' },
        { id: 4, name: 'Nulo', value: null },
        { id: 5, name: 'Ausente' },
      ],
    };
    const cfs = normalizeIssue(payload).custom_fields;

    expect(cfs).toEqual([
      { id: 1, name: 'Texto', value: 'Alta', raw_value: 'Alta' },
      { id: 2, name: 'Multi', value: ['a', 'b'], raw_value: ['a', 'b'] },
      // "" preservado no bruto, mas value normaliza a ausência para null.
      { id: 3, name: 'Vazio', value: null, raw_value: '' },
      { id: 4, name: 'Nulo', value: null, raw_value: null },
      // value ausente: bruto null, value null.
      { id: 5, name: 'Ausente', value: null, raw_value: null },
    ]);
  });

  it('anota field_format apenas quando fornecido externamente', () => {
    const payload: RedmineIssuePayload = {
      ...base(),
      custom_fields: [
        { id: 1, name: 'Texto', value: 'x' },
        { id: 2, name: 'Data', value: '2026-07-20' },
      ],
    };
    const formats = new Map<number, string>([[2, 'date']]);
    const cfs = normalizeIssue(payload, formats).custom_fields;

    // id 1 sem formato conhecido → field_format ausente.
    expect(cfs[0]).toEqual({ id: 1, name: 'Texto', value: 'x', raw_value: 'x' });
    // id 2 anotado pelo chamador.
    expect(cfs[1]).toEqual({
      id: 2,
      name: 'Data',
      value: '2026-07-20',
      raw_value: '2026-07-20',
      field_format: 'date',
    });
  });

  it('descarta custom fields sem id numérico sem crashar', () => {
    const payload = {
      ...base(),
      custom_fields: [null, 42, { name: 'sem id', value: 'x' }, { id: 9, name: 'ok', value: 'y' }],
    } as unknown as RedmineIssuePayload;

    const cfs = normalizeIssue(payload).custom_fields;
    expect(cfs).toEqual([{ id: 9, name: 'ok', value: 'y', raw_value: 'y' }]);
  });
});

describe('normalizeIssue #12: relations', () => {
  it('mapeia relation_type e delay (null quando ausente)', () => {
    const payload: RedmineIssuePayload = {
      ...base(),
      relations: [
        { id: 30, issue_id: 200, issue_to_id: 201, relation_type: 'precedes', delay: 2 },
        { id: 31, issue_id: 200, issue_to_id: 202, relation_type: 'relates' },
      ],
    };
    const relations = normalizeIssue(payload).relations;

    expect(relations).toEqual([
      { id: 30, issue_id: 200, issue_to_id: 201, relation_type: 'precedes', delay: 2 },
      { id: 31, issue_id: 200, issue_to_id: 202, relation_type: 'relates', delay: null },
    ]);
  });

  it('descarta relations malformadas e degrada campos ausentes', () => {
    const payload = {
      ...base(),
      relations: [null, { relation_type: 'sem id' }, { id: 40 }],
    } as unknown as RedmineIssuePayload;

    const relations = normalizeIssue(payload).relations;
    expect(relations).toEqual([
      { id: 40, issue_id: 0, issue_to_id: 0, relation_type: '', delay: null },
    ]);
  });
});

describe('normalizeIssue #12: parent e children', () => {
  it('mapeia parent {id} e children (inclusive aninhados)', () => {
    const payload: RedmineIssuePayload = {
      ...base(),
      parent: { id: 150 },
      children: [
        {
          id: 210,
          tracker: { id: 2, name: 'Task' },
          subject: 'Filha 1',
          children: [{ id: 211, tracker: { id: 2, name: 'Task' }, subject: 'Neta' }],
        },
        { id: 212, tracker: { id: 2, name: 'Task' }, subject: 'Filha 2' },
      ],
    };
    const issue = normalizeIssue(payload);

    expect(issue.parent).toEqual({ id: 150 });
    // children de topo achatados ao contrato {id, tracker?, subject?}.
    expect(issue.children).toEqual([
      { id: 210, tracker: { id: 2, name: 'Task' }, subject: 'Filha 1' },
      { id: 212, tracker: { id: 2, name: 'Task' }, subject: 'Filha 2' },
    ]);
  });

  it('omite parent inválido e descarta children sem id', () => {
    const payload = {
      ...base(),
      parent: { name: 'sem id' },
      children: [null, { subject: 'sem id' }, { id: 300 }],
    } as unknown as RedmineIssuePayload;

    const issue = normalizeIssue(payload);
    expect(issue.parent).toBeUndefined();
    expect(issue.children).toEqual([{ id: 300 }]);
  });
});

describe('normalizeIssue #12: watchers (degradação)', () => {
  it('mapeia watchers quando presentes no payload', () => {
    const payload: RedmineIssuePayload = {
      ...base(),
      watchers: [
        { id: 9, name: 'Watcher A' },
        { id: 10, name: 'Watcher B' },
      ],
    };
    expect(normalizeIssue(payload).watchers).toEqual([
      { id: 9, name: 'Watcher A' },
      { id: 10, name: 'Watcher B' },
    ]);
  });

  it('omite watchers quando o include não é pedido (campo ausente)', () => {
    // Sem chave watchers: include não pedido ou 403 → degradação por ausência.
    expect(normalizeIssue(base()).watchers).toBeUndefined();
  });

  it('mantém array vazio quando watchers vem vazio, e descarta refs inválidas', () => {
    const empty = { ...base(), watchers: [] } as unknown as RedmineIssuePayload;
    expect(normalizeIssue(empty).watchers).toEqual([]);

    const dirty = {
      ...base(),
      watchers: [null, { name: 'sem id' }, { id: 7, name: 'ok' }],
    } as unknown as RedmineIssuePayload;
    expect(normalizeIssue(dirty).watchers).toEqual([{ id: 7, name: 'ok' }]);
  });

  it('não lança quando watchers não é array', () => {
    const payload = { ...base(), watchers: 'nope' } as unknown as RedmineIssuePayload;
    expect(normalizeIssue(payload).watchers).toEqual([]);
  });
});
