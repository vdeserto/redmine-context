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

/**
 * Status de uma extração de anexo (ADR-005 — pipeline de extração, M3/M4).
 *
 * Vocabulário único e canônico do core; as superfícies (TUI/CLI/MCP) apenas o
 * consomem. Ver a migração documentada em `src/surfaces/tui/attachment-status.ts`.
 *
 * - `text` — anexo textual (o conteúdo já É o texto, sem OCR/ASR).
 * - `pending` — enfileirado/aguardando, ainda não processado.
 * - `processing` — extração em andamento (job assíncrono).
 * - `done` — extração concluída; `text` (e/ou `artifacts`) disponível(is).
 * - `failed` — extração tentada e falhou (ver `metadata.reason`).
 * - `cancelled` — extração cancelada via `AbortSignal` (o subprocesso foi morto
 *   ou o job pendente não chegou a iniciar) (#69, ADR-005).
 * - `unsupported` — não há extrator registrado para o MIME REAL do arquivo.
 * - `skipped` — pulado deliberadamente (ex.: excede o limite de tamanho, ADR-002).
 */
export type ExtractionStatus =
  | 'text'
  | 'pending'
  | 'processing'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'unsupported'
  | 'skipped';

/**
 * Artefato derivado de uma extração (arquivo produzido e cacheado ao lado do
 * `original` do anexo, ADR-004) — ex.: transcrição, texto de página, thumbnail.
 */
export interface ExtractionArtifact {
  /** Tipo do artefato (ex.: `transcript`, `page-text`, `thumbnail`). */
  kind: string;
  /** Caminho absoluto do artefato no cache local. */
  path: string;
  /** MIME do artefato, quando conhecido. */
  mime?: string;
}

/**
 * Resultado de uma extração de anexo (ADR-005).
 *
 * `status` é sempre presente; `text`/`confidence`/`artifacts` são preenchidos
 * conforme o extrator e o status (ex.: `done` traz `text`; `unsupported`/
 * `skipped` trazem apenas `status` + `metadata`). `mime` carrega o MIME REAL
 * detectado por magic bytes (NUNCA por extensão/Content-Type).
 */
export interface ExtractionResult {
  /** Estado final/atual da extração. */
  status: ExtractionStatus;
  /** Texto extraído (quando `status === 'text'` ou `'done'`). */
  text?: string;
  /** Confiança da extração em [0, 1] (ex.: score de OCR/ASR). */
  confidence?: number;
  /** Artefatos derivados produzidos pela extração. */
  artifacts?: ExtractionArtifact[];
  /** MIME REAL detectado por magic bytes do arquivo baixado. */
  mime?: string;
  /** Metadados livres (ex.: `extractorId`, `version`, `reason`, `declaredMime`). */
  metadata?: Record<string, unknown>;
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
