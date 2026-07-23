/**
 * Teste de INTEGRAÇÃO (#34/M2-11, AC "export aparece no painel ao
 * exportar"): `ExportScreen` real + `JobsScreen` real, compartilhando um
 * `JobRegistryProvider` REAL (nada mockado de `../job-registry.js` aqui, ao
 * contrário de `jobs.test.tsx`) — prova que a exportação (#33) é o PRIMEIRO
 * produtor de verdade do registro de jobs, do registro em `processing` até a
 * transição final para `done`/`failed`.
 *
 * `useExportBundle`/`useLoadedIssue` são mockados (mesmo padrão de
 * `export.test.tsx` — a lógica de gravação em si já está coberta ali e em
 * `use-export-bundle.test.tsx`); o que esta suíte cobre é SÓ a ponte entre a
 * tela de exportação e o registro de jobs. Escrito ANTES da implementação
 * (TDD).
 */
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/surfaces/tui/hooks/use-export-bundle.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-export-bundle.js')>();
  return { ...actual, useExportBundle: vi.fn() };
});

vi.mock('../../../../src/surfaces/tui/screens/loaded-issue-context.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/screens/loaded-issue-context.js')>();
  return { ...actual, useLoadedIssue: vi.fn() };
});

import type { Issue } from '../../../../src/index.js';
import * as useExportBundleModule from '../../../../src/surfaces/tui/hooks/use-export-bundle.js';
import type { ExportBundleState } from '../../../../src/surfaces/tui/hooks/use-export-bundle.js';
import { JobRegistryProvider } from '../../../../src/surfaces/tui/job-registry.js';
import { NavigationProvider, type NavigationValue } from '../../../../src/surfaces/tui/navigation.js';
import { ExportScreen } from '../../../../src/surfaces/tui/screens/export.js';
import { JobsScreen } from '../../../../src/surfaces/tui/screens/jobs.js';
import * as loadedIssueModule from '../../../../src/surfaces/tui/screens/loaded-issue-context.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Enter (retorno de carro). */
const ENTER = '\r';

const ISSUE: Issue = {
  id: 88,
  subject: 'Exportar bundle',
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

function navMock(overrides: Partial<NavigationValue> = {}): NavigationValue {
  return {
    stack: ['welcome', 'home', 'issue-detail', 'export'],
    current: 'export',
    push: vi.fn(),
    navigate: vi.fn(),
    pop: vi.fn(),
    replace: vi.fn(),
    resetTo: vi.fn(),
    popTo: vi.fn(),
    ...overrides,
  };
}

function mockIssue(issue: Issue | undefined): void {
  vi.mocked(loadedIssueModule.useLoadedIssue).mockReturnValue({ issue, setIssue: vi.fn() });
}

function mockExportState(
  state: ExportBundleState,
  runExport: (format: string, destination: string) => Promise<void> = vi.fn(),
  reset: () => void = vi.fn(),
) {
  vi.mocked(useExportBundleModule.useExportBundle).mockReturnValue({
    state,
    runExport: runExport as never,
    reset,
  });
  return { runExport, reset };
}

/** Monta `ExportScreen` (produtor, #33) e `JobsScreen` (painel, #34) sob um `JobRegistryProvider` REAL. */
function Harness({ nav }: { nav: NavigationValue }) {
  return (
    <ThemeProvider>
      <NavigationProvider value={nav}>
        <JobRegistryProvider>
          <ExportScreen />
          <JobsScreen />
        </JobRegistryProvider>
      </NavigationProvider>
    </ThemeProvider>
  );
}

afterEach(() => {
  vi.mocked(useExportBundleModule.useExportBundle).mockReset();
  vi.mocked(loadedIssueModule.useLoadedIssue).mockReset();
});

describe('TUI: ExportScreen → JobsScreen — integração (#34, primeiro produtor real)', () => {
  it('ao confirmar a exportação, o job aparece no painel como "processando"', async () => {
    mockIssue(ISSUE);
    const { runExport } = mockExportState({ status: 'idle' });
    const nav = navMock();
    const { lastFrame, stdin } = render(<Harness nav={nav} />);

    expect(lastFrame()).toContain('Nenhum job nesta sessão ainda.');

    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(runExport).toHaveBeenCalledWith('md', process.cwd());
    });
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain(`Exportar #${ISSUE.id} (md)`);
      expect(frame).toContain('[processando]');
      expect(frame).toContain('(não cancelável)');
    });
  });

  it('ao terminar com sucesso, o job vira "concluído" no painel', async () => {
    mockIssue(ISSUE);
    const { runExport } = mockExportState({ status: 'idle' });
    const nav = navMock();
    const { lastFrame, stdin, rerender } = render(<Harness nav={nav} />);

    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('[processando]');
    });

    // Simula `useExportBundle` resolvendo para sucesso: re-renderiza a mesma
    // árvore com o mock devolvendo o novo estado — o registro de jobs (real,
    // no `JobRegistryProvider`) preserva o job já criado (não é recriado pelo
    // re-render, só transicionado pelo efeito em `ExportScreen`).
    mockExportState(
      { status: 'success', files: [{ format: 'md', path: '/tmp/saida/88.md' }] },
      runExport,
    );
    rerender(<Harness nav={nav} />);

    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain(`Exportar #${ISSUE.id} (md)`);
      expect(frame).toContain('[concluído]');
    });
  });

  it('ao falhar, o job vira "falhou" no painel', async () => {
    mockIssue(ISSUE);
    const { runExport } = mockExportState({ status: 'idle' });
    const nav = navMock();
    const { lastFrame, stdin, rerender } = render(<Harness nav={nav} />);

    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('[processando]');
    });

    mockExportState({ status: 'error', message: 'EACCES: permission denied' }, runExport);
    rerender(<Harness nav={nav} />);

    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain(`Exportar #${ISSUE.id} (md)`);
      expect(frame).toContain('[falhou]');
    });
  });
});
