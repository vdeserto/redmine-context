import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import {
  statusFilterLabel,
  useStatusOptions,
  type StatusOption,
  type UseStatusOptionsOptions,
} from '../../../../src/surfaces/tui/hooks/use-status-options.js';

const ENV = { REDMINE_URL: 'https://redmine.example' } as NodeJS.ProcessEnv;

/** Enumerações fake com três status da "instância". */
function enums(status: Map<number, string>) {
  return { status, tracker: new Map<number, string>(), priority: new Map<number, string>() };
}

/**
 * Renderiza o hook e devolve um LEITOR do valor corrente.
 *
 * Um snapshot não serve: as opções começam nos agregados e só depois recebem os
 * status da instância — um `await` que pare no primeiro valor não vazio leria
 * sempre a lista incompleta.
 */
function collect(options: UseStatusOptionsOptions): () => readonly StatusOption[] {
  let last: readonly StatusOption[] = [];
  function Probe() {
    last = useStatusOptions(options);
    return null;
  }
  render(<Probe />);
  return () => last;
}

const baseDeps = {
  env: ENV,
  resolveApiKey: vi.fn().mockResolvedValue('key'),
  createHttpClient: vi.fn().mockReturnValue({ get: vi.fn() }),
} as unknown as UseStatusOptionsOptions;

describe('useStatusOptions', () => {
  // Caso esperado: agregados no topo, status da instância em seguida.
  it('oferece os agregados e os status da instância', async () => {
    const read = collect({
      ...baseDeps,
      fetchEnumerations: vi.fn().mockResolvedValue(
        enums(new Map([[7, 'Atribuída'], [11, 'Fila']])),
      ) as unknown as UseStatusOptionsOptions['fetchEnumerations'],
    });

    await vi.waitFor(() => expect(read()).toHaveLength(5));
    expect(read().slice(0, 3).map((o) => o.value)).toEqual(['all', 'open', 'closed']);
    expect(read().slice(3).map((o) => o.label)).toEqual(['Atribuída', 'Fila']);
  });

  // Ordem estável por id: a lista não pode dançar entre renders.
  it('ordena os status por id', async () => {
    let last: readonly StatusOption[] = [];
    function Probe() {
      last = useStatusOptions({
        ...baseDeps,
        fetchEnumerations: vi.fn().mockResolvedValue(
          enums(new Map([[11, 'Fila'], [2, 'Nova'], [7, 'Atribuída']])),
        ) as unknown as UseStatusOptionsOptions['fetchEnumerations'],
      });
      return null;
    }
    render(<Probe />);

    await vi.waitFor(() => expect(last.length).toBe(6));
    expect(last.slice(3).map((o) => o.value)).toEqual([2, 7, 11]);
  });

  // Edge case: sem instância configurada não há o que buscar — restam os
  // agregados, nunca uma tela vazia.
  it('sem REDMINE_URL fica só com os agregados', async () => {
    const read = collect({ ...baseDeps, env: {} as NodeJS.ProcessEnv });
    await vi.waitFor(() => expect(read()).toHaveLength(3));
    expect(read().map((o) => o.value)).toEqual(['all', 'open', 'closed']);
  });

  // Failure case: endpoint restrito/indisponível é enriquecimento perdido, não
  // erro de tela (ADR-005).
  it('degrada para os agregados quando a busca falha', async () => {
    const read = collect({
      ...baseDeps,
      fetchEnumerations: vi
        .fn()
        .mockRejectedValue(new Error('403')) as unknown as UseStatusOptionsOptions['fetchEnumerations'],
    });
    await vi.waitFor(() => expect(read()).toHaveLength(3));
    expect(read().map((o) => o.value)).toEqual(['all', 'open', 'closed']);
  });

  it('sem credencial não busca nada', async () => {
    const fetchEnumerations = vi.fn();
    const read = collect({
      ...baseDeps,
      resolveApiKey: vi.fn().mockResolvedValue(undefined) as UseStatusOptionsOptions['resolveApiKey'],
      fetchEnumerations: fetchEnumerations as unknown as UseStatusOptionsOptions['fetchEnumerations'],
    });

    await vi.waitFor(() => expect(read()).toHaveLength(3));
    expect(fetchEnumerations).not.toHaveBeenCalled();
  });
});

describe('statusFilterLabel', () => {
  const OPTIONS: readonly StatusOption[] = [
    { value: 'all', label: 'Todas' },
    { value: 7, label: 'Atribuída' },
  ];

  it('resolve o rótulo da opção', () => {
    expect(statusFilterLabel(OPTIONS, 'all')).toBe('Todas');
    expect(statusFilterLabel(OPTIONS, 7)).toBe('Atribuída');
  });

  // Degradação: status que não consta (enumerações não carregaram, ou status
  // removido da instância) vira `#id` — nunca um rótulo vazio no badge.
  it('cai para #id quando o status não consta', () => {
    expect(statusFilterLabel(OPTIONS, 99)).toBe('#99');
    expect(statusFilterLabel([], 'open')).toBe('open');
  });
});
