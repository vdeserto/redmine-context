/**
 * Allowlist do gravador de fixtures (#260): a lista de requisições que o
 * `record-fixtures.mjs` grava é fixa — gravar algo fora dela, deixar de gravar
 * um caso ou mudar o status esperado de um 403/404 quebra este teste. Sem rede.
 */
import { describe, expect, it } from 'vitest';
import { recordingPlan, requestUrl } from '../../scripts/lib/record-plan.mjs';

const ids = { issueIds: [11, 12, 13], attachmentId: 7, activeUserId: 21, lockedUserId: 23 };

/** Uma linha por requisição: quem chama, o caminho com a query, o status e o rótulo. */
function lines() {
  const out = [];
  for (const request of recordingPlan(ids)) {
    out.push(`${request.as} ${requestUrl(request)} → ${request.status} | ${request.case}`);
  }
  return out;
}

describe('recordingPlan', () => {
  it('grava exatamente os endpoints da allowlist, com o status e o rótulo de cada caso', () => {
    expect(lines()).toEqual([
      'admin /issues/11.json?include=journals%2Cattachments%2Crelations%2Cchildren → 200 | detalhe da issue base 1',
      'admin /issues/12.json?include=journals%2Cattachments%2Crelations%2Cchildren → 200 | detalhe da issue base 2',
      'admin /issues/13.json?include=journals%2Cattachments%2Crelations%2Cchildren → 200 | detalhe da issue base 3',
      'admin /attachments/download/7/fixture-note.txt → 200 | download do anexo de texto da issue base 1',
      'admin /issue_statuses.json → 200 | enumeração de status',
      'admin /trackers.json → 200 | enumeração de trackers',
      'admin /enumerations/issue_priorities.json → 200 | enumeração de prioridades',
      'admin /projects/rc-fixtures/memberships.json?offset=0&limit=100 → 200 | memberships do 1º projeto',
      'admin /projects/rc-fixtures-2/memberships.json?offset=0&limit=100 → 200 | memberships do 2º projeto',
      'admin /projects/rc-fixtures/versions.json → 200 | versões do 1º projeto',
      'admin /projects/rc-fixtures-2/versions.json → 200 | versões do 2º projeto',
      'admin /projects/rc-fixtures/issue_categories.json → 200 | categorias do 1º projeto',
      'admin /projects/rc-fixtures-2/issue_categories.json → 200 | categorias do 2º projeto',
      'admin /users/21.json → 200 | usuário ativo (seed-ana)',
      'admin /users/23.json → 200 | usuário bloqueado (seed-carla) visto pelo admin',
      'nonAdmin /users/23.json → 404 | usuário bloqueado (seed-carla) visto por não-admin',
      'admin /users/999999.json → 404 | usuário com id inexistente',
      'admin /custom_fields.json → 200 | custom fields com admin',
      'nonAdmin /custom_fields.json → 403 | custom fields sem admin',
      'admin /issues.json?issue_id=11%2C12%2C13&status_id=* → 200 | assuntos das issues base numa chamada',
    ]);
  });

  it('só o download do anexo é binário', () => {
    const binaries = [];
    for (const request of recordingPlan(ids)) {
      if (request.kind === 'binary') {
        binaries.push(request.path);
      }
    }
    expect(binaries).toEqual(['/attachments/download/7/fixture-note.txt']);
  });

  it('todo rótulo é único: cada interação aponta um caso só', () => {
    const seen: Record<string, true> = {};
    for (const request of recordingPlan(ids)) {
      expect(seen[request.case]).toBeUndefined();
      seen[request.case] = true;
    }
  });
});
