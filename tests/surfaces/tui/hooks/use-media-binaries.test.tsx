/**
 * Testes do hook `useMediaBinaries` (M3-11, #53): consome `diagnoseBinaries` do
 * core (fronteira `../../../index.js`) e expõe o estado loading/binaries para a
 * seção "Binários de mídia" da tela doctor. Escrito ANTES da implementação
 * (TDD). O diagnóstico é injetado — nenhum binário real é consultado.
 */
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import type { BinaryDiagnosis } from '../../../../src/index.js';
import {
  useMediaBinaries,
  type UseMediaBinariesOptions,
} from '../../../../src/surfaces/tui/hooks/use-media-binaries.js';

/** Harness: renderiza estado + cada binário numa linha própria (evita wrap). */
function Harness({ options }: { options: UseMediaBinariesOptions }) {
  const { loading, binaries } = useMediaBinaries(options);
  return (
    <Box flexDirection="column">
      <Text>{`loading:${loading ? 'yes' : 'no'}`}</Text>
      {binaries.map((b) => (
        <Text key={b.name}>{`bin:${b.name}:${b.found ? 'found' : 'missing'}:${b.version ?? '-'}`}</Text>
      ))}
    </Box>
  );
}

describe('TUI: useMediaBinaries', () => {
  it('resolve para os binários diagnosticados e sai do loading', async () => {
    const binaries: BinaryDiagnosis[] = [
      { name: 'tesseract', found: true, path: '/usr/bin/tesseract', version: '5.5.0', installHint: 'brew install tesseract' },
    ];
    const diagnose = vi.fn().mockResolvedValue(binaries);
    const { lastFrame } = render(<Harness options={{ diagnose }} />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('loading:no');
    });
    expect(lastFrame()).toContain('bin:tesseract:found:5.5.0');
  });

  it('reporta binário ausente sem versão', async () => {
    const diagnose = vi.fn().mockResolvedValue([
      { name: 'tesseract', found: false, installHint: 'brew install tesseract' } satisfies BinaryDiagnosis,
    ]);
    const { lastFrame } = render(<Harness options={{ diagnose }} />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('bin:tesseract:missing:-');
    });
  });

  it('degrada para lista vazia (sem loading) se o diagnóstico rejeitar', async () => {
    const diagnose = vi.fn().mockRejectedValue(new Error('boom'));
    const { lastFrame } = render(<Harness options={{ diagnose }} />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('loading:no');
    });
    expect(lastFrame()).not.toContain('bin:');
  });
});
