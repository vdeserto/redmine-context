export const MODULE_NAME = 'client' as const;

export {
  createHttpClient,
  redactSecret,
  validateBaseUrl,
  type HttpClient,
  type HttpClientOptions,
  type Logger,
  type QueryParams,
  type RetryOptions,
} from './http.js';
export {
  RedmineHttpError,
  RedmineAuthError,
  RedmineForbiddenError,
  RedmineNotFoundError,
  httpErrorFor,
} from './errors.js';
export {
  getIssue,
  listIssues,
  type RedmineIssuePayload,
  type ListIssuesOptions,
} from './issues.js';
export {
  searchIssues,
  SEARCH_MAX_LIMIT,
  type SearchIssuesOptions,
  type SearchIssuesPage,
  type RedmineSearchHit,
} from './search.js';
