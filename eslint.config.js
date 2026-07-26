import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'documentation/', 'commands/', '.flowforge/', '.claude/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'error',
      // Hardening Windows / ADR-002 (#83): TODO subprocesso DEVE rodar sem shell.
      // `execFile` sem `shell` evita injeção via string e diferenças de parsing de
      // shell entre SOs (cmd.exe vs. sh). Esta regra é o guarda anti-regressão:
      //   1. proíbe `shell` truthy em opções de child_process — tanto `shell: true`
      //      quanto `shell: '/bin/sh'`/`'cmd.exe'` (shell por string também roda shell);
      //   2. proíbe importar `exec`/`execSync` (que rodam via shell) — force `execFile`.
      // Ver o teste tests/lint/no-shell-subprocess.test.ts, que roda o ESLint sobre
      // snippets e prova que a regra pega cada violação.
      'no-restricted-syntax': [
        'error',
        {
          // `[value.value!=false]` pega `true` e qualquer string (ex.: '/bin/bash'),
          // além de identificadores (value indefinido) — só `shell: false` escapa.
          // Cobre também a chave string-literal `{ 'shell': ... }`.
          selector:
            "Property[key.name='shell'][value.value!=false], Property[key.value='shell'][value.value!=false]",
          message:
            'Subprocessos DEVEM rodar sem shell (ADR-002/#83): sem `shell: true` nem `shell: "<caminho>"` — use execFile sem shell.',
        },
        {
          selector:
            "ImportDeclaration[source.value=/child_process$/] > ImportSpecifier[imported.name=/^(exec|execSync)$/]",
          message:
            'Proibido exec/execSync (rodam via shell). Use execFile sem shell (ADR-002/#83).',
        },
      ],
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
