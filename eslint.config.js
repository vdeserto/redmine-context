import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'documentation/', 'commands/', '.flowforge/', '.claude/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'error',
    },
  },
);
