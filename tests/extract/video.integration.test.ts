/**
 * Teste de integração REAL da extração de áudio de VÍDEO (M4-07, #63, ADR-002) —
 * opt-in. Só roda com `FFMPEG_INTEGRATION=1` (evita depender do binário em
 * CI/headless, como a #60). Gera EM RUNTIME, com o próprio ffmpeg, dois vídeos
 * curtos via `lavfi`: um COM faixa de áudio (testsrc + sine) e um SEM áudio
 * (testsrc apenas). Roda o pipeline REAL de extração (`convertVideoToWav`) e valida:
 *
 * - vídeo com áudio → WAV 16 kHz mono (resample `-ar 16000` + downmix `-ac 1`),
 *   lendo o header do WAV de saída;
 * - vídeo sem áudio → `failed` com reason `video-sem-audio` (sem crash).
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { convertVideoToWav } from '../../src/extract/video.js';
import { findFfmpeg } from '../../src/extract/ffmpeg.js';
import { readWavHeader } from './audio-wav.js';

const run = promisify(execFile);

/**
 * Gera um vídeo curto via `lavfi` do ffmpeg. Com `withAudio`, mixa um tom senoidal
 * como faixa de áudio; sem ele, produz um vídeo mudo (sem stream de áudio).
 */
async function makeVideoFixture(bin: string, outputPath: string, withAudio: boolean): Promise<void> {
  const videoInput = ['-f', 'lavfi', '-i', 'testsrc=duration=0.3:size=64x64:rate=10'];
  const audioInput = withAudio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3'] : [];
  const encode = ['-pix_fmt', 'yuv420p', '-shortest', '-y', outputPath];
  await run(bin, [...videoInput, ...audioInput, ...encode], { encoding: 'utf8' });
}

describe.skipIf(!process.env.FFMPEG_INTEGRATION)(
  'convertVideoToWav (integração real com o binário ffmpeg)',
  () => {
    let dir: string;
    const bin = findFfmpeg()?.path ?? 'ffmpeg';

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'rc-video-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('extrai a faixa de áudio de um mp4 e grava um WAV mono 16 kHz no dir temp', async () => {
      const input = join(dir, 'with-audio.mp4');
      await makeVideoFixture(bin, input, true);

      const result = await convertVideoToWav(input, { tempDir: dir });

      expect(result.status).toBe('done');
      if (result.status !== 'done') throw new Error('esperava done');
      expect(result.wavPath.endsWith('.wav')).toBe(true);

      const header = readWavHeader(await readFile(result.wavPath));
      expect(header.sampleRate).toBe(16000);
      expect(header.channels).toBe(1);
    });

    it('vídeo SEM faixa de áudio → failed com reason video-sem-audio (sem crash)', async () => {
      const input = join(dir, 'no-audio.mp4');
      await makeVideoFixture(bin, input, false);

      const result = await convertVideoToWav(input, { tempDir: dir });

      expect(result.status).toBe('failed');
      if (result.status !== 'failed') throw new Error('esperava failed');
      expect(result.reason).toBe('video-sem-audio');
    });
  },
);
