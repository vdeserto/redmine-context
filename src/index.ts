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
  RedmineLoginError,
  type LoginOptions,
  type LoginResult,
} from './config/index.js';
export {
  createCredentialCascade,
  resolveApiKey,
  normalizeInstanceUrl,
  CredentialStoreError,
  type CredentialCascadeOptions,
} from './config/index.js';
