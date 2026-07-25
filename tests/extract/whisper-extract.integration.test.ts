/**
 * Teste de integração REAL da transcrição whisper.cpp (M4-05, #61, ADR-002) —
 * opt-in. Só roda com `WHISPER_INTEGRATION=1` (evita depender do binário + modelo
 * GGUF em CI/headless, como a #60 fez com `FFMPEG_INTEGRATION`). Gera um WAV curto
 * 16 kHz mono EM RUNTIME (fixture em `./audio-wav.ts`) e o transcreve pelo pipeline
 * REAL (whisper.cpp de verdade, sem mock de `child_process`), validando o formato
 * do resultado — o CONTEÚDO de áudio sintético não é determinístico, então aqui
 * asseguramos apenas a forma tipada; o parse determinístico é coberto pelos testes
 * unitários com saída conhecida injetada.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWhisperExtractor } from '../../src/extract/whisper-extract.js';
import { makeWavFixture } from './audio-wav.js';

describe.skipIf(!process.env.WHISPER_INTEGRATION)(
  'WhisperExtractor (integração real com o binário whisper.cpp + modelo GGUF)',
  () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'rc-whisper-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('transcreve um WAV 16 kHz mono e devolve um resultado done com texto string', async () => {
      const input = join(dir, 'source.wav');
      await writeFile(input, makeWavFixture({ sampleRate: 16000, channels: 1, durationSec: 1 }));

      const extractor = await createWhisperExtractor();
      const result = await extractor.extract(input, { mime: 'audio/wav' });

      expect(result.status).toBe('done');
      if (result.status !== 'done') throw new Error('esperava done (binário/modelo presentes?)');
      expect(typeof result.text).toBe('string');
    });
  },
);
