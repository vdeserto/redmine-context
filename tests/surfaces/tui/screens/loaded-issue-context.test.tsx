/**
 * Testes de `loaded-issue-context.tsx` (#33) — contexto leve que reusa a
 * issue em memória do detalhe na tela de exportação (ver o JSDoc do módulo
 * para a escolha de reuso vs. refetch). Escrito ANTES da implementação
 * (TDD), mesmo padrão unitário de `home-selection.test.tsx`.
 */
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { Catch } from '../catch-boundary.js';

import type { Issue } from '../../../../src/index.js';
import {
  LoadedIssueProvider,
  useLoadedIssue,
} from '../../../../src/surfaces/tui/screens/loaded-issue-context.js';

const ISSUE: Issue = {
  id: 55,
  subject: 'Issue de teste',
  project: { id: 1, name: 'Projeto X' },
  tracker: { id: 1, name: 'Bug' },
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

describe('TUI: useLoadedIssue — unitário', () => {
  it('lança fora de <LoadedIssueProvider> (mesmo padrão de useNavigation()/useHomeSelection())', () => {
    function Bare() {
      useLoadedIssue();
      return null;
    }
    // Captura o erro de render via error boundary (CI-independente): o hook lança
    // fora do provider e a mensagem é exposta como Text normal.
    const { lastFrame } = render(
      <Catch>
        <Bare />
      </Catch>,
    );
    expect(lastFrame()).toContain('useLoadedIssue() usado fora de <LoadedIssueProvider>.');
  });

  it('começa com issue undefined', () => {
    function Probe() {
      const { issue } = useLoadedIssue();
      return <Text>{`issue:${issue?.id ?? 'none'}`}</Text>;
    }
    const { lastFrame } = render(
      <LoadedIssueProvider>
        <Probe />
      </LoadedIssueProvider>,
    );
    expect(lastFrame()).toBe('issue:none');
  });

  it('setIssue atualiza o estado exposto', async () => {
    function Probe() {
      const { issue, setIssue } = useLoadedIssue();
      useInput(() => setIssue(ISSUE));
      return <Text>{`issue:${issue?.id ?? 'none'} subject:${issue?.subject ?? 'none'}`}</Text>;
    }
    const { lastFrame, stdin } = render(
      <LoadedIssueProvider>
        <Probe />
      </LoadedIssueProvider>,
    );
    stdin.write('x');
    await vi.waitFor(() => {
      expect(lastFrame()).toBe('issue:55 subject:Issue de teste');
    });
  });

  it('cada render() de teste isola seu próprio provider (sem estado global vazando entre testes)', () => {
    // Reason: prova de que `LoadedIssueProvider` é um `Context` local por
    // árvore (não um singleton de módulo) — a issue definida no teste ANTERIOR
    // não vaza para uma árvore nova, que deve começar `undefined` de novo.
    function Probe() {
      const { issue } = useLoadedIssue();
      return <Text>{`issue:${issue?.id ?? 'none'}`}</Text>;
    }
    const { lastFrame } = render(
      <LoadedIssueProvider>
        <Probe />
      </LoadedIssueProvider>,
    );
    expect(lastFrame()).toBe('issue:none');
  });
});
