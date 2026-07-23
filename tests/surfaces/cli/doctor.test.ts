/**
 * Testes do comando `redmine-context doctor` (M3-11, #53). Escrito ANTES da
 * implementação (TDD). `diagnoseBinaries` do core é mockado — nenhum binário
 * real é consultado. Provam: relatório em texto puro (sem ANSI), exit 0 quando
 * tudo presente, exit 1 quando falta algum, versão exibida quando presente e a
 * instrução de instalação impressa para o binário ausente.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/index.js')>();
  return { ...actual, diagnoseBinaries: vi.fn() };
});

import * as core from '../../../src/index.js';
import type { BinaryDiagnosis } from '../../../src/index.js';
import { run } from '../../../src/surfaces/cli/main.js';

/** Captura stdout/stderr para asserções. */
function harness(overrides: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
    env: {} as NodeJS.ProcessEnv,
    prompt: vi.fn(),
    promptPassword: vi.fn(),
    ...overrides,
  };
  return { deps, stdout: () => out.join(''), stderr: () => err.join('') };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('CLI: comando doctor', () => {
  it('tudo presente: lista o binário com versão e retorna exit 0', async () => {
    const diagnosis: BinaryDiagnosis = {
      name: 'tesseract',
      found: true,
      path: '/opt/homebrew/bin/tesseract',
      version: '5.5.0',
      installHint: 'brew install tesseract',
    };
    vi.mocked(core.diagnoseBinaries).mockResolvedValue([diagnosis]);
    const h = harness();

    const code = await run(['doctor'], h.deps);

    expect(code).toBe(0);
    expect(h.stdout()).toContain('tesseract');
    expect(h.stdout()).toContain('5.5.0');
    expect(h.stdout()).toContain('/opt/homebrew/bin/tesseract');
  });

  it('binário ausente: imprime a instrução de instalação e retorna exit 1', async () => {
    const diagnosis: BinaryDiagnosis = {
      name: 'tesseract',
      found: false,
      installHint: 'winget install UB-Mannheim.TesseractOCR',
    };
    vi.mocked(core.diagnoseBinaries).mockResolvedValue([diagnosis]);
    const h = harness();

    const code = await run(['doctor'], h.deps);

    expect(code).toBe(1);
    expect(h.stdout()).toContain('winget install UB-Mannheim.TesseractOCR');
  });

  it('binário presente sem versão legível: ainda conta como ok (exit 0)', async () => {
    const diagnosis: BinaryDiagnosis = {
      name: 'tesseract',
      found: true,
      path: '/usr/bin/tesseract',
      installHint: 'sudo apt install tesseract-ocr',
    };
    vi.mocked(core.diagnoseBinaries).mockResolvedValue([diagnosis]);
    const h = harness();

    const code = await run(['doctor'], h.deps);

    expect(code).toBe(0);
    expect(h.stdout()).toContain('/usr/bin/tesseract');
  });

  it('relatório é texto puro, sem códigos ANSI, mesmo com stdout TTY', async () => {
    vi.mocked(core.diagnoseBinaries).mockResolvedValue([
      { name: 'tesseract', found: false, installHint: 'brew install tesseract' },
    ]);
    const h = harness({ isTTY: true });

    const code = await run(['doctor'], h.deps);

    expect(code).toBe(1);
    expect(h.stdout()).not.toMatch(/\x1b\[/);
  });
});
