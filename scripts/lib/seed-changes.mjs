// @ts-check
//
// seed-changes.mjs — issue "[seed] Trocas de estado" com 2 trocas de status, 1 de
// tracker e 1 de prioridade, cada uma num journal próprio (#257). É o material
// dos details `status_id`/`tracker_id`/`priority_id` que o bundle traduz em nomes.
//
// Cada etapa é um PUT com a troca + notes `[seed:<etapa>] ...`; a marca da etapa é
// a chave de idempotência (ensureByMarker 'journal'), então re-executar não grava
// journal novo. Os ids vêm das enumerações da instância: o valor novo é o próximo
// da lista depois do atual (status abertos, trackers do projeto, prioridades
// ativas). O admin não esbarra no workflow; se a troca for ignorada mesmo assim,
// o journal sai sem details e a asserção falha.

import { api, ensureByMarker, getIssue, log, putIssue } from './seed-helpers.mjs';

const SUBJECT = '[seed] Trocas de estado';

/** Uma troca por PUT, nesta ordem. */
const STEPS = [
  { marker: '[seed:status-1]', field: 'status_id', note: 'Atendimento iniciado.' },
  { marker: '[seed:status-2]', field: 'status_id', note: 'Correção entregue.' },
  { marker: '[seed:tracker]', field: 'tracker_id', note: 'Reclassificada.' },
  { marker: '[seed:priority]', field: 'priority_id', note: 'Prioridade elevada.' },
];

/** Atributo da issue (GET) que cada campo do PUT altera. */
const ATTR_BY_FIELD = { status_id: 'status', tracker_id: 'tracker', priority_id: 'priority' };

/** GET que lança se não vier 200. */
async function getJson(path) {
  const got = await api('GET', path);
  if (got.status !== 200) {
    throw new Error(`GET ${path} falhou: status ${got.status}`);
  }
  return got.json;
}

/**
 * Para cada campo, `{ idAtual: próximoId }` (circular) sobre os ids da instância.
 * @param {string} projectId
 * @returns {Promise<Record<string, Record<number, number>>>}
 */
async function nextIdsByField(projectId) {
  const ids = { status_id: [], tracker_id: [], priority_id: [] };
  for (const status of (await getJson('/issue_statuses.json')).issue_statuses) {
    if (!status.is_closed) {
      ids.status_id.push(status.id);
    }
  }
  for (const tracker of (await getJson(`/projects/${projectId}.json?include=trackers`)).project.trackers) {
    ids.tracker_id.push(tracker.id);
  }
  for (const priority of (await getJson('/enumerations/issue_priorities.json')).issue_priorities) {
    if (priority.active) {
      ids.priority_id.push(priority.id);
    }
  }
  const nextIds = {};
  for (const field in ids) {
    const list = ids[field];
    if (list.length < 2) {
      throw new Error(`trocas: ${field} precisa de 2+ opções na instância, achei ${list.length}`);
    }
    nextIds[field] = {};
    for (let i = 0; i < list.length; i++) {
      nextIds[field][list[i]] = list[(i + 1) % list.length];
    }
  }
  return nextIds;
}

/**
 * Id da issue de trocas no projeto, se existir.
 * @param {string} projectId
 * @returns {Promise<number | undefined>}
 */
async function findIssueId(projectId) {
  for (const issue of (await getJson(`/issues.json?project_id=${projectId}&status_id=*&limit=100`)).issues) {
    if (issue.subject === SUBJECT) {
      return issue.id;
    }
  }
  return undefined;
}

/**
 * Cria a issue de trocas e devolve o id.
 * @param {string} projectId
 * @returns {Promise<number>}
 */
async function createIssue(projectId) {
  const issue = { project_id: projectId, subject: SUBJECT, description: 'Histórico de trocas de status, tracker e prioridade (seed).' };
  const created = await api('POST', '/issues.json', { issue });
  if (created.status !== 201) {
    throw new Error(`POST issue de trocas falhou: status ${created.status} — ${created.text.slice(0, 300)}`);
  }
  log(`issue criada: "${SUBJECT}" (id ${created.json.issue.id})`);
  return created.json.issue.id;
}

/**
 * Garante a issue de trocas e um journal por etapa. Idempotente.
 * @param {string} projectId identifier do projeto
 */
export async function ensureStateChanges(projectId) {
  const nextIds = await nextIdsByField(projectId);
  const issueId = (await findIssueId(projectId)) ?? (await createIssue(projectId));
  for (const step of STEPS) {
    await ensureByMarker('journal', step.marker, async () => {
      const issue = await getIssue(issueId);
      const currentId = issue[ATTR_BY_FIELD[step.field]].id;
      const value = nextIds[step.field][currentId];
      if (value === undefined) {
        throw new Error(`trocas: ${step.field} atual (${currentId}) fora das opções da instância`);
      }
      const fields = { [step.field]: value, notes: `${step.marker} ${step.note}` };
      await putIssue(issueId, fields, step.marker);
    }, issueId);
  }
}

/**
 * Confere 1 journal por etapa, cada um com a troca do seu campo (old != new).
 * @param {string} projectId identifier do projeto
 */
export async function assertStateChanges(projectId) {
  const issueId = await findIssueId(projectId);
  if (issueId === undefined) {
    throw new Error(`ASSERT trocas: issue "${SUBJECT}" ausente`);
  }
  const journalsByMarker = {};
  for (const journal of (await getIssue(issueId, 'journals')).journals ?? []) {
    const marker = (journal.notes ?? '').split(/\s/, 1)[0];
    journalsByMarker[marker] ??= [];
    journalsByMarker[marker].push(journal);
  }
  let summary = '';
  for (const step of STEPS) {
    const journals = journalsByMarker[step.marker] ?? [];
    if (journals.length !== 1) {
      throw new Error(`ASSERT trocas: ${step.marker} esperado 1 journal, obtido ${journals.length}`);
    }
    const details = journals[0].details ?? [];
    const detail = details.find((/** @type {any} */ d) => d.property === 'attr' && d.name === step.field);
    if (!detail?.old_value || !detail.new_value || detail.old_value === detail.new_value) {
      throw new Error(`ASSERT trocas: ${step.marker} sem troca de ${step.field} — details ${JSON.stringify(details)}`);
    }
    summary += ` ${step.field} ${detail.old_value}→${detail.new_value};`;
  }
  log(`asserções OK: trocas na issue ${issueId}:${summary}`);
}
