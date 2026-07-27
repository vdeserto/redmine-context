/**
 * Store de CONFIGURAÇÕES NÃO SECRETAS do usuário (#187).
 *
 * Hoje guarda apenas a **URL da instância** "default/última usada", para que a
 * TUI/CLI/MCP não dependam EXCLUSIVAMENTE de `REDMINE_URL` no ambiente: o `login`
 * persiste a instância autenticada e as superfícies a usam como fallback.
 *
 * Diferente do credential store (ADR-003), aqui NÃO há segredo — a URL não é
 * sensível — então o arquivo usa permissões default (sem `0600`). Fica em
 * `env-paths('redmine-context').config/settings.json`. Parse defensivo: JSON
 * inválido/ausente NUNCA quebra o boot (degrada para "sem configuração"), pois,
 * ao contrário da api_key, nada aqui é irrecuperável.
 *
 * RESOLUÇÃO DA INSTÂNCIA ({@link resolveInstanceUrl}, pura): a ordem de precedência
 * é `--url` (flag) → `REDMINE_URL` (env) → URL persistida. Isso preserva a
 * retrocompatibilidade (flag/env sempre vencem) e a convenção env-first do MCP
 * headless, adicionando a persistência só como último recurso.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import envPaths from 'env-paths';

import { normalizeInstanceUrl } from './credentials.js';

/** Nome do arquivo de settings no diretório de config do usuário. */
const SETTINGS_FILENAME = 'settings.json';

/** Formato persistido (evolutivo; só `instanceUrl` por ora). */
export interface Settings {
  /** URL base da instância "default/última usada" (normalizada ao gravar). */
  instanceUrl?: string;
}

/** Store de settings não-secretas: get/set/clear da URL da instância. */
export interface SettingsStore {
  /** URL da instância persistida, ou `undefined` se nenhuma. */
  getInstanceUrl(): Promise<string | undefined>;
  /** Persiste (normalizada) a URL da instância. */
  setInstanceUrl(url: string): Promise<void>;
  /** Remove a URL da instância persistida; no-op se não existir. */
  clearInstanceUrl(): Promise<void>;
}

/** Caminho padrão do arquivo de settings (diretório de config do usuário). */
export function defaultSettingsPath(): string {
  return join(envPaths('redmine-context').config, SETTINGS_FILENAME);
}

/** Verifica se um erro do fs é "arquivo não encontrado" (ENOENT). */
function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: string }).code === 'ENOENT'
  );
}

/** Opções do {@link FileSettingsStore}. */
export interface FileSettingsStoreOptions {
  /** Caminho do arquivo; default via `env-paths`. Útil para testes. */
  filePath?: string;
}

/**
 * {@link SettingsStore} baseado num arquivo JSON não-secreto. Leitura defensiva
 * (ENOENT/JSON inválido → sem configuração); escrita cria o diretório sob demanda.
 */
export class FileSettingsStore implements SettingsStore {
  private readonly filePath: string;

  constructor(options: FileSettingsStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultSettingsPath();
  }

  /**
   * Lê o objeto BRUTO do arquivo (preservando chaves desconhecidas para
   * forward-compat); qualquer problema degrada para `{}` (nunca lança).
   */
  private async readRaw(): Promise<Record<string, unknown>> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (cause) {
      if (isNotFound(cause)) return {};
      throw cause;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Config não-secreta: JSON corrompido degrada para "sem config" (a URL é
      // re-obtida no próximo login), em vez de travar o boot como no credential store.
      return {};
    }
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  }

  /**
   * Escreve o objeto ATOMICAMENTE (arquivo temp + `rename`), criando o diretório
   * sob demanda. O `rename` no mesmo diretório é atômico nos SOs suportados —
   * evita deixar um `settings.json` truncado se o processo morrer no meio da escrita.
   */
  private async write(data: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
    await rename(tmp, this.filePath);
  }

  async getInstanceUrl(): Promise<string | undefined> {
    const url = (await this.readRaw()).instanceUrl;
    // Rejeita string vazia OU só-whitespace (ex.: settings.json editado à mão) —
    // mesma semântica do `nonEmpty()` do resolvedor, evitando um baseUrl de espaços.
    const trimmed = typeof url === 'string' ? url.trim() : '';
    return trimmed.length > 0 ? trimmed : undefined;
  }

  async setInstanceUrl(url: string): Promise<void> {
    const normalized = normalizeInstanceUrl(url);
    const data = await this.readRaw();
    data.instanceUrl = normalized;
    await this.write(data);
  }

  async clearInstanceUrl(): Promise<void> {
    const data = await this.readRaw();
    if (!('instanceUrl' in data)) return;
    delete data.instanceUrl;
    await this.write(data);
  }
}

/** {@link SettingsStore} padrão (arquivo em `env-paths().config`). */
export function defaultSettingsStore(): SettingsStore {
  return new FileSettingsStore();
}

/** Origem de onde a URL da instância foi resolvida (para diagnóstico/UX). */
export type InstanceUrlOrigin = 'flag' | 'env' | 'config';

/** URL da instância resolvida + de onde veio. */
export interface ResolvedInstanceUrl {
  /** URL base da instância. */
  url: string;
  /** Origem: `flag` (--url), `env` (REDMINE_URL) ou `config` (persistida). */
  origin: InstanceUrlOrigin;
}

/** Retorna a string aparada se não-vazia, senão `undefined`. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve a URL da instância por precedência: `--url` → `REDMINE_URL` → persistida.
 * Função PURA — o chamador carrega a URL persistida (assíncrona) e a injeta aqui.
 *
 * @param opts - `flagUrl` (--url), `envUrl` (REDMINE_URL) e `persistedUrl` (settings).
 * @returns A URL resolvida + origem, ou `undefined` se nenhuma fonte tiver valor.
 * @example
 * resolveInstanceUrl({ envUrl: 'https://r.example' }); // { url: 'https://r.example', origin: 'env' }
 */
export function resolveInstanceUrl(opts: {
  flagUrl?: string | undefined;
  envUrl?: string | undefined;
  persistedUrl?: string | undefined;
}): ResolvedInstanceUrl | undefined {
  const flag = nonEmpty(opts.flagUrl);
  if (flag !== undefined) return { url: flag, origin: 'flag' };
  const env = nonEmpty(opts.envUrl);
  if (env !== undefined) return { url: env, origin: 'env' };
  const persisted = nonEmpty(opts.persistedUrl);
  if (persisted !== undefined) return { url: persisted, origin: 'config' };
  return undefined;
}
