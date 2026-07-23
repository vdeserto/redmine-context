/**
 * Teste de integração REAL do extrator tesseract (M3-09, ADR-002) — opt-in.
 *
 * Só roda com `TESSERACT_INTEGRATION=1` (evita depender do binário em CI/headless).
 * Gera uma imagem PNG com texto simples EM RUNTIME (fonte bitmap em
 * `./text-png.ts` — sem fixture binária versionada no repo), roteia pelo
 * dispatcher REAL (magic bytes → tesseract) e valida que o texto extraído contém
 * a palavra esperada. NÃO mocka `node:child_process`: chama o tesseract de verdade.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultRegistry, dispatchExtraction } from '../../src/extract/index.js';
import { makeTextPng } from './text-png.js';

describe.skipIf(!process.env.TESSERACT_INTEGRATION)(
  'TesseractExtractor (integração real com o binário tesseract)',
  () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'rc-tesseract-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('extrai o texto de um PNG gerado em runtime via o dispatcher real', async () => {
      const file = join(dir, 'hello.png');
      await writeFile(file, makeTextPng('HELLO'));

      const registry = await createDefaultRegistry();
      const result = await dispatchExtraction(file, { registry, filename: 'hello.png' });

      expect(result.status).toBe('done');
      expect(result.mime).toBe('image/png');
      // Reason: reporta o texto real extraído para inspeção manual do run opt-in.
      expect((result.text ?? '').toUpperCase()).toContain('HELLO');
    });
  },
);
