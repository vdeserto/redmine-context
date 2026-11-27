// @ts-check
//
// seed-attachments.mjs — anexos do seed (#204). A marca de idempotência é o
// filename: anexo já presente na issue não é reenviado.

import { existsSync, readFileSync } from 'node:fs';
import { getIssue, log, putIssue, uploadBytes } from './seed-helpers.mjs';

const NOTE_FILENAME = 'fixture-note.txt';
// Print de stack trace (material do OCR), gerado por demo/make-fixture-image.py. Ausente => só avisa.
const IMAGE_FILENAME = 'fixture-error.png';
const IMAGE_PATH = new URL('../../demo/fixture-error.png', import.meta.url);

/**
 * Anexa o arquivo à issue se ainda não houver um com esse nome (só faz upload quando vai anexar).
 * @param {number} id
 * @param {string} filename
 * @param {Buffer} bytes
 * @param {string} [contentType] default 'text/plain'
 */
async function ensureAttachment(id, filename, bytes, contentType = 'text/plain') {
  const issue = await getIssue(id, 'attachments');
  for (const attachment of issue.attachments ?? []) {
    if (attachment.filename === filename) {
      log(`issue ${id}: anexo ${filename} já presente`);
      return;
    }
  }
  const token = await uploadBytes(bytes);
  await putIssue(id, { uploads: [{ token, filename, content_type: contentType }] }, 'anexo');
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
