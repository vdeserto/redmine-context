/**
 * Testes UNITÁRIOS do painel de jobs da sessão (#34/M2-11): `JobsScreen`
 * isolada, `useJobRegistry()` mockado (`../job-registry.js`) — cobre a tela
 * vazia, o render por status (ícone/spinner + cor + rótulo), a seleção por
 * teclado, o hint de cancelamento ("(Ctrl+C cancela)" vs. "(não
 * cancelável)") e `Ctrl+C` cancelando só quando `cancelable`. Escrito ANTES
 * da implementação (TDD), mesmo padrão de mock de `export.test.tsx`.
 *
 * A integração real com a exportação (#33 como primeiro produtor do
 * registro, montando `ExportScreen` + `JobsScreen` sob um
 * `JobRegistryProvider` de verdade) vive em `jobs-export-integration.test.tsx`
 * — um arquivo à parte porque esta suíte mocka `useJobRegistry` inteiro, o
 * que quebraria o fluxo real de registro/transição de status.
 */
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/surfaces/tui/job-registry.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/job-registry.js')>();
  return { ...actual, useJobRegistry: vi.fn() };
});

import * as jobRegistryModule from '../../../../src/surfaces/tui/job-registry.js';
import type { Job } from '../../../../src/surfaces/tui/job-registry.js';
import { NavigationProvider, type NavigationValue } from '../../../../src/surfaces/tui/navigation.js';
import { JobsScreen } from '../../../../src/surfaces/tui/screens/jobs.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Caractere ESC (0x1B) — prefixo da sequência CSI de seta abaixo. */
const ESC = String.fromCharCode(0x1b);
const ARROW_DOWN = `${ESC}[B`;
/** Ctrl+C (0x03). */
const CTRL_C = String.fromCharCode(0x03);

function navMock(overrides: Partial<NavigationValue> = {}): NavigationValue {
  return {
    stack: ['welcome', 'home', 'jobs'],
    current: 'jobs',
    push: vi.fn(),
    navigate: vi.fn(),
    pop: vi.fn(),
    replace: vi.fn(),
    resetTo: vi.fn(),
    popTo: vi.fn(),
    ...overrides,
  };
}

function mockJobs(jobs: Job[]): void {
  vi.mocked(jobRegistryModule.useJobRegistry).mockReturnValue({
    jobs,
    registerJob: vi.fn(),
    updateJobStatus: vi.fn(),
  });
}

function renderJobs(nav: NavigationValue = navMock()) {
  const utils = render(
    <ThemeProvider>
      <NavigationProvider value={nav}>
        <JobsScreen />
      </NavigationProvider>
    </ThemeProvider>,
  );
  return { ...utils, nav };
}

afterEach(() => {
  vi.mocked(jobRegistryModule.useJobRegistry).mockReset();
});

describe('TUI: JobsScreen — tela vazia', () => {
  it('mostra "Nenhum job nesta sessão ainda." quando não há jobs', () => {
    mockJobs([]);
    const { lastFrame } = renderJobs();
    expect(lastFrame()).toContain('Nenhum job nesta sessão ainda.');
  });
});

describe('TUI: JobsScreen — renderiza por status', () => {
  it('mostra o rótulo e o badge textual de cada status (pendente/processando/concluído/falhou)', () => {
    mockJobs([
      { id: 'a', label: 'Buscar issues', status: 'pending' },
      { id: 'b', label: 'Exportar #1 (md)', status: 'processing' },
      { id: 'c', label: 'Exportar #2 (json)', status: 'done' },
      { id: 'd', label: 'Exportar #3 (both)', status: 'failed' },
    ]);
    const { lastFrame } = renderJobs();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Buscar issues');
    expect(frame).toContain('[pendente]');
    expect(frame).toContain('Exportar #1 (md)');
    expect(frame).toContain('[processando]');
    expect(frame).toContain('Exportar #2 (json)');
    expect(frame).toContain('[concluído]');
    expect(frame).toContain('Exportar #3 (both)');
    expect(frame).toContain('[falhou]');
  });
});

describe('TUI: JobsScreen — seleção e cancelamento (Ctrl+C)', () => {
  it('a primeira linha começa selecionada e mostra "(não cancelável)" para um job sem onCancel', () => {
    mockJobs([{ id: 'a', label: 'Exportar #1 (md)', status: 'processing' }]);
    const { lastFrame } = renderJobs();
    expect(lastFrame()).toContain('(não cancelável)');
  });

  it('mostra "(Ctrl+C cancela)" para um job cancelável selecionado', () => {
    mockJobs([{ id: 'a', label: 'Extrair anexo', status: 'processing', cancelable: true, onCancel: vi.fn() }]);
    const { lastFrame } = renderJobs();
    expect(lastFrame()).toContain('(Ctrl+C cancela)');
  });

  it('↓ move a seleção para a 2ª linha', async () => {
    mockJobs([
      { id: 'a', label: 'Job A', status: 'pending' },
      { id: 'b', label: 'Job B', status: 'pending', cancelable: true, onCancel: vi.fn() },
    ]);
    const { lastFrame, stdin } = renderJobs();
    expect(lastFrame()).toContain('(não cancelável)');

    stdin.write(ARROW_DOWN);
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      const jobBLine = frame.split('\n').find((line) => line.includes('Job B'));
      expect(jobBLine).toContain('(Ctrl+C cancela)');
    });
  });

  it('Ctrl+C chama onCancel do job selecionado quando cancelável', async () => {
    const onCancel = vi.fn();
    mockJobs([{ id: 'a', label: 'Extrair anexo', status: 'processing', cancelable: true, onCancel }]);
    const { stdin } = renderJobs();
    stdin.write(CTRL_C);
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  it('Ctrl+C NÃO chama onCancel quando o job selecionado não é cancelável', () => {
    const onCancel = vi.fn();
    mockJobs([{ id: 'a', label: 'Exportar #1 (md)', status: 'processing', onCancel }]);
    const { stdin } = renderJobs();
    stdin.write(CTRL_C);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('TUI: JobsScreen — navegação', () => {
  it('"b" volta (pop) para a tela anterior', () => {
    mockJobs([]);
    const nav = navMock();
    const { stdin } = renderJobs(nav);
    stdin.write('b');
    expect(nav.pop).toHaveBeenCalledOnce();
  });
});
