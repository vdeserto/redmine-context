/**
 * Lógica de dados da tela de exportação do bundle (#33): empacota a issue já
 * carregada (`../screens/loaded-issue-context.js`, ver o JSDoc daquele módulo
 * para a escolha de REUSAR a issue em memória em vez de refazer a busca) nos
 * formatos Markdown/JSON/ambos e grava `<id>.md`/`<id>.json` no destino
 * informado pelo usuário.
 *
 * Fronteira do core (ADR-005): `buildMarkdownBundle`/`buildJsonBundle` +
 * `TOOL_VERSION` vêm de `../../../index.js` — nenhum módulo interno do core é
 * importado direto por aqui.
 *
 * `node:fs/promises` (`writeFile`) é importado DIRETO no topo do módulo (sem
 * injeção via opções) — mesmo padrão de `../../cli/commands.ts`, o único
 * outro lugar do repo que grava bundles em disco. Os testes mockam o módulo
 * inteiro com `vi.mock('node:fs/promises', ...)` (ver
 * `tests/surfaces/tui/hooks/use-export-bundle.test.tsx`), não memfs.
 *
 * ## Escolha deliberada: sem `mkdir` automático
 *
 * Diferente do `--out` da CLI (que cria o diretório com `mkdir(..., {
 * recursive: true })` porque o usuário passou uma flag explícita para um
 * pipeline não-interativo), esta tela é interativa e a AC da #33 pede um
 * estado de erro dedicado para "diretório inexistente" — se o diretório
 * fosse criado silenciosamente, esse caminho de erro nunca aconteceria e o
 * usuário nunca veria (nem teria chance de corrigir) um destino digitado
 * errado. `writeFile` falha com `ENOENT` nesse caso; o erro é mostrado com a
 * ação corretiva de criar o diretório ou escolher outro destino.
 */
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { useCallback, useState } from 'react';

import { buildJsonBundle, buildMarkdownBundle, TOOL_VERSION, type Issue } from '../../../index.js';

/** Formato escolhido na tela: os dois formatos do core, ou ambos de uma vez. */
export type ExportFormat = 'md' | 'json' | 'both';

/** Um arquivo gravado com sucesso. */
export interface ExportedFile {
  /** Formato do arquivo (sempre um dos dois formatos reais do core, nunca `'both'`). */
  format: 'md' | 'json';
  /** Caminho absoluto do arquivo gravado. */
  path: string;
}

/** Estado da exportação, consumido por `../screens/export.tsx`. */
export type ExportBundleState =
  | { status: 'idle' }
  | { status: 'exporting' }
  | { status: 'success'; files: ExportedFile[] }
  | { status: 'error'; message: string };

/** Dependências injetáveis do hook — hoje só o ambiente (para `REDMINE_URL`). */
export interface UseExportBundleOptions {
  /** Ambiente consultado para `REDMINE_URL` (compõe o bundle); default `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** Valor retornado pelo hook. */
export interface UseExportBundleResult {
  /** Estado atual da exportação (ver {@link ExportBundleState}). */
  state: ExportBundleState;
  /** Dispara a exportação: empacota e grava `<id>.<ext>` no destino informado. */
  runExport: (format: ExportFormat, destination: string) => Promise<void>;
  /** Volta ao estado `idle` — usado para tentar de novo após um erro. */
  reset: () => void;
}

/**
 * Expande um `~` inicial para o diretório home do usuário (mesma convenção
 * de shells POSIX) — `~` sozinho ou `~/resto/do/caminho`. Qualquer outro
 * caminho (absoluto, relativo, ou um `~` no meio da string) é devolvido sem
 * alteração.
 *
 * @param path - Caminho digitado pelo usuário no destino.
 * @param getHomedir - Resolve o diretório home; default `node:os`'s `homedir`.
 * @returns Caminho com `~` expandido, se aplicável.
 * @example
 * expandHome('~/exports') // => '/home/ana/exports'
 * expandHome('/tmp/out')  // => '/tmp/out' (inalterado)
 */
export function expandHome(path: string, getHomedir: () => string = homedir): string {
  if (path === '~') return getHomedir();
  if (path.startsWith('~/')) return join(getHomedir(), path.slice(2));
  return path;
}

/** Os dois formatos reais do core que `format` produz (`'both'` vira os dois). */
function realFormats(format: ExportFormat): Array<'md' | 'json'> {
  return format === 'both' ? ['md', 'json'] : [format];
}

/**
 * Empacota `issue` (`buildMarkdownBundle`/`buildJsonBundle`) e grava o(s)
 * arquivo(s) resultante(s) no destino informado.
 *
 * @param issue - Issue já normalizada, em memória (ver o JSDoc do módulo).
 * @param options - Dependências injetáveis. Ver {@link UseExportBundleOptions}.
 * @returns O {@link UseExportBundleResult} atual.
 * @example
 * const { state, runExport } = useExportBundle(issue);
 * await runExport('both', '~/exports');
 */
export function useExportBundle(
  issue: Issue | undefined,
  options: UseExportBundleOptions = {},
): UseExportBundleResult {
  const env = options.env ?? process.env;
  const [state, setState] = useState<ExportBundleState>({ status: 'idle' });

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const runExport = useCallback(
    async (format: ExportFormat, destination: string) => {
      if (issue === undefined) {
        setState({ status: 'error', message: 'Nenhuma issue carregada para exportar.' });
        return;
      }

      setState({ status: 'exporting' });

      const trimmed = destination.trim();
      const dir = resolve(expandHome(trimmed.length > 0 ? trimmed : '.'));
      const meta = { baseUrl: env.REDMINE_URL ?? '', toolVersion: TOOL_VERSION };

      try {
        const files: ExportedFile[] = [];
        for (const fmt of realFormats(format)) {
          const content = fmt === 'json' ? buildJsonBundle(issue, meta).canonical : buildMarkdownBundle(issue, meta);
          const path = join(dir, `${issue.id}.${fmt}`);
          await writeFile(path, content, 'utf8');
          files.push({ format: fmt, path });
        }
        setState({ status: 'success', files });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setState({ status: 'error', message });
      }
    },
    [issue, env],
  );

  return { state, runExport, reset };
}
