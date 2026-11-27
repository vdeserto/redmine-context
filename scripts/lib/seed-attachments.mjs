// @ts-check
//
// seed-attachments.mjs — anexos do seed (#204): os 2 da issue base 1 e a issue
// "[seed] Anexos no histórico", com um anexo enviado por journal marcado (detail
// `attachment` com new_value) e outro removido via DELETE /attachments/:id.json
// (detail com old_value) — o material do +/− no histórico da TUI.
//
// A marca de idempotência é o filename: anexo já presente não é reenviado, e a
// remoção é achada pelo old_value `seed-removed.txt` no histórico (o journal do
// DELETE não tem notes), então re-executar não envia nem remove de novo.

import { existsSync, readFileSync } from 'node:fs';
import { api, getIssue, log, putIssue, uploadBytes } from './seed-helpers.mjs';

const NOTE_FILENAME = 'fixture-note.txt';
// Print de stack trace (material do OCR), gerado por demo/make-fixture-image.py. Ausente => só avisa.
const IMAGE_FILENAME = 'fixture-error.png';
const IMAGE_PATH = new URL('../../demo/fixture-error.png', import.meta.url);

const SUBJECT = '[seed] Anexos no histórico';
const ADDED_FILENAME = 'seed-added.txt';
const REMOVED_FILENAME = 'seed-removed.txt';

/**
 * Anexa o arquivo à issue se ainda não houver um com esse nome (só faz upload quando vai anexar).
 * @param {number} id
 * @param {string} filename
 * @param {Buffer} bytes
 * @param {string} [contentType] default 'text/plain'
 * @param {string} [notes] notes do journal que grava o anexo
 */
async function ensureAttachment(id, filename, bytes, contentType = 'text/plain', notes) {
  const issue = await getIssue(id, 'attachments');
  for (const attachment of issue.attachments ?? []) {
    if (attachment.filename === filename) {
      log(`issue ${id}: anexo ${filename} já presente`);
      return;
    }
  }
  const token = await uploadBytes(bytes);
  await putIssue(id, { uploads: [{ token, filename, content_type: contentType }], notes }, 'anexo');
  log(`issue ${id}: anexo ${filename} criado`);
}

/**
 * Anexos da issue base 1: texto e imagem (a imagem é opcional; nenhuma asserção depende dela).
 * @param {number} issueId
 */
export async function ensureFixtureAttachments(issueId) {
  await ensureAttachment(issueId, NOTE_FILENAME, Buffer.from('Anexo de fixture gerado pelo seed (rc-fixtures).\n', 'utf8'));
  if (existsSync(IMAGE_PATH)) {
    await ensureAttachment(issueId, IMAGE_FILENAME, readFileSync(IMAGE_PATH), 'image/png');
  } else {
    log(`aviso: ${IMAGE_FILENAME} não encontrado — anexo de imagem pulado`);
  }
}

/**
 * Id da issue de anexos no projeto; cria se não existir. O filtro `~` do Redmine
 * é "contém", então a comparação exata fica no cliente.
 * @param {string} projectId
 * @returns {Promise<number>}
 */
async function findOrCreateIssue(projectId) {
  const found = await api('GET', `/issues.json?project_id=${projectId}&status_id=*&subject=~${encodeURIComponent(SUBJECT)}`);
  if (found.status !== 200) {
    throw new Error(`GET issue de anexos falhou: status ${found.status}`);
  }
  for (const issue of found.json.issues) {
    if (issue.subject === SUBJECT) {
      return issue.id;
    }
  }
  const issue = { project_id: projectId, subject: SUBJECT, description: 'Histórico com anexo adicionado e removido (seed).' };
  const created = await api('POST', '/issues.json', { issue });
  if (created.status !== 201) {
    throw new Error(`POST issue de anexos falhou: status ${created.status} — ${created.text.slice(0, 300)}`);
  }
  log(`issue criada: "${SUBJECT}" (id ${created.json.issue.id})`);
  return created.json.issue.id;
}

/**
 * Conta os details `attachment` do histórico: "+filename" (enviado) e "-filename" (removido).
 * @param {number} issueId
 * @returns {Promise<Record<string, number>>}
 */
async function countAttachmentDetails(issueId) {
  const counts = {};
  for (const journal of (await getIssue(issueId, 'journals')).journals ?? []) {
    for (const detail of journal.details ?? []) {
      if (detail.property === 'attachment') {
        const key = detail.new_value ? `+${detail.new_value}` : `-${detail.old_value}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }
  return counts;
}

/**
 * Garante a issue "[seed] Anexos no histórico" com o anexo adicionado e o
 * removido, e confere 1 detail de cada no histórico. Idempotente.
 * @param {string} projectId identifier do projeto
 */
export async function ensureAttachmentHistory(projectId) {
  const issueId = await findOrCreateIssue(projectId);
  const bytes = Buffer.from('Anexo do histórico gerado pelo seed (rc-fixtures).\n', 'utf8');
  await ensureAttachment(issueId, ADDED_FILENAME, bytes, 'text/plain', '[seed:anexo] Anexo adicionado.');
  if ((await countAttachmentDetails(issueId))[`-${REMOVED_FILENAME}`]) {
    log(`issue ${issueId}: remoção de ${REMOVED_FILENAME} já no histórico`);
  } else {
    await ensureAttachment(issueId, REMOVED_FILENAME, bytes, 'text/plain', '[seed:anexo-removido] Anexo a remover.');
    for (const attachment of (await getIssue(issueId, 'attachments')).attachments) {
      if (attachment.filename === REMOVED_FILENAME) {
        const removed = await api('DELETE', `/attachments/${attachment.id}.json`);
        if (removed.status !== 204 && removed.status !== 200) {
          throw new Error(`DELETE anexo ${attachment.id} falhou: status ${removed.status}`);
        }
        log(`issue ${issueId}: anexo ${REMOVED_FILENAME} removido`);
      }
    }
  }

  const counts = await countAttachmentDetails(issueId);
  for (const key of [`+${ADDED_FILENAME}`, `-${REMOVED_FILENAME}`]) {
    if (counts[key] !== 1) {
      throw new Error(`ASSERT anexos: issue ${issueId} esperava 1 detail ${key}, obtido ${counts[key] ?? 0}`);
    }
  }
  log(`asserções OK: anexos no histórico da issue ${issueId}: +${ADDED_FILENAME}, -${REMOVED_FILENAME}`);
}
