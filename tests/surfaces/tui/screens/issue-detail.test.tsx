/**
 * Testes da tela de detalhe de issue (#31) — substitui o placeholder da #29.
 * Carrega a issue completa via `../hooks/use-issue-detail.js` (mockado aqui —
 * a busca em si já é coberta por `use-issue-detail.test.tsx`) e
 * `../screens/home-selection.js` (mockado via provider real, só para injetar
 * `selectedIssueId`). Cobre: render completo com fixture rica (metadados +
 * descrição + journals), viewport rolável (scroll muda a janela, limites de
 * topo/fundo), estados de carregamento/erro (rede/403/404/auth-aborted) e a
 * navegação de volta (`b`, mesmo padrão de `doctor.tsx`/`config.tsx` — o Esc
 * global que preserva a posição da home é coberto por
 * `home-selection.test.tsx`, no nível de integração). Escrito ANTES da
 * implementação (TDD).
 *
 * Anexos (#32): seção "Anexos" dentro do MESMO `ScrollView` (após os
 * journals) — nome, tamanho humanizado, `content_type` e badge textual de
 * status de extração (mapeamento local, ver `../../../../src/surfaces/tui/attachment-status.ts`).
 * Usa fixtures próprias e enxutas (sem journals) para a seção aparecer sem
 * precisar rolar; a rolagem com MUITOS anexos é coberta à parte, reutilizando
 * o mesmo mecanismo de `ScrollView` já testado acima.
 */
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/surfaces/tui/hooks/use-issue-detail.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/surfaces/tui/hooks/use-issue-detail.js')>();
  return { ...actual, useIssueDetail: vi.fn() };
});

import type { Attachment, Issue } from '../../../../src/index.js';
import * as useIssueDetailModule from '../../../../src/surfaces/tui/hooks/use-issue-detail.js';
import type { IssueDetailState } from '../../../../src/surfaces/tui/hooks/use-issue-detail.js';
import { NavigationProvider, type NavigationValue } from '../../../../src/surfaces/tui/navigation.js';
import { HomeSelectionProvider } from '../../../../src/surfaces/tui/screens/home-selection.js';
import { IssueDetailScreen } from '../../../../src/surfaces/tui/screens/issue-detail.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Caractere ESC (0x1B) — prefixo das sequências CSI de seta abaixo. */
const ESC = String.fromCharCode(0x1b);
const ARROW_DOWN = `${ESC}[B`;
const PAGE_DOWN = `${ESC}[6~`;
const PAGE_UP = `${ESC}[5~`;

/** Fixture rica: metadados completos + descrição multi-linha + vários journals (força a rolagem). */
const RICH_ISSUE: Issue = {
  id: 123,
  subject: 'Login falha com 2FA habilitado',
  project: { id: 1, name: 'Projeto X' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 2, name: 'Em andamento' },
  priority: { id: 3, name: 'Alta' },
  author: { id: 5, name: 'Ana Autora' },
  assigned_to: { id: 7, name: 'Bruno Responsável' },
  created_on: '2024-01-01T10:00:00Z',
  updated_on: '2024-01-10T15:30:00Z',
  description: 'Passo 1: habilitar 2FA.\nPasso 2: tentar logar.\nPasso 3: observar o erro 500.',
  custom_fields: [],
  attachments: [],
  relations: [],
  children: [],
  journals: Array.from({ length: 8 }, (_unused, index) => ({
    id: index + 1,
    created_on: `2024-01-0${(index % 9) + 1}T12:00:00Z`,
    user: { id: 10 + index, name: `Usuário ${index + 1}` },
    notes: `Nota de acompanhamento número ${index + 1}.`,
    details: [{ property: 'attr', name: 'status_id', old_value: '1', new_value: '2' }],
  })),
};

function navMock(overrides: Partial<NavigationValue> = {}): NavigationValue {
  return {
    stack: ['welcome', 'home', 'issue-detail'],
    current: 'issue-detail',
    push: vi.fn(),
    navigate: vi.fn(),
    pop: vi.fn(),
    replace: vi.fn(),
    resetTo: vi.fn(),
    popTo: vi.fn(),
    ...overrides,
  };
}

function mockState(state: IssueDetailState, retry: () => void = vi.fn()): void {
  vi.mocked(useIssueDetailModule.useIssueDetail).mockReturnValue({ state, retry });
}

function renderDetail(nav: NavigationValue = navMock()) {
  const utils = render(
    <ThemeProvider>
      <NavigationProvider value={nav}>
        <HomeSelectionProvider>
          <IssueDetailScreen />
        </HomeSelectionProvider>
      </NavigationProvider>
    </ThemeProvider>,
  );
  return { ...utils, nav };
}

afterEach(() => {
  vi.mocked(useIssueDetailModule.useIssueDetail).mockReset();
});

describe('TUI: IssueDetailScreen — carregando', () => {
  it('mostra o spinner enquanto carrega', () => {
    mockState({ status: 'loading' });
    const { lastFrame } = renderDetail();
    expect(lastFrame()).toContain('Carregando');
  });
});

describe('TUI: IssueDetailScreen — sem seleção', () => {
  it('mostra uma mensagem defensiva quando alcançada sem issue selecionada', () => {
    mockState({ status: 'no-selection' });
    const { lastFrame } = renderDetail();
    expect(lastFrame()).toContain('Nenhuma issue selecionada');
  });
});

describe('TUI: IssueDetailScreen — erro de rede', () => {
  it('mostra o banner de erro e o hint de retry', () => {
    mockState({ status: 'error-network', message: 'network unreachable' });
    const { lastFrame } = renderDetail();
    expect(lastFrame()).toContain('network unreachable');
    expect(lastFrame()).toContain('r');
  });

  it('"r" chama retry()', () => {
    const retry = vi.fn();
    mockState({ status: 'error-network', message: 'network unreachable' }, retry);
    const { stdin } = renderDetail();
    stdin.write('r');
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('TUI: IssueDetailScreen — 403', () => {
  it('mostra mensagem específica de permissão', () => {
    mockState({ status: 'error-forbidden', message: 'Sem permissão para ver esta issue nesta instância (403).' });
    const { lastFrame } = renderDetail();
    expect(lastFrame()).toContain('permiss');
    expect(lastFrame()).toContain('403');
  });
});

describe('TUI: IssueDetailScreen — 404', () => {
  it('mostra mensagem específica de issue não encontrada', () => {
    mockState({ status: 'error-not-found', message: 'Issue #123 não encontrada (404).' });
    const { lastFrame } = renderDetail();
    expect(lastFrame()).toContain('não encontrada');
    expect(lastFrame()).toContain('404');
  });
});

describe('TUI: IssueDetailScreen — abandono do re-login', () => {
  it('mostra a mensagem neutra de "auth-aborted" (não o banner de erro)', () => {
    mockState({ status: 'auth-aborted', message: 'login cancelado — pressione r para tentar de novo' });
    const { lastFrame } = renderDetail();
    expect(lastFrame()).toContain('login cancelado');
    expect(lastFrame()).toContain('pressione r');
  });
});

describe('TUI: IssueDetailScreen — render completo (fixture rica)', () => {
  it('mostra id, subject, status/prioridade/autor/assignee/datas como metadados', () => {
    mockState({ status: 'loaded', issue: RICH_ISSUE });
    const { lastFrame } = renderDetail();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('#123');
    expect(frame).toContain('Login falha com 2FA habilitado');
    expect(frame).toContain('Em andamento');
    expect(frame).toContain('Alta');
    expect(frame).toContain('Ana Autora');
    expect(frame).toContain('Bruno Responsável');
    expect(frame).toContain('2024-01-01');
    expect(frame).toContain('2024-01-10');
  });

  it('mostra o início da descrição e o histórico de journals com autor/data e notas', () => {
    mockState({ status: 'loaded', issue: RICH_ISSUE });
    const { lastFrame } = renderDetail();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Passo 1: habilitar 2FA.');
    expect(frame).toContain('Usuário 1');
    expect(frame).toContain('Nota de acompanhamento número 1.');
  });

  it('assignee ausente mostra um placeholder, sem quebrar', () => {
    mockState({ status: 'loaded', issue: { ...RICH_ISSUE, assigned_to: undefined } });
    const { lastFrame } = renderDetail();
    expect(lastFrame()).toContain('—');
  });

  it('"b" volta para a tela anterior (pop) — mesmo padrão de doctor/config', () => {
    const nav = navMock();
    mockState({ status: 'loaded', issue: RICH_ISSUE });
    const { stdin } = renderDetail(nav);
    stdin.write('b');
    expect(nav.pop).toHaveBeenCalledOnce();
  });
});

describe('TUI: IssueDetailScreen — viewport rolável (descrição + journals)', () => {
  it('o conteúdo inicial (topo) mostra as primeiras linhas, não as últimas', () => {
    mockState({ status: 'loaded', issue: RICH_ISSUE });
    const { lastFrame } = renderDetail();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Usuário 1');
    expect(frame).not.toContain('Usuário 8');
  });

  it('rolar para baixo (seta/j) revela conteúdo mais adiante, sem quebrar o layout', async () => {
    mockState({ status: 'loaded', issue: RICH_ISSUE });
    const { lastFrame, stdin } = renderDetail();
    const before = lastFrame();

    for (let i = 0; i < 6; i += 1) {
      stdin.write(ARROW_DOWN);
    }

    await vi.waitFor(() => {
      expect(lastFrame()).not.toBe(before);
    });
    // Os metadados fixos (fora da viewport) continuam visíveis — a rolagem
    // não "engoliu" o topo da tela.
    expect(lastFrame()).toContain('#123');
  });

  it('PgDn/PgUp movem a janela em blocos maiores', async () => {
    mockState({ status: 'loaded', issue: RICH_ISSUE });
    const { lastFrame, stdin } = renderDetail();
    // A janela inicial (10 linhas) termina dentro do 1º journal — "Usuário 4"
    // só fica visível depois de rolar uma página inteira para baixo.
    expect(lastFrame()).not.toContain('Usuário 4');

    stdin.write(PAGE_DOWN);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Usuário 4');
    });

    stdin.write(PAGE_UP);
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain('Usuário 4');
    });
    expect(lastFrame()).toContain('Usuário 1');
  });

  it('não rola além do início (limite de topo): repetir "k" no topo não muda o frame', async () => {
    mockState({ status: 'loaded', issue: RICH_ISSUE });
    const { lastFrame, stdin } = renderDetail();
    const before = lastFrame();
    stdin.write('k');
    stdin.write('k');
    stdin.write(PAGE_UP);
    await new Promise((resolve) => setImmediate(resolve));
    expect(lastFrame()).toBe(before);
  });

  it('não rola além do fim (limite de fundo): PgDn repetido estabiliza no final sem quebrar', async () => {
    mockState({ status: 'loaded', issue: RICH_ISSUE });
    const { lastFrame, stdin } = renderDetail();

    for (let i = 0; i < 10; i += 1) {
      stdin.write(PAGE_DOWN);
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Usuário 8');
    });
    const atBottom = lastFrame();
    expect(() => stdin.write(PAGE_DOWN)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(lastFrame()).toBe(atBottom);
  });
});

/** Fixture enxuta (sem journals, sem descrição) — a seção de anexos fica visível sem rolar. */
function issueWithAttachments(attachments: Attachment[]): Issue {
  return {
    ...RICH_ISSUE,
    description: undefined,
    journals: [],
    attachments,
  };
}

describe('TUI: IssueDetailScreen — anexos (#32)', () => {
  it('issue sem anexos: seção mostra "(nenhum)", sem quebrar', () => {
    mockState({ status: 'loaded', issue: issueWithAttachments([]) });
    const { lastFrame } = renderDetail();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Anexos');
    expect(frame).toContain('(nenhum)');
  });

  it('anexo de texto (content_type text/*) mostra nome, tamanho e badge "texto"', () => {
    mockState({
      status: 'loaded',
      issue: issueWithAttachments([
        {
          id: 1,
          filename: 'notas.txt',
          filesize: 999,
          content_type: 'text/plain',
          created_on: '2024-01-01T10:00:00Z',
          content_url: 'https://example.test/attachments/1',
        },
      ]),
    });
    const { lastFrame } = renderDetail();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('notas.txt');
    expect(frame).toContain('999B');
    expect(frame).toContain('text/plain');
    expect(frame).toContain('texto');
  });

  it('anexo binário conhecido (ex.: imagem) mostra badge "não suportado"', () => {
    mockState({
      status: 'loaded',
      issue: issueWithAttachments([
        {
          id: 2,
          filename: 'foto.png',
          filesize: 1536,
          content_type: 'image/png',
          created_on: '2024-01-01T10:00:00Z',
          content_url: 'https://example.test/attachments/2',
        },
      ]),
    });
    const { lastFrame } = renderDetail();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('foto.png');
    expect(frame).toContain('1.5KB');
    expect(frame).toContain('image/png');
    expect(frame).toContain('não suportado');
  });

  it('anexo sem content_type mostra badge "pendente" e placeholder de tipo', () => {
    mockState({
      status: 'loaded',
      issue: issueWithAttachments([
        {
          id: 3,
          filename: 'arquivo-sem-tipo',
          filesize: 2 * 1024 * 1024,
          created_on: '2024-01-01T10:00:00Z',
          content_url: 'https://example.test/attachments/3',
        },
      ]),
    });
    const { lastFrame } = renderDetail();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('arquivo-sem-tipo');
    expect(frame).toContain('2MB');
    expect(frame).toContain('pendente');
  });

  it('múltiplos anexos com status distintos renderizam todos, sem bloquear a navegação', () => {
    const nav = navMock();
    mockState({
      status: 'loaded',
      issue: issueWithAttachments([
        {
          id: 1,
          filename: 'notas.txt',
          filesize: 999,
          content_type: 'text/plain',
          created_on: '2024-01-01T10:00:00Z',
          content_url: 'https://example.test/attachments/1',
        },
        {
          id: 2,
          filename: 'foto.png',
          filesize: 1536,
          content_type: 'image/png',
          created_on: '2024-01-01T10:00:00Z',
          content_url: 'https://example.test/attachments/2',
        },
      ]),
    });
    const { lastFrame, stdin } = renderDetail(nav);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('notas.txt');
    expect(frame).toContain('foto.png');

    // "b" continua funcionando normalmente — anexos nunca bloqueiam navegação.
    stdin.write('b');
    expect(nav.pop).toHaveBeenCalledOnce();
  });

  it('anexos longos continuam dentro da viewport rolável — PgDn revela anexos mais adiante', async () => {
    const manyAttachments: Attachment[] = Array.from({ length: 20 }, (_unused, index) => ({
      id: index + 1,
      filename: `anexo-${index + 1}.txt`,
      filesize: 100,
      content_type: 'text/plain',
      created_on: '2024-01-01T10:00:00Z',
      content_url: `https://example.test/attachments/${index + 1}`,
    }));
    mockState({ status: 'loaded', issue: issueWithAttachments(manyAttachments) });
    const { lastFrame, stdin } = renderDetail();

    expect(lastFrame()).not.toContain('anexo-20.txt');

    for (let i = 0; i < 4; i += 1) {
      stdin.write(PAGE_DOWN);
    }

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('anexo-20.txt');
    });
    // Metadados fixos continuam visíveis — scroll não quebrou o layout.
    expect(lastFrame()).toContain('#123');
  });
});
