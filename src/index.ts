export const TOOL_NAME = 'redmine-context';
// Manter em sincronia com package.json (automatizado no empacotamento do M5).
export const TOOL_VERSION = '0.1.0';

// Superfície pública do core: contrato de tipos + padrão de progresso (ADR-005).
// As superfícies devem consumir o core somente por aqui / por ./contract.js.
export * from './contract.js';

// Orquestração get → normalize → bundle reutilizável por CLI (#17) e MCP (#18).
export {
  fetchIssueBundle,
  type BundleFormat,
  type FetchIssueBundleOptions,
  type IssueBundleResult,
} from './fetch-issue-bundle.js';

// Orquestração de extração de anexos (M3-10): baixa → dispatcher → extrator →
// cache → Map<attachmentId, ExtractionResult>, embutida nos bundles pela flag
// `extractAttachments` de `fetchIssueBundle`. CLI/MCP ligam a flag na #55.
export {
  extractIssueAttachments,
  type ExtractIssueAttachmentsOptions,
} from './extract-issue-attachments.js';

// Orquestração get → normalize → extração de UM anexo (M3-13): reutiliza o
// pipeline com cache de `extractIssueAttachments` para a tool MCP read-only
// `get_attachment_text` (#55). Devolve o ExtractionResult do anexo pedido.
export {
  fetchAttachmentText,
  AttachmentNotFoundError,
  type FetchAttachmentTextOptions,
  type AttachmentTextResult,
} from './fetch-attachment-text.js';

// Orquestração de busca (filtros + full-text best-effort) para a tool MCP (#19).
export {
  fetchIssueSearch,
  SEARCH_DEFAULT_LIMIT,
  type FetchIssueSearchOptions,
  type IssueSearchFilters,
  type IssueSearchResult,
} from './fetch-issue-search.js';

// Primitiva full-text `/search.json` (usada pela orquestração acima).
export { searchIssues, type SearchIssuesOptions, type SearchIssuesPage } from './client/index.js';

// Client HTTP base (auth por api_key + retry) — usado por telas que precisam
// montar suas próprias chamadas ao core sem uma orquestração pronta (ex.: a
// home da TUI, #29, que lista "minhas issues" via `listIssues` abaixo).
export {
  createHttpClient,
  type HttpClient,
  type HttpClientOptions,
  type QueryParams,
} from './client/index.js';

// Listagem paginada de issues (`GET /issues.json`), payload bruto sem
// normalização — usada pela home da TUI (#29) com o filtro `assigned_to_id=me`.
export { listIssues, type ListIssuesOptions, type RedmineIssuePayload } from './client/index.js';

// Detalhe completo de uma issue (`GET /issues/{id}.json`), payload bruto sem
// normalização — usado pela tela de detalhe da TUI (#31), que normaliza com
// `normalizeIssue` abaixo para render o modelo estável `Issue` (sem passar
// pelo bundle Markdown/JSON, que é o formato de saída da CLI/MCP, não do
// modelo em memória que a TUI precisa para paginar/rolar o conteúdo).
export { getIssue } from './client/index.js';

// Normalização do payload bruto de issue no modelo estável `Issue` do
// contrato — usada por `fetchIssueBundle` (CLI/MCP) e, desde a #31, também
// diretamente pela tela de detalhe da TUI (`getIssue` + `normalizeIssue`,
// sem serializar para Markdown/JSON).
export { normalizeIssue } from './normalize/index.js';

// Empacotamento Markdown/JSON direto (M1-09/M1-10) — usado por
// `fetchIssueBundle` internamente e, desde a #33, também diretamente pela
// tela de exportação da TUI: a issue já está normalizada em memória (`./use-issue-detail.js`,
// #31), então gravar o bundle não precisa refazer a busca+normalização via
// `fetchIssueBundle` — só empacotar o que já foi carregado.
export {
  buildMarkdownBundle,
  buildJsonBundle,
  fenceBlock,
  type MarkdownBundleMeta,
  type JsonBundle,
  type JsonBundleEnvelope,
  type JsonBundleMeta,
  type JsonBundleSource,
} from './bundle/index.js';

// Erros HTTP tipados — usados pelas superfícies para mapear exit codes (ADR-005).
export {
  RedmineHttpError,
  RedmineAuthError,
  RedmineForbiddenError,
  RedmineNotFoundError,
} from './client/index.js';

// Login por senha (M1-07) e cascata de credenciais (M1-08) para as superfícies.
export {
  loginWithPassword,
  validateApiKey,
  RedmineLoginError,
  type LoginOptions,
  type LoginResult,
  type ValidateApiKeyOptions,
} from './config/index.js';
export {
  createCredentialCascade,
  resolveApiKey,
  describeCredentialSource,
  normalizeInstanceUrl,
  CredentialStoreError,
  type CredentialCascadeOptions,
  type CredentialSourceKind,
} from './config/index.js';

// Diagnóstico de binários de mídia (M3-11, #53) — núcleo do comando `doctor`
// (CLI) e da seção "Binários de mídia" da TUI. Detecção do tesseract + hint de
// instalação por SO (ADR-002).
export {
  diagnoseBinaries,
  tesseractInstallHint,
  pdftotextInstallHint,
  type BinaryDiagnosis,
  type DiagnoseBinariesOptions,
} from './config/index.js';
