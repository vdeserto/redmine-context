/**
 * Semântica dos `journal.details` do Redmine — rótulos legíveis e ids resolvidos.
 *
 * A API grava o nome CRU da coluna (`status_id`, `done_ratio`) e os valores como
 * ids, então `status_id: 12 → 7` não informa nada a quem lê — nem humano nem LLM.
 * Este módulo traduz isso UMA vez, para TODAS as superfícies: o bundle Markdown
 * (`./markdown.ts`) e a tela de detalhe da TUI consumiam a mesma informação e
 * divergiam, com a TUI mostrando os ids crus.
 *
 * Cada parte devolvida diz se é texto NOSSO (`trusted`) ou conteúdo derivado do
 * Redmine (`trusted: false`). Quem renderiza decide a política: o bundle envolve
 * o não confiável em `<untrusted-content>` (anti prompt-injection), a TUI apenas
 * exibe. A distinção é o motivo de este módulo devolver partes em vez de strings
 * já formatadas.
 *
 * Nada sai como valor CRU sem ser um id inteiro (ver `idToken`): `detail.name` e
 * `old/new_value` são strings livres da API, e um valor forjado escaparia da
 * fence do bundle.
 */

import type { Issue, JournalDetail, RedmineRef } from '../contract.js';

/**
 * Dicionários `id → nome` para resolver os ids HISTÓRICOS de um journal.
 *
 * Sem eles só o valor que coincide com o estado atual da issue ganha nome, e o
 * outro lado da alteração fica como `#id` — ilegível ("não sei o que é status
 * 12"). Todos os campos são opcionais: o que faltar degrada para `#id`.
 */
export interface DetailLookups {
  /** `id → nome` de status (`/issue_statuses.json`). */
  readonly status?: ReadonlyMap<number, string> | undefined;
  /** `id → nome` de trackers (`/trackers.json`). */
  readonly tracker?: ReadonlyMap<number, string> | undefined;
  /** `id → nome` de prioridades (`/enumerations/issue_priorities.json`). */
  readonly priority?: ReadonlyMap<number, string> | undefined;
  /** `id → nome` de usuários (ver {@link collectUsers}). */
  readonly user?: ReadonlyMap<number, string> | undefined;
}

/**
 * Monta o dicionário de usuários a partir da PRÓPRIA issue — sem rede.
 *
 * `/users.json` exige admin na maioria das instâncias, mas os nomes já circulam
 * no payload: autor, responsável, autor de cada journal, autor de cada anexo e
 * watchers. Isso costuma cobrir os ids que aparecem no histórico, já que quem
 * mexeu na issue quase sempre deixou um journal.
 *
 * @param issue - Issue normalizada.
 * @returns Mapa `id → nome` com todos os usuários citados no payload.
 */
export function collectUsers(issue: Issue): ReadonlyMap<number, string> {
  const users = new Map<number, string>();
  const add = (ref: RedmineRef | undefined): void => {
    if (ref !== undefined && ref.id !== 0 && ref.name.length > 0) users.set(ref.id, ref.name);
  };
  add(issue.author);
  add(issue.assigned_to);
  for (const journal of issue.journals) add(journal.user);
  for (const attachment of issue.attachments) add(attachment.author);
  for (const watcher of issue.watchers ?? []) add(watcher);
  return users;
}

/** Dicionário da enumeração correspondente a um atributo. */
function lookupFor(attr: string, lookups: DetailLookups | undefined): ReadonlyMap<number, string> | undefined {
  if (lookups === undefined) return undefined;
  switch (attr) {
    case 'status_id':
      return lookups.status;
    case 'tracker_id':
      return lookups.tracker;
    case 'priority_id':
      return lookups.priority;
    case 'assigned_to_id':
    case 'author_id':
      return lookups.user;
    default:
      return undefined;
  }
}

/**
 * Um pedaço de texto pronto para exibir, com a marca de confiança.
 */
export interface DetailPart {
  /** Texto a exibir. */
  text: string;
  /**
   * `true` quando o texto é NOSSO (rótulo traduzido, `#id`, `40%`) e dispensa
   * marcação de conteúdo não confiável; `false` quando vem do Redmine.
   */
  trusted: boolean;
}

/**
 * Rótulos legíveis dos atributos padrão do Redmine.
 *
 * Vocabulário fixo da ferramenta (não conteúdo da instância), portanto texto
 * confiável.
 */
const ATTR_LABELS: Record<string, string> = {
  subject: 'Assunto',
  description: 'Descrição',
  project_id: 'Projeto',
  tracker_id: 'Tracker',
  status_id: 'Status',
  priority_id: 'Prioridade',
  author_id: 'Autor',
  assigned_to_id: 'Responsável',
  category_id: 'Categoria',
  fixed_version_id: 'Versão',
  parent_id: 'Issue pai',
  child_id: 'Sub-issue',
  done_ratio: 'Progresso',
  start_date: 'Início',
  due_date: 'Prazo',
  estimated_hours: 'Estimativa',
  is_private: 'Privada',
};

/** Atributos cujo valor é o número de OUTRA issue (não um id de enumeração). */
const ISSUE_REF_ATTRS = new Set(['parent_id', 'child_id']);

/**
 * Tipos de relação do Redmine — vocabulário FECHADO, portanto confiável. Um
 * valor fora desta lista é tratado como conteúdo derivado.
 */
const RELATION_TYPES = new Set([
  'relates',
  'duplicates',
  'duplicated',
  'blocks',
  'blocked',
  'precedes',
  'follows',
  'copied_to',
  'copied_from',
]);

/**
 * Porteiro dos valores exibidos sem marcação.
 *
 * @param raw - Valor bruto do detail.
 * @returns O próprio valor se for um inteiro não negativo; senão `undefined`.
 */
function idToken(raw: string): string | undefined {
  return /^\d+$/.test(raw) ? raw : undefined;
}

/**
 * Achata um valor de alteração em UMA linha.
 *
 * Editar a descrição de uma issue guarda o texto INTEIRO — com quebras de linha
 * — nos dois lados do detail. Um resumo de alteração é, por definição, de uma
 * linha: no bundle o valor multi-linha quebra o formato `- campo: antes → depois`
 * (e escapa visualmente da fence); na TUI vira várias linhas de tela, furando a
 * conta do viewport, que assume um item por linha.
 *
 * O conteúdo completo continua disponível na seção Descrição do bundle.
 *
 * @param raw - Valor bruto do detail.
 * @returns O mesmo texto com quebras e espaços repetidos colapsados.
 */
function flatten(raw: string): string {
  return raw.replace(/\s*\r?\n\s*/g, ' ').trim();
}

/**
 * Ref ATUAL da issue correspondente a um atributo, quando o contrato a carrega.
 *
 * Usada só para NOMEAR um id que coincide com o estado corrente; nunca para
 * inferir estado histórico.
 *
 * @param issue - Issue normalizada.
 * @param attr - Nome cru do atributo (ex.: `status_id`).
 * @returns A ref atual, ou `undefined` se o atributo não tiver uma no contrato.
 */
function currentRefFor(issue: Issue, attr: string): RedmineRef | undefined {
  switch (attr) {
    case 'project_id':
      return issue.project;
    case 'tracker_id':
      return issue.tracker;
    case 'status_id':
      return issue.status;
    case 'priority_id':
      return issue.priority;
    case 'author_id':
      return issue.author;
    case 'assigned_to_id':
      return issue.assigned_to;
    default:
      return undefined;
  }
}

/**
 * Nome do custom field a partir do id: num detail `cf`, o `name` é o ID do campo
 * (não o rótulo), e sai como número solto sem esta resolução.
 *
 * @param issue - Issue normalizada (fonte dos `custom_fields`).
 * @param rawId - `detail.name` de um detail `cf`.
 * @returns O nome do campo, ou `undefined` se o id não constar na issue.
 */
function customFieldName(issue: Issue, rawId: string): string | undefined {
  const id = Number(rawId);
  if (!Number.isInteger(id)) return undefined;
  return issue.custom_fields.find((field) => field.id === id)?.name;
}

/**
 * Rótulo de um detail de journal.
 *
 * @param detail - Detalhe do journal.
 * @param issue - Issue normalizada (resolve nomes de custom field).
 * @returns O rótulo e sua marca de confiança.
 * @example
 * journalDetailLabel({ property: 'attr', name: 'status_id' }, issue)
 * // { text: 'Status', trusted: true }
 */
export function journalDetailLabel(detail: JournalDetail, issue: Issue): DetailPart {
  if (detail.property === 'cf') {
    const name = customFieldName(issue, detail.name);
    // Nome definido pelo admin da instância: conteúdo derivado.
    if (name !== undefined) return { text: name, trusted: false };
    return { text: `campo #${detail.name}`, trusted: idToken(detail.name) !== undefined };
  }
  if (detail.property === 'attachment') {
    const id = idToken(detail.name);
    return id === undefined
      ? { text: `Anexo ${detail.name}`, trusted: false }
      : { text: `Anexo #${id}`, trusted: true };
  }
  if (detail.property === 'relation') {
    return RELATION_TYPES.has(detail.name)
      ? { text: `Relação (${detail.name})`, trusted: true }
      : { text: detail.name, trusted: false };
  }
  const label = ATTR_LABELS[detail.name];
  return label === undefined ? { text: detail.name, trusted: false } : { text: label, trusted: true };
}

/**
 * Um lado (antes/depois) de uma alteração.
 *
 * Ids de referência recebem `#` para nunca parecerem número solto. O nome vem,
 * em ordem: do dicionário da instância (`lookups`, que resolve qualquer id,
 * inclusive os históricos) ou do estado ATUAL da issue, quando o id coincide. A comparação é segura:
 * só o último journal que alterou um campo tem `new_value` igual ao valor
 * corrente, então nenhum valor histórico é nomeado incorretamente.
 *
 * @param detail - Detalhe do journal (define como o valor é interpretado).
 * @param raw - Valor bruto (`old_value` ou `new_value`).
 * @param issue - Issue normalizada (resolve refs pelo estado atual).
 * @param lookups - Dicionários da instância; ausentes ⇒ degrada para `#id`.
 * @returns A parte a exibir, ou `undefined` para ausência (cada superfície usa
 *   seu próprio placeholder).
 */
export function journalDetailValue(
  detail: JournalDetail,
  raw: string | null | undefined,
  issue: Issue,
  lookups?: DetailLookups,
): DetailPart | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const flat = flatten(raw);
  if (flat === '') return undefined;
  const id = idToken(flat);

  // Um detail `relation` registra a issue do outro lado da relação.
  if (detail.property === 'relation') {
    return id === undefined ? { text: flat, trusted: false } : { text: `issue #${id}`, trusted: true };
  }
  if (detail.property !== 'attr') return { text: flat, trusted: false };

  if (detail.name === 'done_ratio') {
    return id === undefined ? { text: flat, trusted: false } : { text: `${id}%`, trusted: true };
  }
  if (ISSUE_REF_ATTRS.has(detail.name)) {
    return id === undefined ? { text: flat, trusted: false } : { text: `issue #${id}`, trusted: true };
  }

  // Dicionário da instância primeiro: resolve QUALQUER id, inclusive o valor
  // histórico que não corresponde mais ao estado atual.
  if (id !== undefined) {
    const named = lookupFor(detail.name, lookups)?.get(Number(id));
    if (named !== undefined) return { text: `${named} (#${id})`, trusted: true };
  }

  const ref = currentRefFor(issue, detail.name);
  if (id !== undefined && ref !== undefined && ref.id !== 0 && String(ref.id) === id) {
    // O NOME vem do Redmine, mas é a mesma categoria dos metadados estruturais
    // (status/prioridade/responsável) já exibidos sem marcação nas duas
    // superfícies — mantém a política existente em vez de criar uma nova.
    return { text: `${ref.name} (#${id})`, trusted: true };
  }
  if (id !== undefined && ATTR_LABELS[detail.name] !== undefined && detail.name.endsWith('_id')) {
    return { text: `#${id}`, trusted: true };
  }
  return { text: flat, trusted: false };
}
