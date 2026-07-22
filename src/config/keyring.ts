/**
 * Credential store da api_key no keychain nativo do SO (M2-14).
 *
 * Implementa a mesma interface {@link CredentialStore} do M1 sobre o keychain do
 * sistema operacional via `@napi-rs/keyring` (macOS Keychain, Windows Credential
 * Manager, libsecret no Linux). O pacote distribui binários pré-compilados pelas
 * próprias `optionalDependencies` por plataforma, então `node-gyp` nunca é
 * acionado numa instalação limpa.
 *
 * O módulo nativo é carregado sob demanda por import dinâmico com `try/catch`: se
 * não houver prebuild para a plataforma (ex.: uma variante `musl` sem binário), o
 * carregamento falha de forma controlada — o store fica indisponível (`get`
 * devolve `undefined`; `set`/`delete` viram no-op) e um único aviso é emitido via
 * logger, permitindo que a cascata siga para o arquivo. Erros do keychain em
 * runtime (ler/gravar/remover) também degradam sem derrubar o processo.
 *
 * O service usado é `redmine-context` e o account é a instância normalizada por
 * {@link normalizeInstanceUrl}, mantendo a mesma chave estável do store de
 * arquivo. A api_key nunca é logada nem incluída em mensagens de aviso.
 *
 * Esta issue apenas introduz o store e suas exportações; a ordem da cascata
 * (keychain → arquivo → env) e a migração ficam para o M2-15 (#38).
 */

import type { Logger } from '../client/index.js';

import { normalizeInstanceUrl, type CredentialStore } from './credentials.js';

/** Especificador do módulo nativo carregado dinamicamente. */
const KEYRING_MODULE = '@napi-rs/keyring';
/** Service padrão registrado no keychain do SO. */
const DEFAULT_SERVICE = 'redmine-context';

/** Logger no-op: usado quando nenhum logger é injetado. */
const noopLogger: Logger = { warn: () => undefined };

/**
 * Superfície mínima da `Entry` de `@napi-rs/keyring` usada por este store.
 * Declarada localmente para permitir mock nos testes e desacoplar do tipo nativo.
 */
export interface KeyringEntry {
  /** Recupera o segredo; `null` (ou erro `NoEntry`) quando não existe. */
  getPassword(): string | null;
  /** Persiste (ou substitui) o segredo desta entrada. */
  setPassword(password: string): void;
  /** Remove a credencial; `false` quando não havia o que remover. */
  deleteCredential(): boolean;
}

/** Superfície mínima do módulo `@napi-rs/keyring`: apenas o construtor `Entry`. */
export interface KeyringModule {
  /** Construtor de uma entrada para `(service, account)`. */
  Entry: new (service: string, account: string) => KeyringEntry;
}

/**
 * Carregador do módulo nativo. Injetável para testes; o padrão faz o import
 * dinâmico de `@napi-rs/keyring`.
 */
export type KeyringModuleLoader = () => Promise<KeyringModule>;

/** Loader padrão: import dinâmico do binding nativo. */
const defaultLoader: KeyringModuleLoader = async () => {
  const mod = await import(KEYRING_MODULE);
  return mod as unknown as KeyringModule;
};

/** Opções do {@link KeyringCredentialStore}. */
export interface KeyringCredentialStoreOptions {
  /** Service registrado no keychain; default `redmine-context`. */
  service?: string;
  /** Logger para o aviso único de indisponibilidade/degradação; default no-op. */
  logger?: Logger;
  /** Carregador do módulo nativo; default import dinâmico (injetável em testes). */
  loader?: KeyringModuleLoader;
}

/** Verifica se um erro do keyring é "entrada não encontrada" (NoEntry). */
function isNoEntry(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
  return message.includes('no matching entry') || message.includes('noentry');
}

/**
 * Implementação de {@link CredentialStore} sobre o keychain nativo do SO.
 *
 * Todas as operações degradam de forma segura: indisponibilidade do módulo ou
 * erros de runtime do keychain nunca derrubam o processo — `get` devolve
 * `undefined` e `set`/`delete` viram no-op, com aviso via logger.
 */
export class KeyringCredentialStore implements CredentialStore {
  private readonly service: string;
  private readonly logger: Logger;
  private readonly loader: KeyringModuleLoader;
  /** Import memoizado: resolve para o módulo ou `undefined` se indisponível. */
  private modulePromise: Promise<KeyringModule | undefined> | undefined;
  /** Garante que o aviso de indisponibilidade seja emitido uma única vez. */
  private unavailableWarned = false;

  /** @param options - Ver {@link KeyringCredentialStoreOptions}. */
  constructor(options: KeyringCredentialStoreOptions = {}) {
    this.service = options.service ?? DEFAULT_SERVICE;
    this.logger = options.logger ?? noopLogger;
    this.loader = options.loader ?? defaultLoader;
  }

  /** @inheritdoc */
  async get(instance: string): Promise<string | undefined> {
    const entry = await this.entryFor(instance);
    if (entry === undefined) {
      return undefined;
    }
    try {
      const value = entry.getPassword();
      return value !== null && value.length > 0 ? value : undefined;
    } catch (cause) {
      if (isNoEntry(cause)) {
        return undefined;
      }
      this.warnRuntime('ler', cause);
      return undefined;
    }
  }

  /** @inheritdoc */
  async set(instance: string, apiKey: string): Promise<void> {
    const entry = await this.entryFor(instance);
    if (entry === undefined) {
      return;
    }
    try {
      entry.setPassword(apiKey);
    } catch (cause) {
      this.warnRuntime('gravar', cause);
    }
  }

  /** @inheritdoc */
  async delete(instance: string): Promise<void> {
    const entry = await this.entryFor(instance);
    if (entry === undefined) {
      return;
    }
    try {
      entry.deleteCredential();
    } catch (cause) {
      // Remover uma entrada ausente é um no-op esperado, não um erro.
      if (isNoEntry(cause)) {
        return;
      }
      this.warnRuntime('remover', cause);
    }
  }

  /** Constrói a `Entry` para a instância, ou `undefined` se indisponível. */
  private async entryFor(instance: string): Promise<KeyringEntry | undefined> {
    const mod = await this.load();
    if (mod === undefined) {
      return undefined;
    }
    const account = normalizeInstanceUrl(instance);
    try {
      return new mod.Entry(this.service, account);
    } catch (cause) {
      this.warnRuntime('inicializar', cause);
      return undefined;
    }
  }

  /** Carrega (uma vez) o módulo nativo; `undefined` se não houver prebuild. */
  private async load(): Promise<KeyringModule | undefined> {
    this.modulePromise ??= this.loader().then(
      (mod) => mod,
      (cause: unknown) => {
        this.warnUnavailable(cause);
        return undefined;
      },
    );
    return this.modulePromise;
  }

  /** Emite (uma única vez) o aviso de módulo indisponível. */
  private warnUnavailable(cause: unknown): void {
    if (this.unavailableWarned) {
      return;
    }
    this.unavailableWarned = true;
    const reason = cause instanceof Error ? cause.message : String(cause);
    this.logger.warn(
      `Keychain nativo indisponível (${reason}); as credenciais seguirão pelo arquivo. ` +
        'Instale o prebuild de @napi-rs/keyring para esta plataforma para usar o keychain do SO.',
    );
  }

  /** Emite um aviso de degradação de runtime — sem nunca expor a api_key. */
  private warnRuntime(action: string, cause: unknown): void {
    const reason = cause instanceof Error ? cause.message : String(cause);
    this.logger.warn(`Falha ao ${action} a credencial no keychain do SO: ${reason}.`);
  }
}
