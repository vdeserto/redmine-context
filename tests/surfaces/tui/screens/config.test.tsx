/**
 * Testes da tela `config` (M2-12, #35): mostra a instância + a credencial em
 * uso e permite logout — remove a credencial da cascata INTEIRA (keychain +
 * arquivo); a variável de ambiente é somente-leitura e é avisada, nunca
 * apagada. Escrito ANTES da implementação (TDD). O core é mockado
 * (`describeCredentialSource`, `createCredentialCascade`) — nenhuma chamada
 * real de keychain/arquivo acontece aqui.
 */
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/index.js')>();
  return {
    ...actual,
    describeCredentialSource: vi.fn(),
    createCredentialCascade: vi.fn(),
  };
});

import * as core from '../../../../src/index.js';
import { ConfigScreen } from '../../../../src/surfaces/tui/screens/config.js';
import { NavigationProvider, type NavigationValue } from '../../../../src/surfaces/tui/navigation.js';
import { ThemeProvider } from '../../../../src/surfaces/tui/theme.js';

/** Segredo canário: se aparecer em qualquer frame, o teste falha (vazamento). */
const FAKE_API_KEY = 'super-secret-api-key-should-never-leak';

/** Constrói um `NavigationValue` de teste com todos os métodos espiados. */
function navMock(overrides: Partial<NavigationValue> = {}): NavigationValue {
  return {
    stack: ['welcome', 'config'],
    current: 'config',
    push: vi.fn(),
    navigate: vi.fn(),
    pop: vi.fn(),
    replace: vi.fn(),
    ...overrides,
  };
}

function renderConfig(nav: NavigationValue = navMock()) {
  const utils = render(
    <ThemeProvider>
      <NavigationProvider value={nav}>
        <ConfigScreen />
      </NavigationProvider>
    </ThemeProvider>,
  );
  return { ...utils, nav };
}

let fetchMock: ReturnType<typeof vi.fn>;
let deleteMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
  vi.stubGlobal('fetch', fetchMock);
  deleteMock = vi.fn().mockResolvedValue(undefined);
  vi.mocked(core.createCredentialCascade).mockReturnValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: deleteMock,
  } as unknown as ReturnType<typeof core.createCredentialCascade>);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('TUI: tela config', () => {
  it('mostra a instância configurada', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.describeCredentialSource).mockResolvedValue('keyring');
    const { lastFrame } = renderConfig();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('https://redmine.example');
    });
  });

  it('"b" volta sem fazer logout', async () => {
    const nav = navMock();
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.describeCredentialSource).mockResolvedValue('keyring');
    const { lastFrame, stdin } = renderConfig(nav);
    // Reason: o listener de `useInput()` é ligado num efeito passivo
    // (assíncrono) — aguarda o primeiro frame estabilizar antes de escrever,
    // mesmo padrão de `tests/surfaces/tui/app.test.tsx`.
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('https://redmine.example');
    });
    stdin.write('b');
    expect(nav.pop).toHaveBeenCalledOnce();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('"l" remove a credencial da cascata inteira (keychain + arquivo)', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.describeCredentialSource)
      .mockResolvedValueOnce('keyring') // status inicial da tela
      .mockResolvedValueOnce('none'); // checagem pós-logout: nada restou

    const { lastFrame, stdin } = renderConfig();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('https://redmine.example');
    });

    stdin.write('l');
    await vi.waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('https://redmine.example');
    });
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('removida');
    });
  });

  it('avisa quando a variável de ambiente ainda resolve a credencial após o logout', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.stubEnv('REDMINE_API_KEY', FAKE_API_KEY);
    vi.mocked(core.describeCredentialSource)
      .mockResolvedValueOnce('keyring')
      .mockResolvedValueOnce('env'); // env ainda resolve após remover keychain+arquivo

    const { lastFrame, stdin } = renderConfig();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('https://redmine.example');
    });

    stdin.write('l');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('REDMINE_API_KEY');
    });
    expect(lastFrame()).not.toContain(FAKE_API_KEY);
  });

  it('depois do logout, qualquer tecla volta ao início com a pilha resetada (replace)', async () => {
    const nav = navMock();
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.mocked(core.describeCredentialSource)
      .mockResolvedValueOnce('keyring')
      .mockResolvedValueOnce('none');

    const { lastFrame, stdin } = renderConfig(nav);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('https://redmine.example');
    });
    stdin.write('l');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('removida');
    });

    stdin.write('x');
    expect(nav.replace).toHaveBeenCalledWith('welcome');
  });

  it('sem instância configurada, "l" não faz nada (nenhum destino para o logout)', () => {
    vi.stubEnv('REDMINE_URL', '');
    const { stdin } = renderConfig();
    stdin.write('l');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('NUNCA vaza a api_key em nenhum frame durante o fluxo de logout', async () => {
    vi.stubEnv('REDMINE_URL', 'https://redmine.example');
    vi.stubEnv('REDMINE_API_KEY', FAKE_API_KEY);
    vi.mocked(core.describeCredentialSource)
      .mockResolvedValueOnce('file')
      .mockResolvedValueOnce('env');

    const { lastFrame, stdin } = renderConfig();
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('https://redmine.example');
    });
    stdin.write('l');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('removida');
    });
    expect(lastFrame()).not.toContain(FAKE_API_KEY);
  });
});
