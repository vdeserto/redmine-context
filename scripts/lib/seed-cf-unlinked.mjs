// @ts-check
//
// seed-cf-unlinked.mjs — issue "[seed] CF desvinculado" com um journal cujo detail
// `cf` aponta para um custom field que não está em `issue.custom_fields` (#203). É o
// material do rótulo `campo #<id>` que o bundle usa quando o id não resolve um nome.
//
// Por que desvincular e não apagar: a API do Redmine monta os details com
// `journal.visible_details`, que esconde o detail `cf` de um campo inexistente
// (até para o admin). Um campo desvinculado do tracker da issue continua
// existindo e visível, então o detail sai, mas o campo some de `custom_fields`.
//
// A REST API não cria nem edita custom fields, então o campo é criado/vinculado e
// desvinculado por `rails runner` dentro do container `redmine` do compose de teste:
//
//   docker compose -f docker/docker-compose.yml exec -T -u redmine \
//     -e SECRET_KEY_BASE=seed-rails-runner redmine bundle exec rails runner '<ruby>'
//
// O runner não assina nada, mas o boot de produção exige a chave; `-u redmine`
// evita deixar arquivos do root em tmp/. COMPOSE_FILE troca o compose (mesmo
// padrão de scripts/ci-e2e-up.sh) e COMPOSE_PROJECT_NAME, que o `docker compose
// exec` respeita, aponta para um stack com `-p` próprio. Sem o docker, o passo lança.
//
// Etapas: cria o CF com `is_for_all: false`, vinculado só ao tracker e ao projeto da
// issue (se o seed morrer no meio, o campo não vaza para outros projetos; um CF já
// existente é ajustado do mesmo jeito) → PUT com o valor + notes
// `[seed:cf-desvinculado]` → desvincula o CF do tracker; ele segue no projeto, mas
// fora de `issue.custom_fields`. Com o journal marcado e o CF fora, a re-execução só
// faz GETs e não chama o docker.
//
// Todo id que entra no Ruby vem do JSON da API e passa por `positiveId`: um
// REDMINE_URL hostil não injeta código no container.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { api, ensureByMarker, getIssue, log, putIssue } from './seed-helpers.mjs';

const SUBJECT = '[seed] CF desvinculado';
const FIELD_NAME = '[seed] CF desvinculado';
const MARKER = '[seed:cf-desvinculado]';
const COMPOSE_FILE = process.env.COMPOSE_FILE ?? fileURLToPath(new URL('../../docker/docker-compose.yml', import.meta.url));

/**
 * Roda Ruby com `rails runner` no container do compose e devolve o stdout.
 * @param {string} ruby
 * @returns {Promise<string>}
 */
function runRailsInDocker(ruby) {
  const args = [
    'compose', '-f', COMPOSE_FILE, 'exec', '-T', '-u', 'redmine', '-e', 'SECRET_KEY_BASE=seed-rails-runner',
    'redmine', 'bundle', 'exec', 'rails', 'runner', ruby,
  ];
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        const cause = err.killed ? 'timeout' : `código ${err.code}`;
        reject(new Error(`CF desvinculado: rails runner via docker falhou (${cause}, compose ${COMPOSE_FILE}): ${stderr.trim().slice(-300)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Id da issue do CF desvinculado, criando-a se ainda não existe. O filtro `~` do
 * Redmine é "contém", então a comparação exata fica no cliente.
 * @param {string} projectId
 * @returns {Promise<number>}
 */
async function ensureIssueId(projectId) {
  const path = `/issues.json?project_id=${projectId}&status_id=*&subject=~${encodeURIComponent(SUBJECT)}`;
  const found = await api('GET', path);
  if (found.status !== 200) {
    throw new Error(`GET ${path} falhou: status ${found.status}`);
  }
  for (const issue of found.json.issues) {
    if (issue.subject === SUBJECT) {
      return issue.id;
    }
  }
  const issue = {
    project_id: projectId,
    subject: SUBJECT,
    description: 'Journal com valor de um custom field desvinculado do tracker (seed).',
  };
  const created = await api('POST', '/issues.json', { issue });
  if (created.status !== 201) {
    throw new Error(`POST issue do CF desvinculado falhou: status ${created.status} — ${created.text.slice(0, 300)}`);
  }
  log(`issue criada: "${SUBJECT}" (id ${created.json.issue.id})`);
  return created.json.issue.id;
}

/**
 * O valor como inteiro positivo, o único formato aceito para interpolar no Ruby.
 * @param {unknown} value
 * @param {string} what o que é o valor, para a mensagem de erro
 * @returns {number}
 */
function positiveId(value, what) {
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`CF desvinculado: ${what} não é um inteiro positivo: ${JSON.stringify(value)}`);
  }
  return Number(text);
}

/** Detail `cf` do journal marcado, se houver. */
function markedCfDetail(issue) {
  for (const journal of issue.journals ?? []) {
    if ((journal.notes ?? '').startsWith(`${MARKER} `)) {
      for (const detail of journal.details ?? []) {
        if (detail.property === 'cf') {
          return detail;
        }
      }
    }
  }
  return undefined;
}

/** O campo do detail ainda está em `issue.custom_fields`? */
function isLinked(issue, detail) {
  for (const field of issue.custom_fields ?? []) {
    if (String(field.id) === detail.name) {
      return true;
    }
  }
  return false;
}

/**
 * Garante o journal com detail `cf` de um CF desvinculado e confere: o detail sai
 * na API e o id dele não está em `issue.custom_fields`. Idempotente.
 * @param {string} projectId identifier do projeto
 * @param {(ruby: string) => Promise<string>} [runRails] executor do rails runner (testes injetam)
 */
export async function ensureUnlinkedCustomField(projectId, runRails = runRailsInDocker) {
  const issueId = await ensureIssueId(projectId);
  await ensureByMarker('journal', MARKER, async () => {
    const current = await getIssue(issueId);
    const trackerId = positiveId(current.tracker?.id, 'tracker id da issue');
    const issueProjectId = positiveId(current.project?.id, 'project id da issue');
    // Cria o CF (ou reusa o de uma execução anterior) e o vincula ao tracker e ao projeto da issue.
    const linkRuby =
      `t = Tracker.find(${trackerId}); p = Project.find(${issueProjectId}); ` +
      `cf = IssueCustomField.find_or_create_by!(name: '${FIELD_NAME}') { |f| f.field_format = 'string'; f.visible = true }; ` +
      `cf.update!(is_for_all: false); cf.trackers << t unless cf.trackers.include?(t); ` +
      `cf.projects << p unless cf.projects.include?(p); puts cf.id`;
    const fieldId = positiveId((await runRails(linkRuby)).trim().split('\n').pop(), 'id do custom field devolvido pelo rails runner');
    const fields = {
      custom_fields: [{ id: fieldId, value: 'valor de um campo que será desvinculado' }],
      notes: `${MARKER} Valor gravado antes de desvincular o custom field do tracker.`,
    };
    await putIssue(issueId, fields, MARKER);
    if (markedCfDetail(await getIssue(issueId, 'journals'))?.name !== String(fieldId)) {
      throw new Error(
        `CF desvinculado: o Redmine ignorou o custom field ${fieldId} no PUT (o compose ${COMPOSE_FILE} é a mesma instância de REDMINE_URL?); ` +
          `o journal marcado já foi gravado: apague a issue "${SUBJECT}" para refazer o seed`,
      );
    }
  }, issueId);

  let issue = await getIssue(issueId, 'journals');
  let detail = markedCfDetail(issue);
  if (detail !== undefined && isLinked(issue, detail)) {
    const fieldId = positiveId(detail.name, 'custom field do detail');
    const trackerId = positiveId(issue.tracker?.id, 'tracker id da issue');
    await runRails(`IssueCustomField.find(${fieldId}).trackers.delete(Tracker.find(${trackerId}))`);
    log(`custom field ${fieldId} desvinculado do tracker ${trackerId}`);
    issue = await getIssue(issueId, 'journals');
    detail = markedCfDetail(issue);
  }

  if (detail === undefined) {
    throw new Error(
      `ASSERT CF desvinculado: journal ${MARKER} sem detail cf na issue ${issueId} (o custom field foi apagado?); ` +
        `apague a issue "${SUBJECT}" e rode o seed de novo`,
    );
  }
  if (isLinked(issue, detail)) {
    throw new Error(`ASSERT CF desvinculado: o custom field ${detail.name} do detail ainda está em issue.custom_fields`);
  }
  log(`asserções OK: CF desvinculado na issue ${issueId}: detail cf ${detail.name}=${detail.new_value} fora de issue.custom_fields`);
}
