/**
 * Guarda anti-regressão do hardening de Windows (#83, M5-08 / ADR-002): prova que
 * a regra `no-restricted-syntax` do ESLint do projeto PEGA as violações de
 * subprocesso-com-shell — rodando o ESLint REAL (Node API) sobre snippets, com a
 * MESMA `eslint.config.js` do repo. Assim, se alguém reintroduzir `shell: true`
 * ou `exec`/`execSync`, a suíte falha (além do próprio `npm run lint`).
 *
 * Também valida os CONTROLES: `execFile` e o `.exec()` de RegExp (usado à larga
 * nos detectores de versão) NÃO podem disparar a regra — senão o guarda seria
 * inútil por excesso de falso-positivo.
 */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const RULE = 'no-restricted-syntax';

/** ESLint carregando a config real do repo (cwd = raiz do projeto no vitest). */
const eslint = new ESLint();

/** Lint de um snippet como se fosse um módulo do core; retorna os ruleIds achados. */
async function lint(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: 'src/__probe__.ts' });
  return (result?.messages ?? []).map((m) => m.ruleId ?? '');
}

describe('lint: proíbe subprocesso com shell (ADR-002 / #83)', () => {
  it('pega `shell: true` em opções de child_process', async () => {
    const rules = await lint(
      "import { execFile } from 'node:child_process';\n" +
        "execFile('ls', ['-la'], { shell: true }, () => {});\n",
    );
    expect(rules).toContain(RULE);
  });

  it('pega o import de `exec` de node:child_process', async () => {
    const rules = await lint("import { exec } from 'node:child_process';\nexec('ls -la');\n");
    expect(rules).toContain(RULE);
  });

  it('pega o import de `execSync` (com ou sem prefixo node:)', async () => {
    const rules = await lint("import { execSync } from 'child_process';\nexecSync('ls');\n");
    expect(rules).toContain(RULE);
  });

  it('NÃO dispara para `execFile` sem shell (uso canônico)', async () => {
    const rules = await lint(
      "import { execFile } from 'node:child_process';\n" +
        "execFile('ls', ['-la'], { windowsHide: true }, () => {});\n",
    );
    expect(rules).not.toContain(RULE);
  });

  it('NÃO dispara para `.exec()` de RegExp (detecção de versão dos binários)', async () => {
    const rules = await lint(
      "const m = /ffmpeg version (\\S+)/i.exec('ffmpeg version 6.1.1');\nvoid m;\n",
    );
    expect(rules).not.toContain(RULE);
  });
});
