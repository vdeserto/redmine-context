// @ts-check
//
// seed-moves.mjs — issue "[seed] Trocas de projeto": trocas de categoria e versão no
// rc-fixtures e, por fim, movida para o rc-fixtures-2 (#258). Uma etapa = um PUT com
// notes `[seed:<etapa>]`, chave de idempotência (ensureByMarker 'journal').
// A busca não filtra projeto, para achá-la também depois de movida. O PUT da mudança
// leva categoria e versão do projeto 2 (o Redmine limparia as do 1), gravando os 3
// details valor → valor. Campo ignorado lança logo após o PUT: para refazer, apague a issue.

import { api, ensureByMarker, getIssue, log, putIssue } from './seed-helpers.mjs';
import { ensureProjectFixtures } from './seed-projects.mjs';

const SUBJECT = '[seed] Trocas de projeto';
const SEARCH_PATH = `/issues.json?status_id=*&subject=~${encodeURIComponent(SUBJECT)}&limit=100`;

/** Atributo da issue (GET) que cada campo do PUT altera. */
const ATTR_OF_FIELD = { project_id: 'project', category_id: 'category', fixed_version_id: 'fixed_version' };

/**
 * Etapas em ordem; `changes` é campo → [old, new] esperados no detail (null = vazio).
 * @param {Awaited<ReturnType<typeof ensureProjectFixtures>>} projects
 * @returns {{ marker: string, note: string, changes: Record<string, [number | null, number]> }[]}
 */
function stepsFor(projects) {
  const p1 = projects['rc-fixtures'];
  const p2 = projects['rc-fixtures-2'];
  const backend = p1.categories['[seed] Backend'];
  const frontend = p1.categories['[seed] Frontend'];
  const v1 = p1.versions['[seed] v1.0'];
  const v2 = p1.versions['[seed] v2.0'];
  return [
    { marker: '[seed:category-1]', note: 'Categorizada.', changes: { category_id: [null, backend] } },
    { marker: '[seed:category-2]', note: 'Categoria corrigida.', changes: { category_id: [backend, frontend] } },
    { marker: '[seed:version-1]', note: 'Planejada.', changes: { fixed_version_id: [null, v1] } },
    { marker: '[seed:version-2]', note: 'Adiada.', changes: { fixed_version_id: [v1, v2] } },
    {
      marker: '[seed:move]',
      note: 'Movida para o RC Fixtures 2.',
      changes: {
        project_id: [p1.id, p2.id],
        category_id: [frontend, p2.categories['[seed] P2 Infra']],
        fixed_version_id: [v2, p2.versions['[seed] P2 v1.0']],
      },
    },
  ];
}

/**
 * Id da issue em qualquer projeto. O filtro `~` é "contém": a comparação exata fica no cliente.
 * @returns {Promise<number | undefined>}
 */
async function findIssueId() {
  const got = await api('GET', SEARCH_PATH);
  if (got.status !== 200) {
    throw new Error(`GET ${SEARCH_PATH} falhou: status ${got.status}`);
  }
  for (const issue of got.json.issues) {
    if (issue.subject === SUBJECT) {
      return issue.id;
    }
  }
  return undefined;
}

/** Cria a issue no rc-fixtures e devolve o id. */
async function createIssue() {
  const issue = { project_id: 'rc-fixtures', subject: SUBJECT, description: 'Histórico de trocas de categoria, versão e projeto (seed).' };
  const created = await api('POST', '/issues.json', { issue });
  if (created.status !== 201) {
    throw new Error(`POST issue de trocas de projeto falhou: status ${created.status} — ${created.text.slice(0, 300)}`);
  }
  log(`issue criada: "${SUBJECT}" (id ${created.json.issue.id})`);
  return created.json.issue.id;
}

/**
 * Grava a etapa num PUT e confere no GET seguinte que cada campo ficou com o valor novo.
 * @param {number} issueId
 * @param {{ marker: string, note: string, changes: Record<string, [number | null, number]> }} step
 */
async function applyStep(issueId, step) {
  const fields = { notes: `${step.marker} ${step.note}` };
  for (const field in step.changes) {
    fields[field] = step.changes[field][1];
  }
  await putIssue(issueId, fields, step.marker);
  const saved = await getIssue(issueId);
  for (const field in step.changes) {
    const savedId = saved[ATTR_OF_FIELD[field]]?.id;
    if (savedId !== fields[field]) {
      throw new Error(
        `trocas de projeto: ${step.marker} o Redmine ignorou ${field}=${fields[field]} (ficou ${savedId}); ` +
          `o journal marcado já foi gravado: apague a issue "${SUBJECT}" para refazer o seed`,
      );
    }
  }
}

/**
 * Garante a issue de trocas de projeto, um journal por etapa, e confere que cada
 * journal marcado tem exatamente os details esperados (old/new). Idempotente.
 */
export async function seedMoves() {
  const steps = stepsFor(await ensureProjectFixtures());
  const issueId = (await findIssueId()) ?? (await createIssue());
  for (const step of steps) {
    await ensureByMarker('journal', step.marker, () => applyStep(issueId, step), issueId);
  }

  const journalsByMarker = {};
  for (const journal of (await getIssue(issueId, 'journals')).journals ?? []) {
    const marker = (journal.notes ?? '').split(/\s/, 1)[0];
    journalsByMarker[marker] ??= [];
    journalsByMarker[marker].push(journal);
  }
  const summary = [];
  for (const step of steps) {
    const journals = journalsByMarker[step.marker] ?? [];
    if (journals.length !== 1) {
      throw new Error(`ASSERT trocas de projeto: ${step.marker} esperado 1 journal, obtido ${journals.length}`);
    }
    const detailsByField = {};
    for (const detail of journals[0].details ?? []) {
      if (detail.property === 'attr') {
        detailsByField[detail.name] = detail;
      }
    }
    for (const field in step.changes) {
      const [oldId, newId] = step.changes[field];
      const detail = detailsByField[field];
      const expectedOld = oldId === null ? null : String(oldId);
      if ((detail?.old_value ?? null) !== expectedOld || detail?.new_value !== String(newId)) {
        throw new Error(
          `ASSERT trocas de projeto: ${step.marker} esperado ${field} ${oldId ?? 'vazio'}→${newId}, ` +
            `details ${JSON.stringify(journals[0].details ?? [])}`,
        );
      }
      summary.push(`${field} ${oldId ?? 'vazio'}→${newId}`);
    }
  }
  log(`asserções OK: trocas de projeto na issue ${issueId}: ${summary.join('; ')}`);
}
