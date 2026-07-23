export const MODULE_NAME = 'config' as const;

export {
  loginWithPassword,
  validateApiKey,
  RedmineLoginError,
  type LoginOptions,
  type LoginResult,
  type ValidateApiKeyOptions,
} from './login.js';

export {
  CascadingCredentialStore,
  CredentialStoreError,
  EnvCredentialStore,
  FileCredentialStore,
  MigratingCredentialCascade,
  createCredentialCascade,
  defaultCredentialsPath,
  describeCredentialSource,
  normalizeInstanceUrl,
  resolveApiKey,
  type CredentialCascadeOptions,
  type CredentialSourceKind,
  type CredentialStore,
  type EnvCredentialStoreOptions,
  type FileCredentialStoreOptions,
} from './credentials.js';

export {
  KeyringCredentialStore,
  type KeyringCredentialStoreOptions,
  type KeyringEntry,
  type KeyringModule,
  type KeyringModuleLoader,
} from './keyring.js';
