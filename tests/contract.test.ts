import { describe, expect, it } from 'vitest';

import {
  demoOperation,
  type Attachment,
  type CustomField,
  type Issue,
  type IssueRelation,
  type Journal,
  type ProgressEvent,
  type Result,
} from '../src/contract.js';

/** Coleta todos os itens de um AsyncIterable — padrão de consumo das superfícies. */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe('contract: consumo de AsyncIterable<ProgressEvent | Result> (ADR-005)', () => {
  // Caso esperado: a operação emite progresso incremental e termina com um Result.
  it('emite eventos de progresso seguidos de exatamente um Result', async () => {
    const events = await collect(demoOperation());

    const progress = events.filter((e): e is ProgressEvent => e.kind === 'progress');
    const results = events.filter((e): e is Result<string> => e.kind === 'result');

    expect(progress.length).toBeGreaterThan(0);
    expect(results).toHaveLength(1);
    expect(results[0]?.value).toBe('done');
    // Result é sempre o último evento — superfícies agregam ao vê-lo.
    expect(events.at(-1)?.kind).toBe('result');
  });

  // Discriminated union: o narrowing por `kind` dá acesso tipado aos campos certos.
  it('permite narrowing por kind para progress e result', async () => {
    for await (const event of demoOperation()) {
      if (event.kind === 'progress') {
        expect(typeof event.stage).toBe('string');
        expect(typeof event.message).toBe('string');
      } else {
        expect(typeof event.value).toBe('string');
      }
    }
  });

  // Edge case: consumo parcial (break) não trava nem exige drenar todo o iterable.
  it('suporta consumo parcial com break', async () => {
    let seen = 0;
    for await (const event of demoOperation()) {
      seen += 1;
      expect(event.kind).toBe('progress');
      break;
    }
    expect(seen).toBe(1);
  });
});

describe('contract: modelo normalizado (ADR-005)', () => {
  // Fixtures tipadas fixam a forma do contrato; o gate de typecheck é a verificação real.
  it('aceita uma Issue completa com journals, relations, attachments e custom fields', () => {
    const cfSingle: CustomField = {
      id: 1,
      name: 'Severidade',
      value: 'Alta',
      raw_value: 'Alta',
      field_format: 'list',
    };
    // Custom field "multiple": raw_value como array de strings, sem coerção de tipo.
    const cfMultiple: CustomField = {
      id: 2,
      name: 'Ambientes',
      value: ['prod', 'staging'],
      raw_value: ['prod', 'staging'],
    };
    // Custom field vazio: value normaliza ausência para null; raw_value preserva o bruto ("" ou null).
    const cfEmpty: CustomField = {
      id: 3,
      name: 'Observações',
      value: null,
      raw_value: '',
    };
    const cfNullFromApi: CustomField = {
      id: 4,
      name: 'Data limite',
      value: null,
      raw_value: null,
      field_format: 'date',
    };
    expect(cfEmpty.value).toBeNull();
    expect(cfEmpty.raw_value).toBe('');
    expect(cfNullFromApi.raw_value).toBeNull();

    const journal: Journal = {
      id: 10,
      notes: 'Movido para Em andamento',
      created_on: '2026-07-20T12:00:00Z',
      user: { id: 5, name: 'Dev' },
      // details[] brutos: histórico de status sem interpretação.
      details: [{ property: 'attr', name: 'status_id', old_value: '1', new_value: '2' }],
    };

    const attachment: Attachment = {
      id: 20,
      filename: 'log.txt',
      filesize: 1024,
      content_type: 'text/plain',
      created_on: '2026-07-20T12:00:00Z',
      content_url: 'https://redmine.example/attachments/download/20/log.txt',
      digest: 'sha256:abc',
    };

    const relation: IssueRelation = {
      id: 30,
      issue_id: 100,
      issue_to_id: 101,
      relation_type: 'precedes',
      delay: 2,
    };

    const issue: Issue = {
      id: 100,
      subject: 'Bug crítico',
      description: 'Detalhes',
      project: { id: 1, name: 'Core' },
      tracker: { id: 1, name: 'Bug' },
      status: { id: 2, name: 'Em andamento' },
      priority: { id: 4, name: 'Alta' },
      author: { id: 5, name: 'Dev' },
      created_on: '2026-07-19T09:00:00Z',
      updated_on: '2026-07-20T12:00:00Z',
      custom_fields: [cfSingle, cfMultiple],
      journals: [journal],
      attachments: [attachment],
      relations: [relation],
      parent: { id: 99 },
      children: [{ id: 101, subject: 'Sub-tarefa' }],
    };

    expect(issue.custom_fields[1]?.raw_value).toEqual(['prod', 'staging']);
    expect(issue.journals[0]?.details[0]?.new_value).toBe('2');
    expect(issue.relations[0]?.delay).toBe(2);
    expect(issue.attachments[0]?.digest).toBe('sha256:abc');
    // watchers é opcional (degrada em 403) — ausente aqui.
    expect(issue.watchers).toBeUndefined();
  });
});
