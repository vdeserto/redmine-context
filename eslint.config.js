import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'documentation/', 'commands/', '.flowforge/', '.claude/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'error',
    },
  },
  // Fronteira do core (ADR-005): superfícies (TUI/CLI/MCP, futuras em src/surfaces/)
  // só consomem o core via ./contract.js — nunca importam módulos internos direto.
  {
    files: ['src/surfaces/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/client/**',
                '**/normalize/**',
                '**/extract/**',
                '**/bundle/**',
                '**/config/**',
                '**/cache/**',
                '**/core.js',
              ],
              message: 'Superfícies devem consumir o core apenas via src/contract.ts (fronteira ADR-005).',
            },
          ],
        },
      ],
    },
  },
);
