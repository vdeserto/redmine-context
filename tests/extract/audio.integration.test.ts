/**
 * Teste de integração REAL da conversão áudio → WAV (M4-04, #60, ADR-002) —
 * opt-in. Só roda com `FFMPEG_INTEGRATION=1` (evita depender do binário em
 * CI/headless). Gera um WAV estéreo 8 kHz EM RUNTIME (fixture em `./audio-wav.ts`),
 * converte pelo pipeline REAL (ffmpeg de verdade, sem mock de `child_process`) e
 * valida, lendo o header do WAV de saída, que o resultado é 16 kHz mono — provando
 * o resample (`-ar 16000`) e o downmix (`-ac 1`).
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { convertAudioToWav } from '../../src/extract/audio.js';
import { makeWavFixture, readWavHeader } from './audio-wav.js';

describe.skipIf(!process.env.FFMPEG_INTEGRATION)(
  'convertAudioToWav (integração real com o binário ffmpeg)',
  () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'rc-audio-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('converte um WAV estéreo 8 kHz em WAV mono 16 kHz gravado no dir temp', async () => {
      const input = join(dir, 'source.wav');
      await writeFile(input, makeWavFixture({ sampleRate: 8000, channels: 2, durationSec: 0.2 }));

      const result = await convertAudioToWav(input, { tempDir: dir });

      expect(result.status).toBe('done');
      if (result.status !== 'done') throw new Error('esperava done');
      expect(result.wavPath.startsWith(dir)).toBe(true);
      expect(result.wavPath.endsWith('.wav')).toBe(true);

      const header = readWavHeader(await readFile(result.wavPath));
      expect(header.sampleRate).toBe(16000);
      expect(header.channels).toBe(1);
    });
  },
);
