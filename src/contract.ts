/**
 * Contrato público do core (ADR-005).
 *
 * FRONTEIRA (boundary): este é o ÚNICO módulo que as superfícies (TUI, CLI, MCP)
 * devem importar para consumir o core. Nenhuma superfície acessa os módulos
 * internos (`src/client`, `src/normalize`, `src/extract`, `src/bundle`,
 * `src/config`, `src/cache`) diretamente — o acoplamento se dá exclusivamente
 * por estes tipos e pelo padrão `AsyncIterable<ProgressEvent | Result>`.
 * A regra eslint `no-restricted-imports` (escopo `src/surfaces/**`) reforça isso.
 */

/** Referência nomeada do Redmine (`{ id, name }`) — projeto, tracker, status, usuário, etc. */
export interface RedmineRef {
  id: number;
  name: string;
}

/**
 * Custom field normalizado — SEM coerção de tipo (ADR-005).
 * `raw_value` preserva o valor bruto exatamente como a API devolveu (incl. `null`
 * ou `""` em campo vazio); em campos "multiple" é `string[]`.
 * `value` normaliza apenas ausência: `""`/`null`/ausente → `null`. Nada além disso.
 */
export interface CustomField {
  id: number;
  name: string;
  value: string | string[] | null;
  raw_value: string | string[] | null;
  field_format?: string;
}

/** Detalhe bruto de um journal (histórico de status/atributos), sem interpretação. */
export interface JournalDetail {
  property: string;
  name: string;
  old_value?: string | null;
  new_value?: string | null;
}

/** Entrada de journal: nota opcional + `details[]` brutos. */
export interface Journal {
  id: number;
  notes?: string;
  created_on: string;
  user?: RedmineRef;
  details: JournalDetail[];
}

/** Anexo normalizado; `digest` é opcional (nem sempre presente na API). */
export interface Attachment {
  id: number;
  filename: string;
  filesize: number;
  content_type?: string;
  description?: string;
  author?: RedmineRef;
  created_on: string;
  content_url: string;
  digest?: string;
}

/** Relação entre issues: `relation_type` + `delay` (ADR-005). */
export interface IssueRelation {
  id: number;
  issue_id: number;
  issue_to_id: number;
  relation_type: string;
  delay?: number | null;
}

/** Referência a uma issue-filha (parent/children). */
export interface IssueChild {
  id: number;
  tracker?: RedmineRef;
  subject?: string;
}

/** Issue normalizada — modelo estável consumido pelas superfícies. */
export interface Issue {
  id: number;
  subject: string;
  description?: string;
  project: RedmineRef;
  tracker: RedmineRef;
  status: RedmineRef;
  priority: RedmineRef;
  author: RedmineRef;
  assigned_to?: RedmineRef;
  created_on: string;
  updated_on: string;
  done_ratio?: number;
  start_date?: string;
  due_date?: string;
  custom_fields: CustomField[];
  journals: Journal[];
  attachments: Attachment[];
  relations: IssueRelation[];
  parent?: { id: number };
  children: IssueChild[];
  /** Opcional: pode faltar por degradação em 403 (ADR-005). */
  watchers?: RedmineRef[];
}

/** Evento de progresso incremental emitido durante uma operação longa. */
export interface ProgressEvent {
  kind: 'progress';
  stage: string;
  message: string;
}

/** Resultado final de uma operação. Sempre o último item do iterable. */
export interface Result<T> {
  kind: 'result';
  value: T;
}

/** União discriminada consumida pelas superfícies. */
export type CoreEvent<T> = ProgressEvent | Result<T>;

/**
 * Operação de exemplo que fixa o padrão de consumo do core.
 *
 * Não implementa nenhum client real — apenas demonstra o contrato:
 * emite progresso incremental e finaliza com um único `Result`.
 *
 * @returns Sequência assíncrona de progresso terminada por um Result.
 * @example
 * for await (const event of demoOperation()) {
 *   if (event.kind === 'result') console.log(event.value);
 * }
 */
export async function* demoOperation(): AsyncIterable<ProgressEvent | Result<string>> {
  yield { kind: 'progress', stage: 'start', message: 'iniciando operação' };
  yield { kind: 'progress', stage: 'work', message: 'processando' };
  yield { kind: 'result', value: 'done' };
}
