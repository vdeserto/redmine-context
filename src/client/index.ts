export const MODULE_NAME = 'client' as const;

export {
  createHttpClient,
  redactSecret,
  type HttpClient,
  type HttpClientOptions,
  type Logger,
  type QueryParams,
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
