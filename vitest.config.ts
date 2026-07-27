import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Estabilização definitiva do #130: os testes de teclado da TUI dependem
    // do pipeline assíncrono de input do Ink (useInput re/subscreve em efeitos
    // pós-commit). Sob contenção de CPU (muitos workers em paralelo), escritas
    // no stdin caem em janelas sem listener — flaky que, com a suíte grande,
    // virou falha consistente. Arquivos rodam SERIALIZADOS (determinístico);
    // o paralelismo pode voltar por sharding no CI (M5) se o tempo pesar.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Arquivos só de tipos/interfaces não têm código executável; o v8 os conta
      // como 0% e polui o relatório (gap #87, NIT). Sem impacto no threshold real.
      exclude: ['src/**/types.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
