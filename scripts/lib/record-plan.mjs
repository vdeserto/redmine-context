// @ts-check
//
// record-plan.mjs — allowlist das requisições que o record-fixtures.mjs grava (#260).
//
// Cada entrada é uma interação do interactions.json: quem chama (`admin` ou o
// não-admin seed-ana, para os 403/404), caminho e query exatamente como o
// cliente os envia, o status que a gravação exige (outro status aborta) e o
// rótulo `case` com o caso de origem, que vai para o arquivo. Os endpoints que o
// cliente ainda não chama (memberships, versões, categorias, /users/:id,
// /custom_fields.json, /issues.json?issue_id=) seguem o plano do M8/M9.

/** Include do detalhe de issue (deve casar com src/client/issues.ts). */
export const ISSUE_INCLUDE = 'journals,attachments,relations,children';
/** Anexo de texto que o seed cria na issue base 1. */
export const ATTACH_FILENAME = 'fixture-note.txt';
/** Id de usuário que nenhuma instância de teste alcança (caso 404). */
const MISSING_USER_ID = 999999;
/** Projetos do seed, com o ordinal usado no rótulo. */
const PROJECTS = { 'rc-fixtures': '1º', 'rc-fixtures-2': '2º' };
/** Enumerações que src/client/enumerations.ts busca, sem query. */
const ENUMERATIONS = {
  '/issue_statuses.json': 'enumeração de status',
  '/trackers.json': 'enumeração de trackers',
  '/enumerations/issue_priorities.json': 'enumeração de prioridades',
};

/**
 * @typedef {{ case: string, as: 'admin' | 'nonAdmin', path: string, query: Record<string, string>,
 *   status: number, kind: 'json' | 'binary' }} PlannedRequest
 */

/** O caso comum: GET do admin, sem query, 200 com JSON. */
const ADMIN_OK = /** @type {const} */ ({ as: 'admin', query: {}, status: 200, kind: 'json' });

/**
 * Monta a lista de requisições a gravar, na ordem do arquivo.
 * @param {{ issueIds: number[], attachmentId: number, activeUserId: number, lockedUserId: number }} ids
 * @returns {PlannedRequest[]}
 */
export function recordingPlan(ids) {
  /** @type {PlannedRequest[]} */
  const plan = [];
  for (const [index, id] of ids.issueIds.entries()) {
    const issueDetail = { include: ISSUE_INCLUDE };
    plan.push({ ...ADMIN_OK, case: `detalhe da issue base ${index + 1}`, path: `/issues/${id}.json`, query: issueDetail });
  }
  const downloadPath = `/attachments/download/${ids.attachmentId}/${encodeURIComponent(ATTACH_FILENAME)}`;
  plan.push({ ...ADMIN_OK, case: 'download do anexo de texto da issue base 1', path: downloadPath, kind: 'binary' });
  for (const path in ENUMERATIONS) {
    plan.push({ ...ADMIN_OK, case: ENUMERATIONS[path], path });
  }
  for (const project in PROJECTS) {
    const firstPage = { offset: '0', limit: '100' };
    const path = `/projects/${project}/memberships.json`;
    plan.push({ ...ADMIN_OK, case: `memberships do ${PROJECTS[project]} projeto`, path, query: firstPage });
  }
  for (const project in PROJECTS) {
    const path = `/projects/${project}/versions.json`;
    plan.push({ ...ADMIN_OK, case: `versões do ${PROJECTS[project]} projeto`, path });
  }
  for (const project in PROJECTS) {
    const path = `/projects/${project}/issue_categories.json`;
    plan.push({ ...ADMIN_OK, case: `categorias do ${PROJECTS[project]} projeto`, path });
  }
  const lockedPath = `/users/${ids.lockedUserId}.json`;
  const lockedForNonAdmin = 'usuário bloqueado (seed-carla) visto por não-admin';
  plan.push(
    { ...ADMIN_OK, case: 'usuário ativo (seed-ana)', path: `/users/${ids.activeUserId}.json` },
    { ...ADMIN_OK, case: 'usuário bloqueado (seed-carla) visto pelo admin', path: lockedPath },
    { ...ADMIN_OK, case: lockedForNonAdmin, path: lockedPath, as: 'nonAdmin', status: 404 },
    { ...ADMIN_OK, case: 'usuário com id inexistente', path: `/users/${MISSING_USER_ID}.json`, status: 404 },
    { ...ADMIN_OK, case: 'custom fields com admin', path: '/custom_fields.json' },
    { ...ADMIN_OK, case: 'custom fields sem admin', path: '/custom_fields.json', as: 'nonAdmin', status: 403 },
  );
  const issueSubjects = { issue_id: ids.issueIds.join(','), status_id: '*' };
  plan.push({ ...ADMIN_OK, case: 'assuntos das issues base numa chamada', path: '/issues.json', query: issueSubjects });
  return plan;
}

/**
 * Caminho com a query, como o cliente envia.
 * @param {{ path: string, query: Record<string, string> }} request
 */
export function requestUrl(request) {
  const query = new URLSearchParams(request.query).toString();
  return query === '' ? request.path : `${request.path}?${query}`;
}
