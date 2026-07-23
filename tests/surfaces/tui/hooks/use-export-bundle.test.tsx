/**
 * Testes do hook `useExportBundle` (#33): empacota a issue já carregada
 * (`buildMarkdownBundle`/`buildJsonBundle`, `../../../../src/index.js`) e
 * grava `<id>.md`/`<id>.json` via `node:fs/promises`. Escrito ANTES da
 * implementação (TDD).
 *
 * `node:fs/promises` é mockado DIRETO (`vi.mock`, NÃO memfs) — mesmo padrão
 * já usado no repo para mockar módulos inteiros (ex.: `use-issue-detail.test.tsx`
 * mocka `../../../../src/index.js`). Cobre: fluxo completo md/json/both, "~"
 * expandido (`node:os` mockado para um home determinístico) e erro de
 * escrita (permissão/diretório inexistente) propagado como `state.error`.
 */
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn() };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => '/home/tester') };
});

import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';

import type { Issue } from '../../../../src/index.js';
import {
  expandHome,
  useExportBundle,
  type UseExportBundleOptions,
} from '../../../../src/surfaces/tui/hooks/use-export-bundle.js';

const ISSUE: Issue = {
  id: 77,
  subject: 'Exportar corretamente',
  project: { id: 1, name: 'Projeto X' },
  tracker: { id: 1, name: 'Feature' },
  status: { id: 1, name: 'Nova' },
  priority: { id: 1, name: 'Normal' },
  author: { id: 1, name: 'Ana Autora' },
  created_on: '2024-01-01T10:00:00Z',
  updated_on: '2024-01-02T10:00:00Z',
  custom_fields: [],
  journals: [],
  attachments: [],
  relations: [],
  children: [],
};

/** Harness: renderiza `state.status` + expõe `runExport`/`reset` via `globalThis`. */
function Harness({ issue, options }: { issue: Issue | undefined; options?: UseExportBundleOptions }) {
  const { state, runExport, reset } = useExportBundle(issue, options);
  (globalThis as { __runExport?: typeof runExport; __reset?: typeof reset }).__runExport = runExport;
  (globalThis as { __runExport?: typeof runExport; __reset?: typeof reset }).__reset = reset;
  return (
    <Box flexDirection="column">
      <Text>{`status:${state.status}`}</Text>
      {state.status === 'success' ? (
        <Text>{`files:${state.files.map((f) => `${f.format}=${f.path}`).join(',')}`}</Text>
      ) : null}
      {state.status === 'error' ? <Text>{`message:${state.message}`}</Text> : null}
    </Box>
  );
}

afterEach(() => {
  vi.mocked(writeFile).mockReset();
  vi.mocked(homedir).mockClear();
  delete (globalThis as { __runExport?: unknown }).__runExport;
  delete (globalThis as { __reset?: unknown }).__reset;
});

describe('expandHome', () => {
  it('expande "~" sozinho para o home', () => {
    expect(expandHome('~', () => '/home/ana')).toBe('/home/ana');
  });

  it('expande "~/subpasta" para o home + resto do caminho', () => {
    expect(expandHome('~/exports', () => '/home/ana')).toBe(join('/home/ana', 'exports'));
  });

  it('caminho absoluto sem "~" fica inalterado', () => {
    expect(expandHome('/tmp/out', () => '/home/ana')).toBe('/tmp/out');
  });

  it('caminho relativo sem "~" fica inalterado', () => {
    expect(expandHome('./out', () => '/home/ana')).toBe('./out');
  });
});

describe('useExportBundle: formato md', () => {
  it('começa "idle", grava um único arquivo .md e resolve "success" com o caminho absoluto', async () => {
    vi.mocked(writeFile).mockResolvedValue(undefined);
    const { lastFrame } = render(<Harness issue={ISSUE} />);
    expect(lastFrame()).toContain('status:idle');

    const runExport = (globalThis as { __runExport?: (format: string, dest: string) => Promise<void> })
      .__runExport;
    await runExport?.('md', '/tmp/export-dest');

    await vi.waitFor(() => expect(lastFrame()).toContain('status:success'));
    expect(lastFrame()).toContain(`files:md=${join('/tmp/export-dest', '77.md')}`);
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      join('/tmp/export-dest', '77.md'),
      expect.any(String),
      'utf8',
    );
  });
});

describe('useExportBundle: formato json', () => {
  it('grava um único arquivo .json com o corpo canônico do bundle JSON', async () => {
    vi.mocked(writeFile).mockResolvedValue(undefined);
    const { lastFrame } = render(<Harness issue={ISSUE} />);

    const runExport = (globalThis as { __runExport?: (format: string, dest: string) => Promise<void> })
      .__runExport;
    await runExport?.('json', '/tmp/export-dest');

    await vi.waitFor(() => expect(lastFrame()).toContain('status:success'));
    expect(lastFrame()).toContain(`files:json=${join('/tmp/export-dest', '77.json')}`);
    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? [];
    expect(() => JSON.parse(String(content))).not.toThrow();
  });
});

describe('useExportBundle: formato both', () => {
  it('grava .md e .json numa única chamada, ambos reportados no sucesso', async () => {
    vi.mocked(writeFile).mockResolvedValue(undefined);
    const { lastFrame } = render(<Harness issue={ISSUE} />);

    const runExport = (globalThis as { __runExport?: (format: string, dest: string) => Promise<void> })
      .__runExport;
    await runExport?.('both', '/tmp/export-dest');

    await vi.waitFor(() => expect(lastFrame()).toContain('status:success'));
    expect(lastFrame()).toContain(join('/tmp/export-dest', '77.md'));
    expect(lastFrame()).toContain(join('/tmp/export-dest', '77.json'));
    expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(2);
  });
});

describe('useExportBundle: "~" expandido no destino', () => {
  it('expande "~/exports" para o home mockado antes de gravar', async () => {
    vi.mocked(writeFile).mockResolvedValue(undefined);
    const { lastFrame } = render(<Harness issue={ISSUE} />);

    const runExport = (globalThis as { __runExport?: (format: string, dest: string) => Promise<void> })
      .__runExport;
    await runExport?.('md', '~/exports');

    await vi.waitFor(() => expect(lastFrame()).toContain('status:success'));
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      join('/home/tester', 'exports', '77.md'),
      expect.any(String),
      'utf8',
    );
  });
});

describe('useExportBundle: erro de escrita', () => {
  it('permissão negada (EACCES) resolve "error" com a mensagem do sistema de arquivos', async () => {
    vi.mocked(writeFile).mockRejectedValue(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    );
    const { lastFrame } = render(<Harness issue={ISSUE} />);

    const runExport = (globalThis as { __runExport?: (format: string, dest: string) => Promise<void> })
      .__runExport;
    await runExport?.('md', '/root/sem-permissao');

    await vi.waitFor(() => expect(lastFrame()).toContain('status:error'));
    expect(lastFrame()).toContain('permission denied');
  });

  it('diretório inexistente (ENOENT) resolve "error" com a mensagem do sistema de arquivos', async () => {
    vi.mocked(writeFile).mockRejectedValue(
      Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
    );
    const { lastFrame } = render(<Harness issue={ISSUE} />);

    const runExport = (globalThis as { __runExport?: (format: string, dest: string) => Promise<void> })
      .__runExport;
    await runExport?.('md', '/caminho/que/nao/existe');

    await vi.waitFor(() => expect(lastFrame()).toContain('status:error'));
    expect(lastFrame()).toContain('no such file or directory');
  });

  it('reset() volta o estado para "idle" após um erro', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('falha qualquer'));
    const { lastFrame } = render(<Harness issue={ISSUE} />);

    const runExport = (globalThis as { __runExport?: (format: string, dest: string) => Promise<void> })
      .__runExport;
    await runExport?.('md', '/tmp/export-dest');
    await vi.waitFor(() => expect(lastFrame()).toContain('status:error'));

    const reset = (globalThis as { __reset?: () => void }).__reset;
    reset?.();
    await vi.waitFor(() => expect(lastFrame()).toContain('status:idle'));
  });
});

describe('useExportBundle: sem issue em memória', () => {
  it('resolve "error" imediatamente, sem chamar writeFile', async () => {
    const { lastFrame } = render(<Harness issue={undefined} />);

    const runExport = (globalThis as { __runExport?: (format: string, dest: string) => Promise<void> })
      .__runExport;
    await runExport?.('md', '/tmp/export-dest');

    await vi.waitFor(() => expect(lastFrame()).toContain('status:error'));
    expect(lastFrame()).toContain('Nenhuma issue carregada');
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});
