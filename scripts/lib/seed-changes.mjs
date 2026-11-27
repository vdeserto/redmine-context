// @ts-check
//
// seed-changes.mjs — issue "[seed] Trocas de estado" com 2 trocas de status, 1 de
// tracker e 1 de prioridade, cada uma num journal próprio (#257). É o material
// dos details `status_id`/`tracker_id`/`priority_id` que o bundle traduz em nomes.
//
// Cada etapa é um PUT com a troca + notes `[seed:<etapa>] ...`; a marca da etapa é
// a chave de idempotência (ensureByMarker 'journal'), então re-executar não grava
// journal novo. Os ids vêm das enumerações da instância (status abertos, trackers
// do projeto, prioridades ativas): o valor novo é o próximo da lista depois do
// atual, ou o primeiro da lista quando o atual não está nela.
//
// Troca ignorada (workflow que não permite a transição): o Redmine responde 204 e
// grava o journal com a nota marcada, mas sem detail. Como a marca já existe, a
// re-execução pularia a etapa para sempre; por isso o GET logo após cada PUT lança
// na hora. Para refazer, apague a issue "[seed] Trocas de estado" e rode o seed.

import { api, ensureByMarker, getIssue, log, putIssue } from './seed-helpers.mjs';

const SUBJECT = '[seed] Trocas de estado';

/** Uma troca por PUT, nesta ordem; `attr` é o atributo da issue (GET) que o campo altera. */
const STEPS = [
  { marker: '[seed:status-1]', field: 'status_id', attr: 'status', note: 'Atendimento iniciado.' },
  { marker: '[seed:status-2]', field: 'status_id', attr: 'status', note: 'Correção entregue.' },
  { marker: '[seed:tracker]', field: 'tracker_id', attr: 'tracker', note: 'Reclassificada.' },
  { marker: '[seed:priority]', field: 'priority_id', attr: 'priority', note: 'Prioridade elevada.' },
];

/** GET que lança se não vier 200. */
async function getJson(path) {
  const got = await api('GET', path);
  if (got.status !== 200) {
    throw new Error(`GET ${path} falhou: status ${got.status}`);
  }
  return got.json;
}

/**
 * Ids que cada campo pode receber na instância, na ordem da API.
 * @param {string} projectId
 * @returns {Promise<Record<string, number[]>>}
 */
async function optionsByField(projectId) {
  const options = { status_id: [], tracker_id: [], priority_id: [] };
  for (const status of (await getJson('/issue_statuses.json')).issue_statuses) {
    if (!status.is_closed) {
      options.status_id.push(status.id);
    }
  }
  for (const tracker of (await getJson(`/projects/${projectId}.json?include=trackers`)).project.trackers) {
    options.tracker_id.push(tracker.id);
  }
  for (const priority of (await getJson('/enumerations/issue_priorities.json')).issue_priorities) {
    if (priority.active) {
      options.priority_id.push(priority.id);
    }
  }
  for (const field in options) {
    if (options[field].length < 2) {
      throw new Error(`trocas: ${field} precisa de 2+ opções na instância, achei ${options[field].length}`);
    }
  }
  return options;
}

/**
 * Id da issue de trocas no projeto, se existir. O filtro `~` do Redmine é "contém",
 * então a comparação exata fica no cliente.
 * @param {string} projectId
 * @returns {Promise<number | undefined>}
 */
async function findIssueId(projectId) {
  const path = `/issues.json?project_id=${projectId}&status_id=*&subject=~${encodeURIComponent(SUBJECT)}`;
  for (const issue of (await getJson(path)).issues) {
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
  const issue = {
    project_id: projectId,
    subject: SUBJECT,
    description: 'Histórico de trocas de status, tracker e prioridade (seed).',
  };
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
  const options = await optionsByField(projectId);
  const issueId = (await findIssueId(projectId)) ?? (await createIssue(projectId));
  for (const step of STEPS) {
    await ensureByMarker('journal', step.marker, async () => {
      const list = options[step.field];
      const currentId = (await getIssue(issueId))[step.attr].id;
      const value = list[(list.indexOf(currentId) + 1) % list.length]; // fora da lista: indexOf -1 → o primeiro
      await putIssue(issueId, { [step.field]: value, notes: `${step.marker} ${step.note}` }, step.marker);
      const savedId = (await getIssue(issueId))[step.attr].id;
      if (savedId !== value) {
        throw new Error(
          `trocas: ${step.marker} o Redmine ignorou ${step.field} ${currentId}→${value} (ficou ${savedId}); ` +
            `o journal marcado já foi gravado: apague a issue "${SUBJECT}" para refazer o seed`,
        );
      }
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
  const summary = [];
  for (const step of STEPS) {
    const journals = journalsByMarker[step.marker] ?? [];
    if (journals.length !== 1) {
      throw new Error(`ASSERT trocas: ${step.marker} esperado 1 journal, obtido ${journals.length}`);
    }
    const details = journals[0].details ?? [];
    let detail;
    for (const candidate of details) {
      if (candidate.property === 'attr' && candidate.name === step.field) {
        detail = candidate;
      }
    }
    if (!detail?.old_value || !detail.new_value || detail.old_value === detail.new_value) {
      throw new Error(`ASSERT trocas: ${step.marker} sem troca de ${step.field} — details ${JSON.stringify(details)}`);
    }
    summary.push(`${step.field} ${detail.old_value}→${detail.new_value}`);
  }
  log(`asserções OK: trocas na issue ${issueId}: ${summary.join('; ')}`);
}
