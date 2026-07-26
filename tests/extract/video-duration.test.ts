/**
 * Testes unitários do LIMITE DE DURAÇÃO de vídeo via `ffprobe` (M4-09, #65,
 * ADR-002). Escritos ANTES da implementação (TDD). HERMÉTICOS: o executor do
 * `ffprobe`, o localizador do binário e a sonda de duração são INJETADOS — nenhum
 * ffprobe/ffmpeg real é chamado, nenhum FS real é tocado.
 *
 * Provam:
 * - `probeVideoDuration` monta os args seguros do ffprobe (`-protocol_whitelist
 *   file` precedendo o arquivo, `-show_entries format=duration`, `-of
 *   default=nw=1:nk=1`) e parseia a duração em segundos.
 * - ffprobe ausente / saída inválida / erro / timeout → `unavailable` com motivo,
 *   NUNCA lança (degradação graciosa).
 * - `extractVideoTranscript`: duração > limite → transcrição PULADA (`skipped`)
 *   com metadados (duração/limite/motivo), transcritor NÃO chamado, e o KEYFRAME
 *   AINDA é extraído/anexado (AC explícito). Limite configurável é respeitado.
 *   Duração indisponível (ffprobe ausente) → prossegue (não bloqueia).
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
}));

import { execFile } from 'node:child_process';

import type { ExtractOptions } from '../../src/extract/dispatcher.js';
import type { ExtractionResult } from '../../src/contract.js';

import {
  extractVideoTranscript,
  parseFfprobeDuration,
  probeVideoDuration,
  type DurationProbeResult,
  type FfprobeInvocation,
  type KeyframeResult,
} from '../../src/extract/video.js';

/** Índice do valor imediatamente após uma flag nos args (ou undefined se ausente). */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

describe('parseFfprobeDuration', () => {
  it('parseia a duração em segundos (float) da saída do ffprobe', () => {
    expect(parseFfprobeDuration('123.456\n')).toBeCloseTo(123.456);
  });

  it('devolve undefined para saída vazia, "N/A" ou não-numérica', () => {
    expect(parseFfprobeDuration('')).toBeUndefined();
    expect(parseFfprobeDuration('   ')).toBeUndefined();
    expect(parseFfprobeDuration('N/A')).toBeUndefined();
    expect(parseFfprobeDuration('nan')).toBeUndefined();
  });

  it('rejeita valores negativos (dado degenerado)', () => {
    expect(parseFfprobeDuration('-5')).toBeUndefined();
  });
});

describe('probeVideoDuration: sonda de duração via ffprobe', () => {
  it('monta args seguros e devolve a duração em segundos (ok)', async () => {
    let captured: FfprobeInvocation | undefined;
    const result = await probeVideoDuration('/cache/att/clip.mp4', {
      findFfprobeBinary: () => '/opt/homebrew/bin/ffprobe',
      run: async (invocation) => {
        captured = invocation;
        return '95.5\n';
      },
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('esperava ok');
    expect(result.seconds).toBeCloseTo(95.5);

    const args = captured?.args ?? [];
    // ADR-002: whitelist de protocolo obrigatória e precedendo o arquivo de entrada.
    expect(valueAfter(args, '-protocol_whitelist')).toBe('file');
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(args.indexOf('/cache/att/clip.mp4'));
    // Só a duração do container, saída crua sem chave/wrapper.
    expect(valueAfter(args, '-show_entries')).toBe('format=duration');
    expect(valueAfter(args, '-of')).toBe('default=nw=1:nk=1');
    // O arquivo de entrada é o último argumento (posicional).
    expect(args.at(-1)).toBe('/cache/att/clip.mp4');
    // Env sanitizado (só PATH, sem segredos do pai).
    expect(Object.keys(captured?.env ?? {})).toContain('PATH');
  });

  it('ffprobe ausente → unavailable/ffprobe-nao-instalado (nunca lança)', async () => {
    const warn = vi.fn();
    const result = await probeVideoDuration('/cache/att/x.mp4', {
      findFfprobeBinary: () => undefined,
      run: async () => '999',
      logger: { warn } as never,
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('esperava unavailable');
    expect(result.reason).toBe('ffprobe-nao-instalado');
    expect(warn).toHaveBeenCalled();
  });

  it('saída não-parseável → unavailable/duracao-indisponivel', async () => {
    const result = await probeVideoDuration('/cache/att/x.mp4', {
      findFfprobeBinary: () => '/bin/ffprobe',
      run: async () => 'N/A\n',
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('esperava unavailable');
    expect(result.reason).toBe('duracao-indisponivel');
  });

  it('erro do ffprobe → unavailable/erro-ffprobe com a mensagem subjacente', async () => {
    const result = await probeVideoDuration('/cache/att/x.mp4', {
      findFfprobeBinary: () => '/bin/ffprobe',
      run: async () => {
        throw new Error('Invalid data found when processing input');
      },
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('esperava unavailable');
    expect(result.reason).toBe('erro-ffprobe');
    expect(result.error).toContain('Invalid data');
  });

  it('executor DEFAULT (sem run injetado) roda o ffprobe pelo watchdog e devolve a duração', async () => {
    // Cobre `defaultProbeRun`: o `execFile` mockado responde na hora com a duração.
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation(((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (e: Error | null, o: string, s: string) => void;
      cb(null, '12.5\n', '');
      return { kill: vi.fn() };
    }) as unknown as typeof execFile);

    const result = await probeVideoDuration('/cache/att/clip.mp4', {
      findFfprobeBinary: () => '/bin/ffprobe',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('esperava ok');
    expect(result.seconds).toBeCloseTo(12.5);
  });

  it('timeout do runner → unavailable/timeout', async () => {
    const result = await probeVideoDuration('/cache/att/x.mp4', {
      findFfprobeBinary: () => '/bin/ffprobe',
      run: async () => {
        const err = new Error('ffprobe excedeu o timeout de 1000ms e foi encerrado');
        err.name = 'FfprobeTimeoutError';
        throw err;
      },
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('esperava unavailable');
    expect(result.reason).toBe('timeout');
  });
});

/** Transcritor fake que registra se foi chamado (para provar o curto-circuito no skip). */
interface TranscribeCall {
  filePath?: string;
}
function fakeTranscriber(
  call: TranscribeCall,
  result: ExtractionResult,
): { extract: (filePath: string, options: ExtractOptions) => Promise<ExtractionResult> } {
  return {
    extract: async (filePath) => {
      call.filePath = filePath;
      return result;
    },
  };
}

/** Keyframe stub de sucesso — prova que o keyframe é preservado mesmo no skip. */
const okKeyframe = async (): Promise<KeyframeResult> => ({
  status: 'done',
  keyframePath: '/cache/att/12-ab/keyframe.jpg',
});

describe('extractVideoTranscript: limite de duração (ffprobe) com pular-com-aviso', () => {
  it('duração > limite → skipped com metadados (duração/limite/motivo), transcritor NÃO chamado', async () => {
    const call: TranscribeCall = {};
    const convert = vi.fn(async () => ({ status: 'done' as const, wavPath: '/cache/tmp/a.wav' }));
    const warn = vi.fn();

    const result = await extractVideoTranscript('/cache/att/12-ab/original.mp4', {
      mime: 'video/mp4',
      maxDurationSeconds: 1200,
      probeDuration: async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 1800 }),
      convert,
      transcriber: fakeTranscriber(call, { status: 'done', text: 'nunca' }),
      extractKeyframe: okKeyframe,
      rm: async () => undefined,
      logger: { warn } as never,
    });

    expect(result.status).toBe('skipped');
    expect(result.mime).toBe('video/mp4');
    expect(result.metadata?.reason).toBe('video-excede-limite-duracao');
    expect(result.metadata?.durationSeconds).toBe(1800);
    expect(result.metadata?.limitSeconds).toBe(1200);
    // A conversão/transcrição são puladas ANTES de gastar CPU no vídeo grande.
    expect(convert).not.toHaveBeenCalled();
    expect(call.filePath).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('o KEYFRAME ainda é extraído e referenciado quando a transcrição é pulada (AC explícito)', async () => {
    const result = await extractVideoTranscript('/cache/att/12-ab/original.mp4', {
      mime: 'video/mp4',
      maxDurationSeconds: 1200,
      probeDuration: async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 5000 }),
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/a.wav' }),
      transcriber: fakeTranscriber({}, { status: 'done', text: 'nunca' }),
      extractKeyframe: okKeyframe,
      rm: async () => undefined,
    });

    expect(result.status).toBe('skipped');
    const keyframe = result.artifacts?.find((a) => a.kind === 'keyframe');
    expect(keyframe?.path).toBe('/cache/att/12-ab/keyframe.jpg');
    expect(keyframe?.mime).toBe('image/jpeg');
  });

  it('limite CONFIGURÁVEL é respeitado: um vídeo curto excede um limite baixo customizado', async () => {
    const call: TranscribeCall = {};
    const result = await extractVideoTranscript('/cache/att/12-ab/original.mp4', {
      mime: 'video/mp4',
      maxDurationSeconds: 60, // limite baixo customizado
      probeDuration: async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 90 }),
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/a.wav' }),
      transcriber: fakeTranscriber(call, { status: 'done', text: 'nunca' }),
      extractKeyframe: okKeyframe,
      rm: async () => undefined,
    });

    expect(result.status).toBe('skipped');
    expect(result.metadata?.limitSeconds).toBe(60);
    expect(result.metadata?.durationSeconds).toBe(90);
    expect(call.filePath).toBeUndefined();
  });

  it('duração DENTRO do limite → prossegue para a transcrição normalmente', async () => {
    const call: TranscribeCall = {};
    const result = await extractVideoTranscript('/cache/att/12-ab/original.mp4', {
      mime: 'video/mp4',
      maxDurationSeconds: 1200,
      probeDuration: async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 300 }),
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/a.wav' }),
      transcriber: fakeTranscriber(call, { status: 'done', text: 'olá mundo' }),
      extractKeyframe: okKeyframe,
      rm: async () => undefined,
    });

    expect(result.status).toBe('done');
    expect(result.text).toBe('olá mundo');
    expect(call.filePath).toBe('/cache/tmp/a.wav');
  });

  it('duração INDISPONÍVEL (ffprobe ausente) → degrada e PROSSEGUE com a transcrição (não bloqueia)', async () => {
    const call: TranscribeCall = {};
    const result = await extractVideoTranscript('/cache/att/12-ab/original.mp4', {
      mime: 'video/mp4',
      probeDuration: async (): Promise<DurationProbeResult> => ({
        status: 'unavailable',
        reason: 'ffprobe-nao-instalado',
      }),
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/a.wav' }),
      transcriber: fakeTranscriber(call, { status: 'done', text: 'transcrito' }),
      extractKeyframe: okKeyframe,
      rm: async () => undefined,
    });

    expect(result.status).toBe('done');
    expect(result.text).toBe('transcrito');
    expect(call.filePath).toBe('/cache/tmp/a.wav');
  });

  it('uma sonda de duração que LANÇA não derruba o pipeline: prossegue (best-effort)', async () => {
    const call: TranscribeCall = {};
    const result = await extractVideoTranscript('/cache/att/12-ab/original.mp4', {
      mime: 'video/mp4',
      probeDuration: async (): Promise<DurationProbeResult> => {
        throw new Error('ffprobe explodiu');
      },
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/a.wav' }),
      transcriber: fakeTranscriber(call, { status: 'done', text: 'resiliente' }),
      extractKeyframe: okKeyframe,
      rm: async () => undefined,
    });

    expect(result.status).toBe('done');
    expect(result.text).toBe('resiliente');
    expect(call.filePath).toBe('/cache/tmp/a.wav');
  });

  it('usa o limite default de 20 min (1200s) quando maxDurationSeconds não é informado', async () => {
    const call: TranscribeCall = {};
    const result = await extractVideoTranscript('/cache/att/12-ab/original.mp4', {
      mime: 'video/mp4',
      probeDuration: async (): Promise<DurationProbeResult> => ({ status: 'ok', seconds: 1201 }),
      convert: async () => ({ status: 'done', wavPath: '/cache/tmp/a.wav' }),
      transcriber: fakeTranscriber(call, { status: 'done', text: 'nunca' }),
      extractKeyframe: okKeyframe,
      rm: async () => undefined,
    });

    expect(result.status).toBe('skipped');
    expect(result.metadata?.limitSeconds).toBe(1200);
    expect(call.filePath).toBeUndefined();
  });
});
