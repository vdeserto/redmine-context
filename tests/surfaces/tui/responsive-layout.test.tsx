/**
 * Testes de layout responsivo (M2-16, #39): snapshots de render em 80 e 60
 * colunas SEM overflow de linha para as telas principais — welcome, home
 * (lista), issue-detail (com anexos), export e doctor — truncamento com
 * reticências verificado por asserção em strings longas (subjects/paths
 * compridos), e redimensionamento em runtime re-renderizando sem crash nem
 * sobreposição. Escrito ANTES de aplicar o truncamento às telas (TDD): as
 * asserções de "sem overflow" falham primeiro contra o código pré-#39 (ver o
 * JSDoc de `../../../src/surfaces/tui/truncate.ts` para o bug de
 * sobreposição confirmado empiricamente antes desta mudança).
 *
 * Usa `./render-at-width.tsx` em vez do `render()` de `ink-testing-library`
 * porque esta última FIXA `stdout.columns` em 100 (ver o JSDoc daquele
 * helper) — 80/60 colunas só são simuláveis com um stdout mockado próprio +
 * o `TerminalWidthProvider` injetado.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/surfaces/tui/hooks/use-my-issues.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/surfaces/tui/hooks/use-my-issues.js')>();
  return { ...actual, useMyIssues: vi.fn() };
});

vi.mock('../../../src/surfaces/tui/hooks/use-issue-search.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/surfaces/tui/hooks/use-issue-search.js')>();
  return { ...actual, useIssueSearch: vi.fn() };
});

vi.mock('../../../src/surfaces/tui/hooks/use-issue-detail.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/surfaces/tui/hooks/use-issue-detail.js')>();
  return { ...actual, useIssueDetail: vi.fn() };
});

vi.mock('../../../src/surfaces/tui/hooks/use-export-bundle.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/surfaces/tui/hooks/use-export-bundle.js')>();
  return { ...actual, useExportBundle: vi.fn() };
});

vi.mock('../../../src/surfaces/tui/screens/loaded-issue-context.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/surfaces/tui/screens/loaded-issue-context.js')>();
  return { ...actual, useLoadedIssue: vi.fn() };
});

vi.mock('../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/index.js')>();
  return { ...actual, describeCredentialSource: vi.fn() };
});

import type { Issue } from '../../../src/index.js';
import * as core from '../../../src/index.js';
import { NavigationProvider, type NavigationValue } from '../../../src/surfaces/tui/navigation.js';
import * as useExportBundleModule from '../../../src/surfaces/tui/hooks/use-export-bundle.js';
import type { ExportBundleState } from '../../../src/surfaces/tui/hooks/use-export-bundle.js';
import * as useIssueDetailModule from '../../../src/surfaces/tui/hooks/use-issue-detail.js';
import * as useIssueSearchModule from '../../../src/surfaces/tui/hooks/use-issue-search.js';
import * as useMyIssuesModule from '../../../src/surfaces/tui/hooks/use-my-issues.js';
import { DoctorScreen } from '../../../src/surfaces/tui/screens/doctor.js';
import { ExportScreen } from '../../../src/surfaces/tui/screens/export.js';
import { HomeScreen } from '../../../src/surfaces/tui/screens/home.js';
import { HomeSelectionProvider } from '../../../src/surfaces/tui/screens/home-selection.js';
import { IssueDetailScreen } from '../../../src/surfaces/tui/screens/issue-detail.js';
import * as loadedIssueModule from '../../../src/surfaces/tui/screens/loaded-issue-context.js';
import { LoadedIssueProvider } from '../../../src/surfaces/tui/screens/loaded-issue-context.js';
import { WelcomeScreen } from '../../../src/surfaces/tui/screens/welcome.js';
import { ThemeProvider } from '../../../src/surfaces/tui/theme.js';
import { renderAtWidth, visibleLineWidths } from './render-at-width.js';

const WIDTHS = [80, 60] as const;

function navMock(overrides: Partial<NavigationValue> = {}): NavigationValue {
  return {
    stack: ['welcome'],
    current: 'welcome',
    push: vi.fn(),
    navigate: vi.fn(),
    pop: vi.fn(),
    replace: vi.fn(),
    resetTo: vi.fn(),
    popTo: vi.fn(),
    ...overrides,
  };
}

/** Assevera que NENHUMA linha visível (sem ANSI) do frame excede `width` colunas. */
function expectNoLineOverflow(frame: string | undefined, width: number): void {
  const rendered = frame ?? '';
  for (const lineWidth of visibleLineWidths(rendered)) {
    expect(lineWidth).toBeLessThanOrEqual(width);
  }
}

afterEach(() => {
  vi.mocked(useMyIssuesModule.useMyIssues).mockReset();
  vi.mocked(useIssueSearchModule.useIssueSearch).mockReset();
  vi.mocked(useIssueDetailModule.useIssueDetail).mockReset();
  vi.mocked(useExportBundleModule.useExportBundle).mockReset();
  vi.mocked(loadedIssueModule.useLoadedIssue).mockReset();
  vi.mocked(core.describeCredentialSource).mockReset();
  vi.unstubAllEnvs();
});

describe('Layout responsivo — WelcomeScreen', () => {
  it.each(WIDTHS)('%i colunas: nenhuma linha excede a largura', (width) => {
    const { lastFrame, cleanup } = renderAtWidth(
      <ThemeProvider>
        <NavigationProvider value={navMock()}>
          <WelcomeScreen />
        </NavigationProvider>
      </ThemeProvider>,
      width,
    );
    expectNoLineOverflow(lastFrame(), width);
    cleanup();
  });
});

describe('Layout responsivo — HomeScreen (lista)', () => {
  const LONG_SUBJECT =
    'Corrigir o comportamento inconsistente do fluxo de reautenticação quando o token expira em pleno meio de uma exportação de bundle grande';

  function mockIssues(): void {
    vi.mocked(useMyIssuesModule.useMyIssues).mockReturnValue({
      state: {
        status: 'loaded',
        issues: [
          { id: 4242, subject: LONG_SUBJECT, statusName: 'Em andamento' },
          { id: 7, subject: 'Issue curta', statusName: 'Nova' },
        ],
      },
      retry: vi.fn(),
    });
    vi.mocked(useIssueSearchModule.useIssueSearch).mockReturnValue({
      state: { status: 'idle' },
      clear: vi.fn(),
    });
  }

  function renderHome(width: number) {
    mockIssues();
    return renderAtWidth(
      <ThemeProvider>
        <NavigationProvider value={navMock()}>
          <HomeSelectionProvider>
            <HomeScreen />
          </HomeSelectionProvider>
        </NavigationProvider>
      </ThemeProvider>,
      width,
    );
  }

  it.each(WIDTHS)('%i colunas: nenhuma linha excede a largura, mesmo com subject comprido', (width) => {
    const { lastFrame, cleanup } = renderHome(width);
    expectNoLineOverflow(lastFrame(), width);
    cleanup();
  });

  it('60 colunas: subject comprido é truncado com reticências (não aparece por inteiro)', () => {
    const { lastFrame, cleanup } = renderHome(60);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain(LONG_SUBJECT);
    expect(frame).toContain('…');
    // A issue curta continua visível por inteiro — só o subject longo corta.
    expect(frame).toContain('Issue curta');
    cleanup();
  });

  it('redimensionar em runtime (80 → 60 → 80) re-renderiza sem crash nem sobreposição', () => {
    const { lastFrame, setColumns, cleanup } = renderHome(80);
    expectNoLineOverflow(lastFrame(), 80);

    expect(() => setColumns(60)).not.toThrow();
    expectNoLineOverflow(lastFrame(), 60);

    expect(() => setColumns(80)).not.toThrow();
    expectNoLineOverflow(lastFrame(), 80);
    cleanup();
  });
});

describe('Layout responsivo — IssueDetailScreen (com anexos)', () => {
  const LONG_ASSIGNEE_NAME = 'Fulano de Tal da Silva Responsável pelo Módulo de Integração Externa';

  const ISSUE: Issue = {
    id: 321,
    subject: 'Revisar contrato de integração com o serviço de OCR de anexos',
    project: { id: 1, name: 'Projeto X' },
    tracker: { id: 1, name: 'Bug' },
    status: { id: 2, name: 'Em andamento' },
    priority: { id: 3, name: 'Alta' },
    author: { id: 5, name: 'Ana Autora' },
    assigned_to: { id: 7, name: LONG_ASSIGNEE_NAME },
    created_on: '2024-01-01T10:00:00Z',
    updated_on: '2024-01-10T15:30:00Z',
    description: 'Passo 1: revisar.\nPasso 2: aprovar.',
    custom_fields: [],
    attachments: [
      {
        id: 1,
        filename: 'relatorio-tecnico-completo-com-nome-de-arquivo-extremamente-longo.pdf',
        filesize: 2048,
        content_type: 'application/pdf',
        created_on: '2024-01-01T10:00:00Z',
        content_url: 'https://example.test/attachments/1',
      },
    ],
    relations: [],
    children: [],
    journals: [],
  };

  function renderDetail(width: number) {
    vi.mocked(useIssueDetailModule.useIssueDetail).mockReturnValue({
      state: { status: 'loaded', issue: ISSUE },
      retry: vi.fn(),
    });
    vi.mocked(loadedIssueModule.useLoadedIssue).mockReturnValue({ issue: undefined, setIssue: vi.fn() });
    return renderAtWidth(
      <ThemeProvider>
        <NavigationProvider value={navMock()}>
          <HomeSelectionProvider>
            <LoadedIssueProvider>
              <IssueDetailScreen />
            </LoadedIssueProvider>
          </HomeSelectionProvider>
        </NavigationProvider>
      </ThemeProvider>,
      width,
    );
  }

  it.each(WIDTHS)(
    '%i colunas: nenhuma linha excede a largura, mesmo com assignee/anexo compridos',
    (width) => {
      const { lastFrame, cleanup } = renderDetail(width);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('#321');
      expectNoLineOverflow(frame, width);
      cleanup();
    },
  );
});

describe('Layout responsivo — ExportScreen', () => {
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

  const LONG_PATH = '/home/usuario/projetos/redmine-context/pasta-de-saida-com-nome-bem-comprido/exportacoes';

  function mockExport(state: ExportBundleState): void {
    vi.mocked(loadedIssueModule.useLoadedIssue).mockReturnValue({ issue: ISSUE, setIssue: vi.fn() });
    vi.mocked(useExportBundleModule.useExportBundle).mockReturnValue({
      state,
      runExport: vi.fn() as never,
      reset: vi.fn(),
    });
  }

  it.each(WIDTHS)('%i colunas (formulário idle): nenhuma linha excede a largura', (width) => {
    mockExport({ status: 'idle' });
    const { lastFrame, cleanup } = renderAtWidth(
      <ThemeProvider>
        <NavigationProvider value={navMock()}>
          <ExportScreen />
        </NavigationProvider>
      </ThemeProvider>,
      width,
    );
    expectNoLineOverflow(lastFrame(), width);
    cleanup();
  });

  it('60 colunas (sucesso): caminho comprido é truncado com reticências, sem overflow', () => {
    mockExport({ status: 'success', files: [{ format: 'md', path: `${LONG_PATH}/88.md` }] });
    const { lastFrame, cleanup } = renderAtWidth(
      <ThemeProvider>
        <NavigationProvider value={navMock()}>
          <ExportScreen />
        </NavigationProvider>
      </ThemeProvider>,
      60,
    );
    const frame = lastFrame() ?? '';
    expectNoLineOverflow(frame, 60);
    expect(frame).not.toContain(`${LONG_PATH}/88.md`);
    expect(frame).toContain('…');
    cleanup();
  });

  it('digitar um destino comprido (Tab + texto) não estoura a largura em 60 colunas', () => {
    mockExport({ status: 'idle' });
    const { lastFrame, stdin, cleanup } = renderAtWidth(
      <ThemeProvider>
        <NavigationProvider value={navMock()}>
          <ExportScreen />
        </NavigationProvider>
      </ThemeProvider>,
      60,
    );

    stdin.write('\t'); // Tab: alterna para o campo de destino
    stdin.write(LONG_PATH);

    expectNoLineOverflow(lastFrame(), 60);
    cleanup();
  });
});

describe('Layout responsivo — DoctorScreen', () => {
  const LONG_INSTANCE_URL =
    'https://redmine-instancia-com-nome-de-host-extremamente-comprido.example.com/algum/caminho/profundo';

  function renderDoctor(width: number) {
    vi.stubEnv('REDMINE_URL', LONG_INSTANCE_URL);
    vi.mocked(core.describeCredentialSource).mockResolvedValue('keyring');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));
    return renderAtWidth(
      <ThemeProvider>
        <NavigationProvider value={navMock()}>
          <DoctorScreen />
        </NavigationProvider>
      </ThemeProvider>,
      width,
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(WIDTHS)('%i colunas: nenhuma linha excede a largura, mesmo com instância comprida', (width) => {
    const { lastFrame, cleanup } = renderDoctor(width);
    expectNoLineOverflow(lastFrame(), width);
    cleanup();
  });

  it('60 colunas: URL de instância comprida é truncada com reticências', () => {
    const { lastFrame, cleanup } = renderDoctor(60);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain(LONG_INSTANCE_URL);
    expect(frame).toContain('…');
    cleanup();
  });
});
