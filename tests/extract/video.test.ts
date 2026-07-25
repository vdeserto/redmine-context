/**
 * Testes unitários da extração de faixa de áudio de VÍDEO + pipeline
 * vídeo→áudio→transcrição (M4-07, #63, ADR-002). Escritos ANTES da implementação
 * (TDD). HERMÉTICOS: o executor do subprocesso e as dependências (conversão,
 * transcritor, `rm`) são INJETADOS — nenhum ffmpeg/whisper real, nenhum FS real é
 * tocado aqui (o teste de integração REAL, opt-in por `FFMPEG_INTEGRATION`, vive
 * em `video.integration.test.ts`).
 *
 * Provam:
 * - `convertVideoToWav` REUSA a conversão da #60: os args incluem
 *   `-protocol_whitelist file` (precedendo `-i`), `-vn`, `-ar 16000 -ac 1` — a
 *   mesma operação ffmpeg, agora com ENTRADA de vídeo.
 * - vídeo SEM faixa de áudio: o ffmpeg falha com "does not contain any stream" →
 *   remapeado para `failed` com reason `video-sem-audio` (caso NOVO do vídeo), sem
 *   crash; demais erros continuam `erro-conversao`; binário ausente/timeout passam.
 * - `extractVideoTranscript` orquestra vídeo→WAV→whisper num job: passa o WAV ao
 *   transcritor; falha na conversão curto-circuita (transcritor não é chamado);
 *   whisper falho NÃO derruba a extração (resultado gracioso); o WAV intermediário
 *   é limpo (best-effort) em qualquer desfecho.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock do child_process/fs (só os defaults os usam). Os testes por INJEÇÃO passam
// seu próprio `run`/`rm` e não tocam estes mocks.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
}));

import type { ExtractOptions } from '../../src/extract/dispatcher.js';
import type { FfmpegInvocation } from '../../src/extract/audio.js';
import type { ExtractionResult } from '../../src/contract.js';

import {
  convertVideoToWav,
  extractVideoTranscript,
  VIDEO_MIMES,
} from '../../src/extract/video.js';

/** Captura a invocação passada ao runner ffmpeg injetado para asserção de args/env. */
interface Captured {
  invocation?: FfmpegInvocation;
}

/**
 * Options herméticas de `convertVideoToWav`: binário fixo, `mkdir` no-op (sem FS),
 * tempDir fake e um runner que captura a invocação e resolve/rejeita conforme
 * `behavior`. Reusa a superfície de opções de `convertAudioToWav` (#60).
 */
function hermeticConvert(
  captured: Captured,
  behavior: (invocation: FfmpegInvocation) => Promise<void>,
): Parameters<typeof convertVideoToWav>[1] {
  return {
    findFfmpegBinary: () => '/opt/homebrew/bin/ffmpeg',
    tempDir: '/cache/tmp',
    mkdir: async () => undefined,
    rm: async () => undefined,
    run: async (invocation) => {
      captured.invocation = invocation;
      await behavior(invocation);
    },
  };
}

/** Índice do valor imediatamente após uma flag nos args (ou undefined se ausente). */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

/** Mensagem de erro típica do ffmpeg quando o container de vídeo não tem áudio. */
const NO_AUDIO_ERROR = 'ffmpeg exit 1: Output file #0 does not contain any stream';

describe('convertVideoToWav: reuso da conversão ffmpeg com entrada de vídeo', () => {
  it('invoca o runner SEM shell com -protocol_whitelist file, -vn e -ar 16000 -ac 1 para um mp4', async () => {
    const captured: Captured = {};
    const result = await convertVideoToWav(
      '/cache/att/screencast.mp4',
      hermeticConvert(captured, async () => undefined),
    );

    expect(result.status).toBe('done');
    if (result.status !== 'done') throw new Error('esperava done');

    const args = captured.invocation?.args ?? [];
    // ADR-002: whitelist de protocolo obrigatória e precedendo o `-i` (opção de INPUT).
    expect(valueAfter(args, '-protocol_whitelist')).toBe('file');
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(args.indexOf('-i'));
    // `-vn` descarta a faixa de vídeo, extraindo só o áudio → WAV.
    expect(args).toContain('-vn');
    // 16 kHz mono PCM (o que o whisper.cpp espera) — mesma operação da #60.
    expect(valueAfter(args, '-ar')).toBe('16000');
    expect(valueAfter(args, '-ac')).toBe('1');
    expect(valueAfter(args, '-c:a')).toBe('pcm_s16le');
    expect(valueAfter(args, '-i')).toBe('/cache/att/screencast.mp4');
    // Saída WAV no dir temp do cache, coincidindo com o wavPath devolvido.
    const output = args.at(-1) ?? '';
    expect(output.endsWith('.wav')).toBe(true);
    expect(result.wavPath).toBe(output);
  });
});

describe('convertVideoToWav: vídeo sem faixa de áudio (caso NOVO do vídeo)', () => {
  it('mapeia o erro "does not contain any stream" do ffmpeg para failed/video-sem-audio, sem crash', async () => {
    const captured: Captured = {};
    const result = await convertVideoToWav(
      '/cache/att/mudo.mp4',
      hermeticConvert(captured, async () => {
        throw new Error(NO_AUDIO_ERROR);
      }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('video-sem-audio');
    expect(result.error).toContain('does not contain any stream');
    expect(result.hint).toBeDefined();
  });

  it('reconhece a variação "Stream map matches no streams" como vídeo sem áudio', async () => {
    const captured: Captured = {};
    const result = await convertVideoToWav(
      '/cache/att/mudo.mkv',
      hermeticConvert(captured, async () => {
        throw new Error("Stream map '0:a' matches no streams.");
      }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('video-sem-audio');
  });

  it('erro de conversão GENÉRICO continua reason erro-conversao (não confunde com sem-áudio)', async () => {
    const captured: Captured = {};
    const result = await convertVideoToWav(
      '/cache/att/corrompido.mp4',
      hermeticConvert(captured, async () => {
        throw new Error('Invalid data found when processing input');
      }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('erro-conversao');
  });

  it('binário ffmpeg ausente passa direto como ffmpeg-nao-instalado (degradação graciosa)', async () => {
    const result = await convertVideoToWav('/cache/att/x.mp4', {
      findFfmpegBinary: () => undefined,
      run: async () => undefined,
      mkdir: async () => undefined,
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('ffmpeg-nao-instalado');
  });

  it('timeout do runner passa direto como reason timeout', async () => {
    const captured: Captured = {};
    const result = await convertVideoToWav(
      '/cache/att/lento.mp4',
      hermeticConvert(captured, async () => {
        const err = new Error('ffmpeg excedeu o timeout de 1000ms e foi encerrado');
        err.name = 'FfmpegTimeoutError';
        throw err;
      }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('esperava failed');
    expect(result.reason).toBe('timeout');
  });
});

/** Transcritor fake (contrato do whisper) que captura o WAV/mime recebidos. */
interface TranscribeCall {
  filePath?: string;
  options?: ExtractOptions;
}

function fakeTranscriber(
  call: TranscribeCall,
  result: ExtractionResult,
): { extract: (filePath: string, options: ExtractOptions) => Promise<ExtractionResult> } {
  return {
    extract: async (filePath, options) => {
      call.filePath = filePath;
      call.options = options;
      return result;
    },
  };
}

describe('extractVideoTranscript: pipeline vídeo→áudio→transcrição num job', () => {
  it('extrai o áudio e passa o WAV ao transcritor, devolvendo a transcrição (done)', async () => {
    const call: TranscribeCall = {};
    const rm = vi.fn(async () => undefined);
    const transcript: ExtractionResult = {
      status: 'done',
      text: 'olá mundo',
      mime: 'video/mp4',
      metadata: { extractorId: 'whisper-transcribe' },
    };

    const result = await extractVideoTranscript('/cache/att/clip.mp4', {
      mime: 'video/mp4',
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/abc.wav' }),
      transcriber: fakeTranscriber(call, transcript),
      rm,
    });

    // O transcritor recebeu EXATAMENTE o WAV extraído + o mime do vídeo.
    expect(call.filePath).toBe('/cache/tmp/abc.wav');
    expect(call.options?.mime).toBe('video/mp4');
    // Devolve o resultado do whisper sem status paralelo.
    expect(result.status).toBe('done');
    expect(result.text).toBe('olá mundo');
    // O WAV intermediário é limpo (best-effort) após a transcrição.
    expect(rm).toHaveBeenCalledWith('/cache/tmp/abc.wav');
  });

  it('usa mime audio/wav por default quando o mime do vídeo não é informado', async () => {
    const call: TranscribeCall = {};
    await extractVideoTranscript('/cache/att/clip.mp4', {
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/x.wav' }),
      transcriber: fakeTranscriber(call, { status: 'done', text: '' }),
      rm: async () => undefined,
    });
    expect(call.options?.mime).toBe('audio/wav');
  });

  it('falha na conversão (vídeo sem áudio) curto-circuita: não chama o transcritor nem limpa WAV inexistente', async () => {
    const call: TranscribeCall = {};
    const rm = vi.fn(async () => undefined);
    const transcriber = fakeTranscriber(call, { status: 'done', text: 'nunca' });

    const result = await extractVideoTranscript('/cache/att/mudo.mp4', {
      mime: 'video/mp4',
      convert: async () => ({
        status: 'failed',
        reason: 'video-sem-audio',
        error: 'Output file #0 does not contain any stream',
        hint: 'sem faixa de áudio',
      }),
      transcriber,
      rm,
    });

    expect(result.status).toBe('failed');
    expect(result.mime).toBe('video/mp4');
    expect(result.metadata?.reason).toBe('video-sem-audio');
    expect(call.filePath).toBeUndefined(); // transcritor NÃO foi chamado
    expect(rm).not.toHaveBeenCalled(); // não há WAV para limpar
  });

  it('falha na conversão por ffmpeg ausente propaga reason + hint no resultado', async () => {
    const result = await extractVideoTranscript('/cache/att/x.mp4', {
      convert: async () => ({
        status: 'failed',
        reason: 'ffmpeg-nao-instalado',
        hint: 'instale o ffmpeg',
      }),
      transcriber: fakeTranscriber({}, { status: 'done', text: '' }),
      rm: async () => undefined,
    });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('ffmpeg-nao-instalado');
    expect(result.metadata?.hint).toBe('instale o ffmpeg');
  });

  it('sem convert injetado, usa convertVideoToWav real com convertOptions (ffmpeg ausente → failed)', async () => {
    const call: TranscribeCall = {};
    // Sem `convert`: exercita o wiring default (convertVideoToWav) via convertOptions.
    const result = await extractVideoTranscript('/cache/att/clip.mp4', {
      mime: 'video/mp4',
      convertOptions: { findFfmpegBinary: () => undefined, mkdir: async () => undefined },
      transcriber: fakeTranscriber(call, { status: 'done', text: 'nunca' }),
      rm: async () => undefined,
    });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('ffmpeg-nao-instalado');
    expect(call.filePath).toBeUndefined(); // conversão falhou antes do transcritor
  });

  it('whisper FALHO não derruba a extração do áudio: devolve o failed gracioso e limpa o WAV', async () => {
    const call: TranscribeCall = {};
    const rm = vi.fn(async () => undefined);
    const whisperFailed: ExtractionResult = {
      status: 'failed',
      mime: 'video/mp4',
      metadata: { extractorId: 'whisper-transcribe', reason: 'erro-transcricao' },
    };

    const result = await extractVideoTranscript('/cache/att/clip.mp4', {
      mime: 'video/mp4',
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/y.wav' }),
      transcriber: fakeTranscriber(call, whisperFailed),
      rm,
    });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('erro-transcricao');
    // Mesmo com o whisper falho, o WAV extraído com sucesso é limpo.
    expect(rm).toHaveBeenCalledWith('/cache/tmp/y.wav');
  });

  it('transcritor que LANÇA não quebra o bundle: vira failed/erro-transcricao e limpa o WAV', async () => {
    const rm = vi.fn(async () => undefined);
    const result = await extractVideoTranscript('/cache/att/clip.mp4', {
      mime: 'video/mp4',
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/z.wav' }),
      transcriber: {
        extract: async () => {
          throw new Error('whisper crashou');
        },
      },
      rm,
    });

    expect(result.status).toBe('failed');
    expect(result.metadata?.reason).toBe('erro-transcricao');
    expect(result.metadata?.error).toContain('whisper crashou');
    expect(rm).toHaveBeenCalledWith('/cache/tmp/z.wav');
  });

  it('falha ao limpar o WAV é best-effort e não mascara a transcrição bem-sucedida', async () => {
    const rm = vi.fn(async () => {
      throw new Error('EACCES');
    });
    const result = await extractVideoTranscript('/cache/att/clip.mp4', {
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/w.wav' }),
      transcriber: fakeTranscriber({}, { status: 'done', text: 'ok' }),
      rm,
    });

    expect(result.status).toBe('done');
    expect(result.text).toBe('ok');
  });
});

describe('VIDEO_MIMES', () => {
  it('inclui os contêineres de vídeo comuns (mp4/quicktime/matroska/webm)', () => {
    expect(VIDEO_MIMES).toContain('video/mp4');
    expect(VIDEO_MIMES).toContain('video/quicktime');
    expect(VIDEO_MIMES).toContain('video/x-matroska');
    expect(VIDEO_MIMES).toContain('video/webm');
  });
});
