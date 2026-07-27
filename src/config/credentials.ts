/**
 * Credential store da api_key por instância (M1-08).
 *
 * Persiste a api_key em um arquivo JSON `{ "<instance>": { "apiKey": "..." } }`
 * com permissão `0600` dentro de um diretório `0700` — uma entrada por URL base
 * normalizada, suportando múltiplas instâncias Redmine. O caminho padrão vem de
 * `env-paths` (diretório de config do usuário).
 *
 * A resolução segue a cascata do ADR-003: keychain → arquivo → variável de
 * ambiente `REDMINE_API_KEY` (o env é sempre aceito, para CI/MCP headless). A
 * interface {@link CredentialStore} (get/set/delete) é comum a todas as
 * implementações; a {@link MigratingCredentialCascade} as consulta em ordem e,
 * quando o keychain está disponível, migra a chave do arquivo para ele.
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

import type { Logger } from '../client/index.js';

import { KeyringCredentialStore, type KeyringModuleLoader } from './keyring.js';

/** Logger no-op: usado quando nenhum logger é injetado. */
const noopLogger: Logger = { warn: () => undefined };

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

/**
 * Cascata de credenciais M2 com migração para o keychain (ADR-003).
 *
 * A resolução (`get`) segue a ordem keychain → arquivo `0600` → env; o primeiro
 * valor encontrado vence. Quando a chave vem do ARQUIVO e o keychain está
 * DISPONÍVEL, a chave é migrada — gravada no keychain e só então removida do
 * arquivo (a remoção é condicionada à confirmação da gravação, evitando perda da
 * credencial se o keychain degradar) — com um único aviso informativo por
 * cascata. As escritas (`set`) preferem o keychain quando disponível, com
 * fallback para o arquivo; o env é somente leitura. A api_key nunca é logada.
 */
export class MigratingCredentialCascade implements CredentialStore {
  private readonly keyring: KeyringCredentialStore;
  private readonly file: CredentialStore;
  private readonly env: CredentialStore;
  private readonly logger: Logger;
  /** Garante que o aviso de migração seja emitido uma única vez por cascata. */
  private migrationWarned = false;

  /**
   * @param keyring - Store do keychain nativo (fonte prioritária e destino da migração).
   * @param file - Store de arquivo `0600` (fallback e origem da migração).
   * @param env - Store de ambiente somente leitura (fallback headless).
   * @param logger - Logger do aviso único de migração; default no-op.
   */
  constructor(
    keyring: KeyringCredentialStore,
    file: CredentialStore,
    env: CredentialStore,
    logger: Logger = noopLogger,
  ) {
    this.keyring = keyring;
    this.file = file;
    this.env = env;
    this.logger = logger;
  }

  /** @inheritdoc */
  async get(instance: string): Promise<string | undefined> {
    const fromKeyring = await this.keyring.get(instance);
    if (fromKeyring !== undefined) {
      return fromKeyring;
    }
    const fromFile = await this.file.get(instance);
    if (fromFile !== undefined) {
      await this.migrateFromFile(instance, fromFile);
      return fromFile;
    }
    return this.env.get(instance);
  }

  /** @inheritdoc */
  async set(instance: string, apiKey: string): Promise<void> {
    if (await this.keyring.isAvailable()) {
      await this.keyring.set(instance, apiKey);
      // Só considera o keychain o dono da credencial se a gravação se confirmou;
      // caso contrário (degradação de runtime) persiste no arquivo.
      if ((await this.keyring.get(instance)) === apiKey) {
        return;
      }
    }
    await this.file.set(instance, apiKey);
  }

  /** @inheritdoc */
  async delete(instance: string): Promise<void> {
    // Remove de ambas as fontes graváveis para não deixar credencial órfã.
    await this.keyring.delete(instance);
    await this.file.delete(instance);
  }

  /**
   * Identifica QUAL fonte resolveria a credencial da instância (keychain →
   * arquivo → env), sem expor a api_key e SEM disparar a migração
   * arquivo→keychain feita por {@link get} — diagnóstico somente-leitura
   * usado pela tela `doctor` da TUI (#35), que só precisa mostrar o método em
   * uso, nunca o segredo.
   *
   * @param instance - URL base da instância (será normalizada pelos stores).
   * @returns A fonte em uso, ou `'none'` se nenhuma tiver a credencial.
   */
  async describeSource(instance: string): Promise<CredentialSourceKind> {
    if ((await this.keyring.get(instance)) !== undefined) {
      return 'keyring';
    }
    if ((await this.file.get(instance)) !== undefined) {
      return 'file';
    }
    if ((await this.env.get(instance)) !== undefined) {
      return 'env';
    }
    return 'none';
  }

  /**
   * Migra a chave do arquivo para o keychain quando este está disponível. A
   * remoção do arquivo só ocorre após confirmar a gravação no keychain, evitando
   * perda da credencial se a escrita degradar. Emite um único aviso, sem expor a
   * api_key.
   *
   * @param instance - URL base da instância (será normalizada pelos stores).
   * @param apiKey - Chave lida do arquivo a ser migrada.
   */
  private async migrateFromFile(instance: string, apiKey: string): Promise<void> {
    if (!(await this.keyring.isAvailable())) {
      return;
    }
    await this.keyring.set(instance, apiKey);
    if ((await this.keyring.get(instance)) !== apiKey) {
      return;
    }
    await this.file.delete(instance);
    if (!this.migrationWarned) {
      this.migrationWarned = true;
      this.logger.warn(
        `Credencial de ${instance} migrada do arquivo local para o keychain do SO.`,
      );
    }
  }
}

/**
 * Fonte que resolveria a credencial de uma instância na cascata M2, sem
 * expor a api_key em si (consumido pela tela `doctor` da TUI, #35).
 * `'none'` quando nenhuma das três fontes tem a credencial.
 */
export type CredentialSourceKind = 'keyring' | 'file' | 'env' | 'none';

/** Opções de {@link createCredentialCascade} / {@link resolveApiKey}. */
export interface CredentialCascadeOptions {
  /** Caminho do arquivo de credenciais; default via `env-paths`. */
  filePath?: string;
  /** Nome da variável de ambiente; default `REDMINE_API_KEY`. */
  envVarName?: string;
  /** Ambiente a consultar; default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Logger para o aviso único de migração; default no-op. */
  logger?: Logger;
  /** Service do keychain; default `redmine-context`. */
  keyringService?: string;
  /** Carregador do módulo nativo do keychain; injetável em testes. */
  keyringLoader?: KeyringModuleLoader;
  /**
   * Permite a credencial de AMBIENTE (`REDMINE_API_KEY`) como fallback. Default
   * `true` (retrocompatível). SEGURANÇA (#187): a env-key é INSTANCE-AGNÓSTICA
   * (o `EnvCredentialStore` a devolve para QUALQUER URL). Quando a URL da
   * instância vem de uma fonte MUTÁVEL/menos confiável (ex.: `settings.json`
   * persistido, origem `config`), passe `false` — assim uma URL adulterada não
   * pode fazer a chave real ser enviada a um host arbitrário; só credencial
   * PINADA à instância (keychain/arquivo) é aceita (fail-closed).
   */
  allowEnvFallback?: boolean;
}

/**
 * Monta a cascata M2 (keychain → arquivo → env `REDMINE_API_KEY`), com migração
 * automática do arquivo para o keychain na resolução (ADR-003).
 *
 * @param options - Ver {@link CredentialCascadeOptions}.
 * @returns Uma {@link MigratingCredentialCascade} pronta para uso.
 */
/**
 * Singleton do store default do keychain, memoizado por processo: servidores
 * de longa duração (MCP) montam uma cascata por request, e recriar o store a
 * cada chamada repetiria o aviso de "keychain indisponível" a cada tool call
 * (o dedupe do aviso é por instância).
 */
let defaultKeyringStore: KeyringCredentialStore | undefined;

export function createCredentialCascade(
  options: CredentialCascadeOptions = {},
): MigratingCredentialCascade {
  const logger = options.logger ?? noopLogger;
  const customKeyring =
    options.keyringService !== undefined || options.keyringLoader !== undefined;
  const keyring = customKeyring
    ? new KeyringCredentialStore({
        logger,
        ...(options.keyringService !== undefined ? { service: options.keyringService } : {}),
        ...(options.keyringLoader !== undefined ? { loader: options.keyringLoader } : {}),
      })
    : (defaultKeyringStore ??= new KeyringCredentialStore({ logger }));
  const file = new FileCredentialStore(
    options.filePath !== undefined ? { filePath: options.filePath } : {},
  );
  // allowEnvFallback === false → env store sobre um ambiente VAZIO: nunca resolve
  // a `REDMINE_API_KEY` (instance-agnóstica). Usado quando a URL veio de fonte
  // mutável (settings.json persistido, #187) — só credencial pinada é aceita.
  const envSource: NodeJS.ProcessEnv =
    options.allowEnvFallback === false ? {} : (options.env ?? process.env);
  const env = new EnvCredentialStore({
    ...(options.envVarName !== undefined ? { varName: options.envVarName } : {}),
    env: envSource,
  });
  return new MigratingCredentialCascade(keyring, file, env, logger);
}

/**
 * Resolve a api_key de uma instância pela cascata M2 (keychain → arquivo → env),
 * migrando do arquivo para o keychain quando este estiver disponível.
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

/**
 * Identifica a fonte que resolveria a credencial de uma instância na cascata
 * M2 (keychain → arquivo → env), SEM expor a api_key e sem migrar do arquivo
 * para o keychain — ver {@link MigratingCredentialCascade.describeSource}.
 * Usada pela tela `doctor` da TUI (#35) para relatar o método de credencial
 * em uso.
 *
 * @param instance - URL base da instância (será normalizada).
 * @param options - Ver {@link CredentialCascadeOptions}.
 * @returns A fonte em uso ('keyring' | 'file' | 'env'), ou 'none'.
 * @example
 * const source = await describeCredentialSource('https://redmine.example');
 */
export async function describeCredentialSource(
  instance: string,
  options: CredentialCascadeOptions = {},
): Promise<CredentialSourceKind> {
  return createCredentialCascade(options).describeSource(instance);
}
