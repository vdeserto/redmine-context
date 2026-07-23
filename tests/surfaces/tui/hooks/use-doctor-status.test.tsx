/**
 * Testes do hook `useDoctorStatus` (M2-12, #35) — reúne node/tool/instância
 * (síncronos) e credencial/conectividade (assíncronos, via deps injetáveis)
 * para a tela `doctor.tsx`. Escrito ANTES da implementação (TDD): nenhuma
 * chamada real de rede/keychain acontece aqui, tudo é injetado.
 */
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { TOOL_NAME, TOOL_VERSION } from '../../../../src/index.js';
import {
  useDoctorStatus,
  type ConnectivityChecker,
  type UseDoctorStatusOptions,
} from '../../../../src/surfaces/tui/hooks/use-doctor-status.js';

/**
 * Harness: renderiza cada campo do status em sua PRÓPRIA linha (em vez de uma
 * única string longa) — evita que o line-wrapping do Ink quebre um valor no
 * meio e produza falso negativo nas asserções por substring.
 */
function Harness({ options }: { options: UseDoctorStatusOptions }) {
  const status = useDoctorStatus(options);
  return (
    <Box flexDirection="column">
      <Text>{`node:${status.nodeVersion}`}</Text>
      <Text>{`tool:${status.toolName}@${status.toolVersion}`}</Text>
      <Text>{`instance:${status.instanceUrl ?? '(none)'}`}</Text>
      <Text>{`credential:${status.credentialMethod}`}</Text>
      <Text>{`connectivity:${status.connectivity}`}</Text>
      <Text>{`detail:${status.connectivityDetail ?? '(none)'}`}</Text>
    </Box>
  );
}

/** Checker de conectividade que nunca deveria ser chamado (falha se for). */
const unreachableChecker: ConnectivityChecker = () => {
  throw new Error('checkConnectivity não deveria ser chamado sem instância configurada');
};

describe('TUI: useDoctorStatus — sem instância configurada', () => {
  it("instanceUrl ausente: credencial 'none', conectividade 'skipped', sem chamar deps de rede/credencial", async () => {
    const describeCredentialSource = vi.fn();
    const { lastFrame } = render(
      <Harness
        options={{
          env: {},
          nodeVersion: 'v99.0.0',
          describeCredentialSource,
          checkConnectivity: unreachableChecker,
        }}
      />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('credential:none');
    });
    expect(lastFrame()).toContain('connectivity:skipped');
    expect(lastFrame()).toContain('instance:(none)');
    expect(describeCredentialSource).not.toHaveBeenCalled();
  });
});

describe('TUI: useDoctorStatus — node/tool/instância (síncronos)', () => {
  it('usa o nodeVersion injetado e TOOL_NAME/TOOL_VERSION reais do core', async () => {
    const { lastFrame } = render(
      <Harness
        options={{
          env: { REDMINE_URL: 'https://redmine.example' },
          nodeVersion: 'v99.0.0',
          describeCredentialSource: vi.fn().mockResolvedValue('none'),
          checkConnectivity: vi.fn().mockResolvedValue({ ok: true }),
        }}
      />,
    );
    expect(lastFrame()).toContain('node:v99.0.0');
    expect(lastFrame()).toContain(`tool:${TOOL_NAME}@${TOOL_VERSION}`);
    expect(lastFrame()).toContain('instance:https://redmine.example');
  });
});

describe('TUI: useDoctorStatus — método de credencial (cada fonte)', () => {
  it.each(['keyring', 'file', 'env', 'none'] as const)(
    "reporta credencial '%s' quando describeCredentialSource resolve para ela",
    async (source) => {
      const { lastFrame } = render(
        <Harness
          options={{
            env: { REDMINE_URL: 'https://redmine.example' },
            describeCredentialSource: vi.fn().mockResolvedValue(source),
            checkConnectivity: vi.fn().mockResolvedValue({ ok: true }),
          }}
        />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain(`credential:${source}`);
      });
    },
  );

  it("degrada para 'none' se describeCredentialSource rejeitar", async () => {
    const { lastFrame } = render(
      <Harness
        options={{
          env: { REDMINE_URL: 'https://redmine.example' },
          describeCredentialSource: vi.fn().mockRejectedValue(new Error('boom')),
          checkConnectivity: vi.fn().mockResolvedValue({ ok: true }),
        }}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('credential:none');
    });
  });
});

describe('TUI: useDoctorStatus — conectividade (ok/falha)', () => {
  it("conectividade 'ok' quando o checker resolve ok:true", async () => {
    const { lastFrame } = render(
      <Harness
        options={{
          env: { REDMINE_URL: 'https://redmine.example' },
          describeCredentialSource: vi.fn().mockResolvedValue('keyring'),
          checkConnectivity: vi.fn().mockResolvedValue({ ok: true }),
        }}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('connectivity:ok');
    });
  });

  it("conectividade 'error' com detalhe quando o checker resolve ok:false", async () => {
    const { lastFrame } = render(
      <Harness
        options={{
          env: { REDMINE_URL: 'https://redmine.example' },
          describeCredentialSource: vi.fn().mockResolvedValue('keyring'),
          checkConnectivity: vi.fn().mockResolvedValue({ ok: false, detail: 'HTTP 503' }),
        }}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('connectivity:error');
    });
    expect(lastFrame()).toContain('detail:HTTP 503');
  });

  it("conectividade 'error' quando o checker rejeita (erro de rede)", async () => {
    const { lastFrame } = render(
      <Harness
        options={{
          env: { REDMINE_URL: 'https://redmine.example' },
          describeCredentialSource: vi.fn().mockResolvedValue('none'),
          checkConnectivity: vi.fn().mockRejectedValue(new Error('timeout')),
        }}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('connectivity:error');
    });
    expect(lastFrame()).toContain('detail:timeout');
  });

  it('passa o timeoutMs configurado para o checker de conectividade', async () => {
    const checkConnectivity = vi.fn().mockResolvedValue({ ok: true });
    render(
      <Harness
        options={{
          env: { REDMINE_URL: 'https://redmine.example' },
          describeCredentialSource: vi.fn().mockResolvedValue('none'),
          checkConnectivity,
          timeoutMs: 1234,
        }}
      />,
    );
    await vi.waitFor(() => {
      expect(checkConnectivity).toHaveBeenCalledWith('https://redmine.example', 1234);
    });
  });
});
