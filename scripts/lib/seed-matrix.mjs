// @ts-check
//
// seed-matrix.mjs — confere a matriz completa do seed num só lugar (#205).
//
// Lê o estado da instância por GET (os 2 projetos com versões, categorias e issues
// com journals/anexos; os usuários) e anota cada caso encontrado como uma chave em
// `found`. Cada caso de MATRIX é nome legível → chave; os ausentes saem todos numa
// mensagem só. A issue movida mora no rc-fixtures-2, por isso as issues dos dois
// projetos entram. As contagens devolvidas alimentam a comparação da execução
// dupla no CI (scripts/ci-e2e-up.sh): seed idempotente não muda nenhuma delas.

import { api, getIssue } from './seed-helpers.mjs';
import { PROJECT_FIXTURES } from './seed-projects.mjs';

const LOCKED_STATUS = 3;
const USERS_PATH = '/users.json?status=*&limit=100'; // status=* inclui bloqueados

/** Caso do plano → chave anotada em `found` quando o estado o contém. */
const MATRIX = {
  'usuário bloqueado (seed-carla)': 'locked:seed-carla',
  '2º projeto (rc-fixtures-2)': 'project:rc-fixtures-2',
  'troca de status (status_id)': 'attr:status_id',
  'troca de tracker (tracker_id)': 'attr:tracker_id',
  'troca de prioridade (priority_id)': 'attr:priority_id',
  'troca de responsável (assigned_to_id)': 'attr:assigned_to_id',
  'troca de projeto (project_id)': 'attr:project_id',
  'troca de categoria (category_id)': 'attr:category_id',
  'troca de versão (fixed_version_id)': 'attr:fixed_version_id',
  'CF removido (detail cf fora de custom_fields)': 'cf-unlinked',
  'anexo adicionado': 'attachment:+',
  'anexo removido': 'attachment:-',
};
for (const identifier in PROJECT_FIXTURES) {
  for (const name of PROJECT_FIXTURES[identifier].versions) {
    MATRIX[`versão '${name}' (${identifier})`] = `versions:${identifier}:${name}`;
  }
  for (const name of PROJECT_FIXTURES[identifier].categories) {
    MATRIX[`categoria '${name}' (${identifier})`] = `categories:${identifier}:${name}`;
  }
}

/** Coleções por projeto (chave igual à de PROJECT_FIXTURES): lista na REST e contagem. */
const COLLECTIONS = {
  versions: { list: 'versions', count: 'versoes' },
  categories: { list: 'issue_categories', count: 'categorias' },
};

/** GET que lança se não vier 200. */
async function getJson(path) {
  const got = await api('GET', path);
  if (got.status !== 200) {
    throw new Error(`GET ${path} falhou: status ${got.status}`);
  }
  return got.json;
}

/**
 * Anota em `found` o que os journals da issue trazem: trocas de atributo
 * (old != new), anexo +/− e detail cf de campo fora de `issue.custom_fields`.
 * @param {any} issue
 * @param {Record<string, true>} found
 */
function noteJournals(issue, found) {
  /** @type {Record<string, true>} */
  const linkedFieldIds = {};
  for (const field of issue.custom_fields ?? []) {
    linkedFieldIds[String(field.id)] = true;
  }
  for (const journal of issue.journals ?? []) {
    for (const detail of journal.details ?? []) {
      if (detail.property === 'attr' && detail.new_value && detail.old_value !== detail.new_value) {
        found[`attr:${detail.name}`] = true;
      } else if (detail.property === 'attachment') {
        found[detail.new_value ? 'attachment:+' : 'attachment:-'] = true;
      } else if (detail.property === 'cf' && !linkedFieldIds[detail.name]) {
        found['cf-unlinked'] = true;
      }
    }
  }
}

/**
 * Confere cada caso de MATRIX no estado da instância e devolve as contagens do seed.
 * Lança um erro só, nomeando todos os casos ausentes.
 * @returns {Promise<{ issues: number, journals: number, anexos: number, usuarios: number, versoes: number, categorias: number }>}
 */
export async function assertSeedMatrix() {
  /** @type {Record<string, true>} */
  const found = {};
  const counts = { issues: 0, journals: 0, anexos: 0, usuarios: 0, versoes: 0, categorias: 0 };

  for (const identifier in PROJECT_FIXTURES) {
    const project = await api('GET', `/projects/${identifier}.json`);
    if (project.status !== 200) {
      continue; // projeto ausente: os casos dele ficam sem anotação
    }
    found[`project:${identifier}`] = true;
    const projectId = project.json.project.id;
    for (const collection in COLLECTIONS) {
      const { list, count } = COLLECTIONS[collection];
      for (const item of (await getJson(`/projects/${identifier}/${list}.json`))[list]) {
        // A lista de versões inclui as compartilhadas de outros projetos: só conta a do próprio.
        if (item.project?.id === projectId) {
          found[`${collection}:${identifier}:${item.name}`] = true;
          counts[count] += 1;
        }
      }
    }
    for (const { id } of (await getJson(`/issues.json?project_id=${identifier}&status_id=*&limit=100`)).issues) {
      const issue = await getIssue(id, 'journals,attachments');
      noteJournals(issue, found);
      counts.issues += 1;
      counts.journals += issue.journals?.length ?? 0;
      counts.anexos += issue.attachments?.length ?? 0;
    }
  }

  for (const user of (await getJson(USERS_PATH)).users) {
    if (user.login.startsWith('seed-')) {
      counts.usuarios += 1;
      if (user.status === LOCKED_STATUS) {
        found[`locked:${user.login}`] = true;
      }
    }
  }

  const missing = [];
  for (const name in MATRIX) {
    if (!found[MATRIX[name]]) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw new Error(`matriz do seed incompleta: ${missing.join(', ')}`);
  }
  return counts;
}
