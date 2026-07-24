/**
 * Teste de integração REAL do extrator de PDF via `pdftotext` (#145, ADR-002) —
 * opt-in.
 *
 * Só roda com `PDFTOTEXT_INTEGRATION=1` (evita depender do binário poppler em
 * CI/headless). Gera um PDF 1.4 mínimo com camada de texto EM RUNTIME (montado à
 * mão em `./text-pdf.ts` — sem fixture binária versionada no repo), roteia pelo
 * dispatcher REAL (magic bytes `%PDF` → pdftotext) e valida o texto extraído.
 * NÃO mocka `node:child_process`: chama o pdftotext de verdade.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultRegistry, dispatchExtraction } from '../../src/extract/index.js';
import { makeTextPdf } from './text-pdf.js';

describe.skipIf(!process.env.PDFTOTEXT_INTEGRATION)(
  'PdfExtractor (integração real com o binário pdftotext)',
  () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'rc-pdftotext-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('extrai o texto de um PDF gerado em runtime via o dispatcher real', async () => {
      const file = join(dir, 'hello.pdf');
      await writeFile(file, makeTextPdf('HELLO PDF from a runtime-generated document'));

      const registry = await createDefaultRegistry();
      const result = await dispatchExtraction(file, { registry, filename: 'hello.pdf' });

      expect(result.status).toBe('done');
      expect(result.mime).toBe('application/pdf');
      // Reason: reporta o texto real extraído para inspeção manual do run opt-in.
      expect(result.text ?? '').toContain('HELLO PDF');
    });

    it('PDF sem camada de texto → failed com reason pdf-sem-camada-de-texto', async () => {
      // Um PDF 1.4 válido com uma página em branco (sem operador de texto).
      const file = join(dir, 'blank.pdf');
      await writeFile(file, makeTextPdf(''));

      const registry = await createDefaultRegistry();
      const result = await dispatchExtraction(file, { registry, filename: 'blank.pdf' });

      expect(result.status).toBe('failed');
      expect(result.metadata?.reason).toBe('pdf-sem-camada-de-texto');
    });
  },
);
