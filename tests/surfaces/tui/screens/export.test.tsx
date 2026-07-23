/**
 * Testes da tela de exportação do bundle (#33). Escrito ANTES da
 * implementação (TDD): `useExportBundle` (a gravação em si já é coberta por
 * `use-export-bundle.test.tsx`) e `useLoadedIssue` (o reuso da issue em
 * memória já é coberto por `loaded-issue-context.test.tsx`) são mockados
 * aqui — esta suíte cobre só a interação da tela (foco entre formato/destino,
 * confirmação, e a formatação dos 4 estados visuais).
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
import * as loadedIssueModule from '../../../../src/surfaces/tui/screens/loaded-issue-context.js';
import { symbols } from '../../../../src/surfaces/tui/symbols.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Caractere Tab (0x09). */
const TAB = String.fromCharCode(0x09);
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

function renderExport(nav: NavigationValue = navMock()) {
  const utils = render(
    <ThemeProvider>
      <NavigationProvider value={nav}>
        {/* #34: `ExportScreen` agora é o primeiro produtor real do registro
            de jobs (`../job-registry.js`) — a integração em si é coberta por
            `jobs-export-integration.test.tsx`; aqui só precisa de um
            provider real para a tela não quebrar. */}
        <JobRegistryProvider>
          <ExportScreen />
        </JobRegistryProvider>
      </NavigationProvider>
    </ThemeProvider>,
  );
  return { ...utils, nav };
}

afterEach(() => {
  vi.mocked(useExportBundleModule.useExportBundle).mockReset();
  vi.mocked(loadedIssueModule.useLoadedIssue).mockReset();
});

describe('TUI: ExportScreen — sem issue em memória', () => {
  it('mostra um aviso neutro em vez de quebrar', () => {
    mockIssue(undefined);
    mockExportState({ status: 'idle' });
    const { lastFrame } = renderExport();
    expect(lastFrame()).toContain('Nenhuma issue carregada');
  });
});

describe('TUI: ExportScreen — formulário (idle)', () => {
  it('mostra as 3 opções de formato e o destino com process.cwd() como valor inicial', () => {
    mockIssue(ISSUE);
    mockExportState({ status: 'idle' });
    const { lastFrame } = renderExport();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Markdown (.md)');
    expect(frame).toContain('JSON (.json)');
    expect(frame).toContain('Ambos (.md + .json)');
    expect(frame).toContain(process.cwd());
  });

  it('"j"/"k" navegam a lista de formato quando o campo de formato está focado', async () => {
    mockIssue(ISSUE);
    mockExportState({ status: 'idle' });
    const { lastFrame, stdin } = renderExport();

    stdin.write('j');
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      const jsonLine = frame.split('\n').find((line) => line.includes('JSON (.json)'));
      expect(jsonLine).toContain(symbols.pointerSmall);
    });
  });

  it('Enter na lista de formato dispara runExport com o formato selecionado e o destino atual', async () => {
    mockIssue(ISSUE);
    const { runExport } = mockExportState({ status: 'idle' });
    const { lastFrame, stdin } = renderExport();

    stdin.write('j'); // md -> json
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      const jsonLine = frame.split('\n').find((line) => line.includes('JSON (.json)'));
      expect(jsonLine).toContain(symbols.pointerSmall);
    });
    // Reason (mesma observação de `home-selection.test.tsx`): o `useInput()`
    // do Ink resubscreve seu listener num efeito passivo separado do commit
    // que atualiza o frame — um tick extra garante que a resubscrição (com o
    // `selectedIndex` já em 1) rodou antes do Enter.
    await new Promise((resolve) => setImmediate(resolve));
    stdin.write(ENTER);

    await vi.waitFor(() => {
      expect(runExport).toHaveBeenCalledWith('json', process.cwd());
    });
  });

  it('Tab alterna para o campo de destino — digitar então edita o destino, não navega o formato', async () => {
    mockIssue(ISSUE);
    const { runExport } = mockExportState({ status: 'idle' });
    const { lastFrame, stdin } = renderExport();

    stdin.write(TAB);
    await vi.waitFor(() => {
      const frame = lastFrame() ?? '';
      const destinoLine = frame.split('\n').find((line) => line.includes('Destino:'));
      expect(destinoLine).toContain(symbols.pointer);
    });
    stdin.write('/tmp/saida');

    await vi.waitFor(() => {
      expect(lastFrame()).toContain(`${process.cwd()}/tmp/saida`);
    });

    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(runExport).toHaveBeenCalledWith('md', `${process.cwd()}/tmp/saida`);
    });
  });
});

describe('TUI: ExportScreen — progresso', () => {
  it('mostra o spinner existente durante a exportação', () => {
    mockIssue(ISSUE);
    mockExportState({ status: 'exporting' });
    const { lastFrame } = renderExport();
    expect(lastFrame()).toContain('Exportando');
  });

  it('"b" não volta durante a exportação (evita interromper a gravação)', () => {
    mockIssue(ISSUE);
    mockExportState({ status: 'exporting' });
    const nav = navMock();
    const { stdin } = renderExport(nav);
    stdin.write('b');
    expect(nav.pop).not.toHaveBeenCalled();
  });
});

describe('TUI: ExportScreen — sucesso', () => {
  it('mostra o(s) caminho(s) absoluto(s) gravado(s) e o hint de "b" para voltar', () => {
    mockIssue(ISSUE);
    mockExportState({
      status: 'success',
      files: [
        { format: 'md', path: '/tmp/saida/88.md' },
        { format: 'json', path: '/tmp/saida/88.json' },
      ],
    });
    const { lastFrame } = renderExport();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/tmp/saida/88.md');
    expect(frame).toContain('/tmp/saida/88.json');
    expect(frame).toContain('b');
  });

  it('"b" volta ao detalhe (pop)', () => {
    mockIssue(ISSUE);
    mockExportState({ status: 'success', files: [{ format: 'md', path: '/tmp/saida/88.md' }] });
    const nav = navMock();
    const { stdin } = renderExport(nav);
    stdin.write('b');
    expect(nav.pop).toHaveBeenCalledOnce();
  });
});

describe('TUI: ExportScreen — erro de escrita', () => {
  it('mostra a mensagem em theme.danger e uma ação corretiva', () => {
    mockIssue(ISSUE);
    mockExportState({ status: 'error', message: 'EACCES: permission denied' });
    const { lastFrame } = renderExport();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('permission denied');
    expect(frame).toContain('permissão');
  });

  it('"r" chama reset() para tentar de novo', () => {
    mockIssue(ISSUE);
    const { reset } = mockExportState({ status: 'error', message: 'ENOENT: no such file or directory' });
    const { stdin } = renderExport();
    stdin.write('r');
    expect(reset).toHaveBeenCalledOnce();
  });
});
