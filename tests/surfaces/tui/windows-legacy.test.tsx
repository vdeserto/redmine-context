/**
 * Smoke do terminal LEGADO do Windows (M5-09, #84) — cmd.exe/PowerShell antigo,
 * sem suporte a Unicode. Força o conjunto de glyphs para o fallback ASCII
 * (mockando `../../../src/surfaces/tui/glyphs.js` para `ASCII_GLYPHS`, o que
 * afeta TODOS os consumidores: `truncate.ts`, `components/spinner.tsx` e as
 * telas) e renderiza as telas-chave em 80 colunas, assegurando:
 *
 * 1. NENHUM glyph Unicode "common" da TUI (reticências `…`, setas `↑`/`↓`,
 *    separador `·`, máscara `•`, frames braille) sobra no frame — ou seja, sem
 *    mojibake no terminal legado;
 * 2. NENHUMA linha excede 80 colunas mesmo com a reticência ASCII `'...'`
 *    (3 colunas vs. 1 da Unicode), o caso em que a matemática de corte poderia
 *    estourar a largura.
 *
 * Reutiliza `./render-at-width.tsx` (mesmo motivo do M2-16: `ink-testing-library`
 * fixa `stdout.columns` em 100) e o padrão de mocks de hooks de
 * `./responsive-layout.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/surfaces/tui/glyphs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/surfaces/tui/glyphs.js')>();
  // Força o fallback ASCII em todos os consumidores (terminal legado do Windows).
  return { ...actual, glyphs: actual.ASCII_GLYPHS };
});

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

vi.mock('../../../src/surfaces/tui/screens/loaded-issue-context.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/surfaces/tui/screens/loaded-issue-context.js')>();
  return { ...actual, useLoadedIssue: vi.fn() };
});

import type { Issue } from '../../../src/index.js';
import { UNICODE_GLYPHS } from '../../../src/surfaces/tui/glyphs.js';
import { NavigationProvider, type NavigationValue } from '../../../src/surfaces/tui/navigation.js';
import * as useIssueDetailModule from '../../../src/surfaces/tui/hooks/use-issue-detail.js';
import * as useIssueSearchModule from '../../../src/surfaces/tui/hooks/use-issue-search.js';
import * as useMyIssuesModule from '../../../src/surfaces/tui/hooks/use-my-issues.js';
import { HomeScreen } from '../../../src/surfaces/tui/screens/home.js';
import { HomeSelectionProvider } from '../../../src/surfaces/tui/screens/home-selection.js';
import { IssueDetailScreen } from '../../../src/surfaces/tui/screens/issue-detail.js';
import * as loadedIssueModule from '../../../src/surfaces/tui/screens/loaded-issue-context.js';
import { LoadedIssueProvider } from '../../../src/surfaces/tui/screens/loaded-issue-context.js';
import { ThemeProvider } from '../../../src/surfaces/tui/theme.js';
import { renderAtWidth, stripAnsi, visibleLineWidths } from './render-at-width.js';

const WIDTH = 80;

/**
 * Glyphs Unicode "common" que NÃO podem sobrar num frame renderizado em modo
 * ASCII (apareceriam como mojibake no terminal legado). O placeholder em-dash
 * fica de fora de propósito: `—` também é pontuação de prosa PT-BR fora do
 * escopo do sistema de glyphs — ver o relatório da issue.
 */
const FORBIDDEN_GLYPHS: readonly string[] = [
  UNICODE_GLYPHS.ellipsis,
  UNICODE_GLYPHS.middleDot,
  UNICODE_GLYPHS.arrowUp,
  UNICODE_GLYPHS.arrowDown,
  UNICODE_GLYPHS.maskBullet,
  ...UNICODE_GLYPHS.spinnerFrames,
];

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

function expectNoLineOverflow(frame: string | undefined, width: number): void {
  for (const lineWidth of visibleLineWidths(frame ?? '')) {
    expect(lineWidth).toBeLessThanOrEqual(width);
  }
}

function expectNoUnicodeGlyphs(frame: string | undefined): void {
  const rendered = stripAnsi(frame ?? '');
  for (const glyph of FORBIDDEN_GLYPHS) {
    expect(rendered).not.toContain(glyph);
  }
}

afterEach(() => {
  vi.mocked(useMyIssuesModule.useMyIssues).mockReset();
  vi.mocked(useIssueSearchModule.useIssueSearch).mockReset();
  vi.mocked(useIssueDetailModule.useIssueDetail).mockReset();
  vi.mocked(loadedIssueModule.useLoadedIssue).mockReset();
});

describe('Windows legado — HomeScreen (lista) em 80 colunas, glyphs ASCII', () => {
  const LONG_SUBJECT =
    'Corrigir o comportamento inconsistente do fluxo de reautenticação quando o token expira em pleno meio de uma exportação de bundle grande';

  function renderHome() {
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
    return renderAtWidth(
      <ThemeProvider>
        <NavigationProvider value={navMock()}>
          <HomeSelectionProvider>
            <HomeScreen />
          </HomeSelectionProvider>
        </NavigationProvider>
      </ThemeProvider>,
      WIDTH,
    );
  }

  it('não sobra nenhum glyph Unicode (sem mojibake) e usa a reticência ASCII', () => {
    const { lastFrame, cleanup } = renderHome();
    const frame = lastFrame() ?? '';
    expectNoUnicodeGlyphs(frame);
    // O subject comprido foi truncado — com a reticência ASCII '...'.
    expect(frame).not.toContain(LONG_SUBJECT);
    expect(frame).toContain('...');
    cleanup();
  });

  it('nenhuma linha excede 80 colunas mesmo com a reticência ASCII (3 colunas)', () => {
    const { lastFrame, cleanup } = renderHome();
    expectNoLineOverflow(lastFrame(), WIDTH);
    cleanup();
  });
});

describe('Windows legado — IssueDetailScreen em 80 colunas, glyphs ASCII', () => {
  const ISSUE: Issue = {
    id: 321,
    subject: 'Revisar contrato de integração com o serviço de OCR de anexos',
    project: { id: 1, name: 'Projeto X' },
    tracker: { id: 1, name: 'Bug' },
    status: { id: 2, name: 'Em andamento' },
    priority: { id: 3, name: 'Alta' },
    author: { id: 5, name: 'Ana Autora' },
    created_on: '2024-01-01T10:00:00Z',
    updated_on: '2024-01-10T15:30:00Z',
    description: 'Passo 1: revisar.\nPasso 2: aprovar.',
    custom_fields: [],
    attachments: [
      {
        id: 1,
        filename: 'relatorio.pdf',
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

  function renderDetail() {
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
      WIDTH,
    );
  }

  it('separador e placeholder degradam para ASCII (sem mojibake) e sem overflow', () => {
    const { lastFrame, cleanup } = renderDetail();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('#321');
    expectNoUnicodeGlyphs(frame);
    expectNoLineOverflow(frame, WIDTH);
    cleanup();
  });
});
