/**
 * Testes da tela `doctor` (M2-12, #35): painel de diagnóstico — Node, tool,
 * instância, credencial em uso e conectividade. Escrito ANTES da
 * implementação (TDD). O core é mockado só em `describeCredentialSource`
 * (`TOOL_NAME`/`TOOL_VERSION` seguem reais); a rede é mockada via `fetch`
 * global (mesmo padrão de `tests/client/http.test.ts`) — nenhuma chamada
 * real de keychain/rede sai durante o teste.
 */
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/index.js')>();
  return { ...actual, describeCredentialSource: vi.fn() };
});

import * as core from '../../../../src/index.js';
import { DoctorScreen } from '../../../../src/surfaces/tui/screens/doctor.js';
import { NavigationProvider, type NavigationValue } from '../../../../src/surfaces/tui/navigation.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Segredo canário: se aparecer em qualquer frame, o teste falha (vazamento). */
const FAKE_API_KEY = 'super-secret-api-key-should-never-leak';

/** Constrói um `NavigationValue` de teste com todos os métodos espiados. */
function navMock(overrides: Partial<NavigationValue> = {}): NavigationValue {
  return {
    stack: ['welcome', 'doctor'],
    current: 'doctor',
    push: vi.fn(),
    navigate: vi.fn(),
    pop: vi.fn(),
    replace: vi.fn(),
    ...overrides,
  };
}

function renderDoctor(nav: NavigationValue = navMock()) {
  const utils = render(
    <ThemeProvider>
      <NavigationProvider value={nav}>
        <DoctorScreen />
      </NavigationProvider>
    </ThemeProvider>,
  );
  return { ...utils, nav };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('TUI: tela doctor', () => {
  it('sem REDMINE_URL configurada: mostra instância ausente e pula a checagem de rede', async () => {
    vi.stubEnv('REDMINE_URL', '');
    const { lastFrame } = renderDoctor();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('não configurada');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['keyring', 'keychain do SO'],
    ['file', 'arquivo local'],
    ['env', 'variável de ambiente'],
  ] as const)("credencial '%s': mostra o rótulo '%s'", async (source, expectedLabel) => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.describeCredentialSource).mockResolvedValue(source);
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    const { lastFrame } = renderDoctor();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(expectedLabel);
    });
  });

  it("credencial 'none': mostra aviso de credencial ausente", async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.describeCredentialSource).mockResolvedValue('none');
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    const { lastFrame } = renderDoctor();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('nenhuma credencial');
    });
  });

  it('conectividade ok: mostra "conectado"', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.describeCredentialSource).mockResolvedValue('keyring');
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    const { lastFrame } = renderDoctor();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('conectado');
    });
  });

  it('conectividade com falha HTTP: mostra o motivo', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.describeCredentialSource).mockResolvedValue('keyring');
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);

    const { lastFrame } = renderDoctor();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('falha');
    });
    expect(lastFrame()).toContain('503');
  });

  it('conectividade com erro de rede: mostra o motivo sem quebrar a tela', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.describeCredentialSource).mockResolvedValue('keyring');
    fetchMock.mockRejectedValue(new Error('network unreachable'));

    const { lastFrame } = renderDoctor();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('falha');
    });
    expect(lastFrame()).toContain('network unreachable');
  });

  it('NUNCA vaza a api_key em nenhum frame, mesmo com a variável de ambiente definida', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.stubEnv('REDMINE_API_KEY', FAKE_API_KEY);
    vi.mocked(core.describeCredentialSource).mockResolvedValue('env');
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    const { lastFrame } = renderDoctor();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('variável de ambiente');
    });
    expect(lastFrame()).not.toContain(FAKE_API_KEY);
  });

  it('"b" volta para a tela anterior (pop)', () => {
    const nav = navMock();
    vi.stubEnv('REDMINE_URL', '');
    const { stdin } = renderDoctor(nav);
    stdin.write('b');
    expect(nav.pop).toHaveBeenCalledOnce();
  });
});
