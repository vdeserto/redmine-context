/**
 * Índice por instância do {@link ../cache/disk.js DiskCacheStore} (M3-05.1,
 * ADR-004): `<cache_dir>/<instance_hash>/index.json` registra, por entrada da
 * camada de ATTACHMENT, a chave serializada, o tamanho em bytes, o tipo
 * (`original` | `extraction`) e o `last_accessed_at` — é o insumo do GC/LRU
 * (#47). Entradas issue-level NÃO são indexadas (baratas de reconstruir).
 *
 * Semântica de escrita:
 * - `recordPut`/`remove` persistem imediatamente (write-then-rename atômico);
 * - `recordAccess` (get) só atualiza um BUFFER em memória — a janela de perda
 *   (acessos entre o último flush e um crash) é aceita: o pior caso é o LRU
 *   enxergar um item como "mais antigo" do que realmente é. O flush acontece
 *   no próximo `recordPut`/`remove`/`flushAll` (chamado pelo gc()).
 *
 * Resiliência: índice corrompido ou ausente é RECONSTRUÍDO varrendo os
 * arquivos de valor da instância. As entradas do registro são chaveadas pelo
 * NOME DO ARQUIVO de valor (sha256 da chave serializada) — assim a
 * reconstrução (que não consegue reverter o hash para a chave) e as operações
 * normais colidem no MESMO registro, sem duplicar; `entry.key` guarda a chave
 * serializada quando conhecida (após reconstrução, o nome do arquivo fica como
 * valor opaco até o próximo put daquela chave).
 */

import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/** Nome do arquivo de índice, ao lado dos diretórios de anexo da instância. */
export const INDEX_FILE_NAME = 'index.json';

/** Versão do schema do índice (evolução futura sem quebrar leitores). */
const INDEX_VERSION = 1;

/** Tipo de uma entrada indexada — quotas separadas no GC (#47). */
export type CacheEntryType = 'original' | 'extraction';

/** Uma entrada do índice por instância. */
export interface CacheIndexEntry {
  /** Chave serializada (opaca — nome do arquivo — após reconstrução). */
  key: string;
  /** Tamanho do valor em bytes, como gravado em disco. */
  size: number;
  /** Classificação para as quotas do GC. */
  type: CacheEntryType;
  /** ISO 8601 do último acesso conhecido (ver janela de perda no topo). */
  lastAccessedAt: string;
}

/** Forma do `index.json` persistido. */
interface IndexFile {
  version: number;
  entries: Record<string, CacheIndexEntry>;
}

/** Estado em memória do índice de UMA instância. */
interface InstanceIndex {
  entries: Map<string, CacheIndexEntry>;
  /** Acessos bufferizados (recordKey -> ISO) ainda não persistidos. */
  pendingAccess: Map<string, string>;
  loaded: boolean;
}

/** Logger mínimo (padrão do repo). */
interface IndexLogger {
  warn(message: string): void;
}

/**
 * Gerência dos índices por instância de um `DiskCacheStore`.
 * Uma instância desta classe pertence a UM store (mesmo `root`).
 */
export class DiskCacheIndex {
  private readonly root: string;
  private readonly logger: IndexLogger;
  private readonly instances = new Map<string, InstanceIndex>();

  constructor(root: string, logger: IndexLogger = { warn: () => undefined }) {
    this.root = root;
    this.logger = logger;
  }

  /** Registra (ou substitui) a entrada de um put — persiste imediatamente. */
  async recordPut(
    instanceHash: string,
    recordKey: string,
    entry: CacheIndexEntry,
  ): Promise<void> {
    const index = await this.load(instanceHash);
    index.entries.set(recordKey, entry);
    index.pendingAccess.delete(recordKey);
    await this.persist(instanceHash, index);
  }

  /** Bufferiza a atualização de `last_accessed_at` de um get (throttled). */
  recordAccess(instanceHash: string, recordKey: string): void {
    const index = this.instances.get(instanceHash);
    const at = new Date().toISOString();
    if (index !== undefined && index.loaded) {
      index.pendingAccess.set(recordKey, at);
      return;
    }
    // Instância ainda não carregada: registra num índice lazy para o próximo
    // flush carregar e mesclar.
    const lazy = this.ensure(instanceHash);
    lazy.pendingAccess.set(recordKey, at);
  }

  /** Remove a entrada de um invalidate — persiste imediatamente. */
  async remove(instanceHash: string, recordKey: string): Promise<void> {
    const index = await this.load(instanceHash);
    index.entries.delete(recordKey);
    index.pendingAccess.delete(recordKey);
    await this.persist(instanceHash, index);
  }

  /** Faz flush de TODOS os buffers pendentes (chamado pelo gc()). */
  async flushAll(): Promise<void> {
    for (const instanceHash of this.instances.keys()) {
      const index = await this.load(instanceHash);
      if (index.pendingAccess.size === 0) {
        continue;
      }
      await this.persist(instanceHash, index);
    }
  }

  /** Entradas atuais de uma instância (para o GC/LRU do #47). */
  async entriesOf(instanceHash: string): Promise<ReadonlyMap<string, CacheIndexEntry>> {
    const index = await this.load(instanceHash);
    return index.entries;
  }

  private ensure(instanceHash: string): InstanceIndex {
    let index = this.instances.get(instanceHash);
    if (index === undefined) {
      index = { entries: new Map(), pendingAccess: new Map(), loaded: false };
      this.instances.set(instanceHash, index);
    }
    return index;
  }

  /** Carrega (lazy) o índice de uma instância, reconstruindo se necessário. */
  private async load(instanceHash: string): Promise<InstanceIndex> {
    const index = this.ensure(instanceHash);
    if (index.loaded) {
      return index;
    }
    const filePath = join(this.root, instanceHash, INDEX_FILE_NAME);
    let parsed: IndexFile | undefined;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8')) as IndexFile;
    } catch (cause) {
      if ((cause as { code?: string }).code !== 'ENOENT') {
        this.logger.warn(`cache: índice corrompido em ${filePath} — reconstruindo do disco`);
      }
      parsed = undefined;
    }
    if (parsed !== undefined && typeof parsed === 'object' && parsed.entries !== undefined) {
      for (const [recordKey, entry] of Object.entries(parsed.entries)) {
        index.entries.set(recordKey, entry);
      }
    } else {
      await this.rebuild(instanceHash, index);
    }
    index.loaded = true;
    return index;
  }

  /** Reconstrói o índice varrendo os arquivos de valor da instância. */
  private async rebuild(instanceHash: string, index: InstanceIndex): Promise<void> {
    const attachmentsDir = join(this.root, instanceHash, 'attachments');
    let dirs: string[];
    try {
      dirs = await readdir(attachmentsDir);
    } catch {
      return; // instância sem anexos: índice vazio.
    }
    const now = new Date().toISOString();
    for (const dir of dirs) {
      const full = join(attachmentsDir, dir);
      let files: string[];
      try {
        files = await readdir(full);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith('.json') || file.endsWith('.tmp')) {
          continue;
        }
        try {
          const info = await stat(join(full, file));
          index.entries.set(join(dir, file), {
            // Irrecuperável a partir do hash: o caminho relativo fica como
            // identificador opaco até o próximo put desta chave.
            key: join(dir, file),
            size: info.size,
            type: 'extraction',
            lastAccessedAt: now,
          });
        } catch {
          continue;
        }
      }
    }
  }

  /** Persiste o índice de uma instância (aplicando o buffer de acessos). */
  private async persist(instanceHash: string, index: InstanceIndex): Promise<void> {
    for (const [recordKey, at] of index.pendingAccess) {
      const entry = index.entries.get(recordKey);
      if (entry !== undefined) {
        entry.lastAccessedAt = at;
      }
    }
    index.pendingAccess.clear();

    const filePath = join(this.root, instanceHash, INDEX_FILE_NAME);
    const payload: IndexFile = {
      version: INDEX_VERSION,
      entries: Object.fromEntries(index.entries),
    };
    const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(payload));
      await rename(tmpPath, filePath);
    } catch (cause) {
      await rm(tmpPath, { force: true });
      // O diretório da instância pode não existir ainda (só acessos
      // bufferizados, sem put) — nada a persistir nesse caso.
      if ((cause as { code?: string }).code !== 'ENOENT') {
        throw cause;
      }
    }
  }
}
