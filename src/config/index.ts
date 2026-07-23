export const MODULE_NAME = 'config' as const;

export {
  loginWithPassword,
  RedmineLoginError,
  type LoginOptions,
  type LoginResult,
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
