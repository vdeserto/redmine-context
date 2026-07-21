/**
 * Credential store da api_key por instância (M1-08).
 *
 * Persiste a api_key em um arquivo JSON `{ "<instance>": { "apiKey": "..." } }`
 * com permissão `0600` dentro de um diretório `0700` — uma entrada por URL base
 * normalizada, suportando múltiplas instâncias Redmine. O caminho padrão vem de
 * `env-paths` (diretório de config do usuário).
 *
 * A resolução segue a cascata M1: arquivo → variável de ambiente
 * `REDMINE_API_KEY` (o env é sempre aceito, para CI/MCP headless). A interface
 * {@link CredentialStore} (get/set/delete) é a mesma que o keychain do M2 vai
 * implementar; a cascata consulta as implementações em ordem.
 *
 * A api_key nunca é logada e nunca aparece em mensagens de erro — os erros de
 * permissão carregam apenas caminhos e o comando `chmod` a ser executado. A
 * verificação de permissão POSIX fica atrás de `process.platform !== 'win32'`
 * porque o Windows não tem o mesmo modelo de bits `0600` (o hardening real do
 * Windows é o M5-08).
 */

import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import envPaths from 'env-paths';

/** Permissão do diretório: `rwx` só para o dono. */
const DIR_MODE = 0o700;
/** Permissão do arquivo: `rw` só para o dono. */
const FILE_MODE = 0o600;
/** Nome do arquivo de credenciais no diretório de config. */
const CREDENTIALS_FILENAME = 'credentials.json';
/** Variável de ambiente consultada na cascata (fallback headless). */
const DEFAULT_ENV_VAR = 'REDMINE_API_KEY';

// Windows não tem o modelo POSIX de bits 0600/0700; o hardening real é o M5-08.
const PERMISSIONS_ENFORCED = process.platform !== 'win32';

/**
 * Contrato de armazenamento de api_key por instância. A implementação de
 * arquivo (M1) e a de keychain (M2) satisfazem esta interface, o que permite à
 * cascata tratá-las de forma uniforme.
 */
export interface CredentialStore {
  /**
   * Recupera a api_key da instância, ou `undefined` se não houver.
   * @param instance - URL base da instância (será normalizada).
   */
  get(instance: string): Promise<string | undefined>;
  /**
   * Persiste (ou substitui) a api_key da instância.
   * @param instance - URL base da instância (será normalizada).
   * @param apiKey - api_key a armazenar.
   */
  set(instance: string, apiKey: string): Promise<void>;
  /**
   * Remove a api_key da instância; no-op se não existir.
   * @param instance - URL base da instância (será normalizada).
   */
  delete(instance: string): Promise<void>;
}

/** Erro do credential store — sempre construído sem expor a api_key. */
export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Uma entrada do arquivo de credenciais. */
interface CredentialEntry {
  /** api_key da instância. */
  apiKey: string;
}

/** Conteúdo do arquivo: mapa de instância normalizada para entrada. */
type CredentialsFile = Record<string, CredentialEntry>;

/**
 * Normaliza a URL base de uma instância para uma chave estável.
 *
 * Aplica minúsculas (protocolo e host), remove a porta padrão (443 p/ https, 80
 * p/ http), remove a barra final e preserva o subpath. Mantém a mesma ideia do
 * futuro `instance_hash`: formas equivalentes colapsam na mesma chave.
 *
 * @param instance - URL base da instância (ex.: `https://Redmine.Example/`).
 * @returns A URL normalizada (ex.: `https://redmine.example`).
 * @throws {TypeError} Se `instance` não for uma URL válida.
 * @example
 * normalizeInstanceUrl('HTTPS://Redmine.Example:443/'); // 'https://redmine.example'
 */
export function normalizeInstanceUrl(instance: string): string {
  const parsed = new URL(instance);
  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const isDefaultPort =
    (protocol === 'https:' && parsed.port === '443') ||
    (protocol === 'http:' && parsed.port === '80');
  const port = parsed.port !== '' && !isDefaultPort ? `:${parsed.port}` : '';
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${protocol}//${host}${port}${path}`;
}

/** Formata bits de permissão como octal de 3 dígitos (ex.: `644`). */
function toOctal(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, '0');
}

/** Verifica se um erro do fs é "arquivo não encontrado" (ENOENT). */
function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: string }).code === 'ENOENT'
  );
}

/** Faz o parse defensivo do arquivo, descartando entradas malformadas. */
function parseCredentials(raw: string, filePath: string): CredentialsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSON inválido não pode ser ignorado em silêncio (a key "sumiria"):
    // erro tipado orienta a correção sem expor o conteúdo do arquivo.
    throw new CredentialStoreError(
      `Arquivo de credenciais corrompido (JSON inválido): ${filePath}. ` +
        'Corrija ou remova o arquivo e faça login novamente.',
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const result: CredentialsFile = {};
  for (const [instance, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof entry === 'object' && entry !== null) {
      const apiKey = (entry as Record<string, unknown>).apiKey;
      if (typeof apiKey === 'string' && apiKey.length > 0) {
        result[instance] = { apiKey };
      }
    }
  }
  return result;
}

/** Caminho padrão do arquivo de credenciais (diretório de config do usuário). */
export function defaultCredentialsPath(): string {
  return join(envPaths('redmine-context').config, CREDENTIALS_FILENAME);
}

/** Opções do {@link FileCredentialStore}. */
export interface FileCredentialStoreOptions {
  /** Caminho do arquivo; default via `env-paths`. Útil para testes. */
  filePath?: string;
}

/**
 * Implementação de {@link CredentialStore} baseada em arquivo `0600` num
 * diretório `0700`. Verifica as permissões ao ler (boot) e as reaplica ao
 * escrever, independentemente do umask.
 */
export class FileCredentialStore implements CredentialStore {
  private readonly filePath: string;

  /** @param options - Ver {@link FileCredentialStoreOptions}. */
  constructor(options: FileCredentialStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultCredentialsPath();
  }

  /** @inheritdoc */
  async get(instance: string): Promise<string | undefined> {
    const store = await this.read();
    if (store === undefined) {
      return undefined;
    }
    return store[normalizeInstanceUrl(instance)]?.apiKey;
  }

  /** @inheritdoc */
  async set(instance: string, apiKey: string): Promise<void> {
    const store = (await this.read()) ?? {};
    store[normalizeInstanceUrl(instance)] = { apiKey };
    await this.write(store);
  }

  /** @inheritdoc */
  async delete(instance: string): Promise<void> {
    const store = await this.read();
    if (store === undefined) {
      return;
    }
    const key = normalizeInstanceUrl(instance);
    if (!(key in store)) {
      return;
    }
    delete store[key];
    await this.write(store);
  }

  /** Lê e valida o arquivo; `undefined` se ainda não existir. */
  private async read(): Promise<CredentialsFile | undefined> {
    let mode: number;
    try {
      mode = (await stat(this.filePath)).mode;
    } catch (cause) {
      if (isNotFound(cause)) {
        return undefined;
      }
      throw cause;
    }
    this.assertSecureMode(mode);
    return parseCredentials(await readFile(this.filePath, 'utf8'), this.filePath);
  }

  /** Escreve o arquivo garantindo dir `0700` e arquivo `0600`. */
  private async write(store: CredentialsFile): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    if (PERMISSIONS_ENFORCED) {
      // Reaplica o modo: `mkdir`/`writeFile` sofrem influência do umask.
      await chmod(dir, DIR_MODE);
    }
    await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: FILE_MODE });
    if (PERMISSIONS_ENFORCED) {
      await chmod(this.filePath, FILE_MODE);
    }
  }

  /** Falha com erro acionável se as permissões do arquivo estiverem erradas. */
  private assertSecureMode(mode: number): void {
    if (!PERMISSIONS_ENFORCED) {
      return;
    }
    const actual = mode & 0o777;
    if (actual !== FILE_MODE) {
      throw new CredentialStoreError(
        `O arquivo de credenciais ${this.filePath} tem permissões ${toOctal(actual)}, ` +
          `mas o esperado é 600 (somente o dono pode ler/escrever). ` +
          `Corrija com: chmod 600 ${this.filePath}`,
      );
    }
  }
}

/** Opções do {@link EnvCredentialStore}. */
export interface EnvCredentialStoreOptions {
  /** Nome da variável de ambiente; default `REDMINE_API_KEY`. */
  varName?: string;
  /** Ambiente a consultar; default `process.env` (injetável em testes). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Implementação de {@link CredentialStore} somente-leitura sobre uma variável
 * de ambiente. É o fallback headless (CI/MCP) da cascata: `get` devolve a chave
 * do env para qualquer instância; `set`/`delete` lançam.
 */
export class EnvCredentialStore implements CredentialStore {
  private readonly varName: string;
  private readonly env: NodeJS.ProcessEnv;

  /** @param options - Ver {@link EnvCredentialStoreOptions}. */
  constructor(options: EnvCredentialStoreOptions = {}) {
    this.varName = options.varName ?? DEFAULT_ENV_VAR;
    this.env = options.env ?? process.env;
  }

  /** @inheritdoc */
  async get(): Promise<string | undefined> {
    const value = this.env[this.varName];
    return value !== undefined && value.length > 0 ? value : undefined;
  }

  /** Somente leitura: sempre lança. */
  async set(): Promise<void> {
    throw new CredentialStoreError(
      `A variável de ambiente ${this.varName} é somente leitura e não pode ser gravada.`,
    );
  }

  /** Somente leitura: sempre lança. */
  async delete(): Promise<void> {
    throw new CredentialStoreError(
      `A variável de ambiente ${this.varName} é somente leitura e não pode ser removida.`,
    );
  }
}

/**
 * Cascata de {@link CredentialStore}: `get` consulta os stores em ordem e
 * devolve o primeiro valor encontrado; escritas vão para o primeiro store (o
 * gravável). A ordem M1 é arquivo → env.
 */
export class CascadingCredentialStore implements CredentialStore {
  private readonly stores: readonly CredentialStore[];

  /**
   * @param stores - Stores em ordem de prioridade (o primeiro é o gravável).
   * @throws {CredentialStoreError} Se a lista estiver vazia.
   */
  constructor(stores: readonly CredentialStore[]) {
    if (stores.length === 0) {
      throw new CredentialStoreError('A cascata de credenciais precisa de ao menos um store.');
    }
    this.stores = stores;
  }

  /** @inheritdoc */
  async get(instance: string): Promise<string | undefined> {
    for (const store of this.stores) {
      const value = await store.get(instance);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  /** @inheritdoc */
  async set(instance: string, apiKey: string): Promise<void> {
    await this.writableStore().set(instance, apiKey);
  }

  /** @inheritdoc */
  async delete(instance: string): Promise<void> {
    await this.writableStore().delete(instance);
  }

  /** O primeiro store da cascata — destino das escritas. */
  private writableStore(): CredentialStore {
    const first = this.stores[0];
    if (first === undefined) {
      throw new CredentialStoreError('A cascata de credenciais está vazia.');
    }
    return first;
  }
}

/** Opções de {@link createCredentialCascade} / {@link resolveApiKey}. */
export interface CredentialCascadeOptions {
  /** Caminho do arquivo de credenciais; default via `env-paths`. */
  filePath?: string;
  /** Nome da variável de ambiente; default `REDMINE_API_KEY`. */
  envVarName?: string;
  /** Ambiente a consultar; default `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Monta a cascata M1 (arquivo → env `REDMINE_API_KEY`).
 *
 * @param options - Ver {@link CredentialCascadeOptions}.
 * @returns Uma {@link CascadingCredentialStore} pronta para uso.
 */
export function createCredentialCascade(
  options: CredentialCascadeOptions = {},
): CascadingCredentialStore {
  const file = new FileCredentialStore(
    options.filePath !== undefined ? { filePath: options.filePath } : {},
  );
  const env = new EnvCredentialStore({
    ...(options.envVarName !== undefined ? { varName: options.envVarName } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
  });
  return new CascadingCredentialStore([file, env]);
}

/**
 * Resolve a api_key de uma instância pela cascata M1 (arquivo → env).
 *
 * @param instance - URL base da instância (será normalizada).
 * @param options - Ver {@link CredentialCascadeOptions}.
 * @returns A api_key resolvida, ou `undefined` se nenhuma fonte a tiver.
 * @example
 * const apiKey = await resolveApiKey('https://redmine.example');
 */
export async function resolveApiKey(
  instance: string,
  options: CredentialCascadeOptions = {},
): Promise<string | undefined> {
  return createCredentialCascade(options).get(instance);
}
