/**
 * Varredura anti-hardcode de cores (M2-02): nenhum componente da TUI pode
 * declarar uma cor do Ink/chalk literalmente — toda cor deve vir de um token
 * do tema (`theme.ts`), consumido via `useTheme()`. Isso garante que trocar a
 * paleta no futuro seja uma mudança em um único arquivo.
 *
 * A varredura roda em todo `src/surfaces/tui`, exceto `theme.ts` (única fonte
 * legítima de literais de cor) e arquivos de teste.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TUI_DIR = fileURLToPath(new URL('../../../src/surfaces/tui', import.meta.url));

/** Nomes de cor conhecidos do Ink/chalk (paleta ANSI de 16 cores + variantes "Bright"). */
const INK_COLOR_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray',
  'grey',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
];

// Escopada às props de cor do Ink (color/backgroundColor/borderColor): um nome
// de cor conhecido, hex ou rgb()/hsl(). Escopo evita falso positivo em texto de
// UI (ex.: "#123456" como número de issue).
const COLOR_LITERAL_REGEX = new RegExp(
  `(?:color|backgroundColor|borderColor)\\s*=\\s*['"\`{]+\\s*['"\`]?(${INK_COLOR_NAMES.join('|')}|#[0-9a-fA-F]{3,8}|rgb\\([^'")]*\\)|hsl\\([^'")]*\\))['"\`]`,
);

/** Lista recursivamente todos os arquivos-fonte (não-teste) sob `dir`. */
function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('TUI: sem cores hardcoded fora do tema', () => {
  const sourceFiles = listSourceFiles(TUI_DIR).filter(
    (file) => relative(TUI_DIR, file) !== 'theme.tsx',
  );

  it('encontrou ao menos um arquivo de tela para varrer (sanity check da varredura)', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it.each(sourceFiles.map((file) => [relative(TUI_DIR, file), file] as const))(
    'src/surfaces/tui/%s não declara cores literais (usa tokens do tema)',
    (_label, file) => {
      const content = readFileSync(file, 'utf-8');
      const match = COLOR_LITERAL_REGEX.exec(content);
      expect(match, `cor literal "${match?.[0] ?? ''}" encontrada em ${file}`).toBeNull();
    },
  );
});
