/**
 * Testes do diagnóstico de binários de mídia (M3-11 #53, M4-01 #57, ADR-002).
 * Escrito ANTES da implementação (TDD). A plataforma, a localização de CADA
 * binário, a detecção de versão e a listagem do diretório de modelos são TODAS
 * injetadas — nenhum binário real é chamado e nenhum acesso ao filesystem real
 * acontece aqui. Provam: hint correto por SO (darwin/linux/win32) para tesseract,
 * ffmpeg e whisper.cpp; estados found/ausente por binário; whisper sem versão
 * reportando o path como evidência; e o status do modelo GGUF (presente/ausente).
 */
import { describe, expect, it, vi } from 'vitest';

import { diagnoseBinaries, pdftotextInstallHint, tesseractInstallHint } from '../../src/config/doctor.js';

/**
 * Deps de pdftotext injetadas por padrão nos testes de tesseract para mantê-los
 * HERMÉTICOS — sem essas injeções, o diagnóstico do pdftotext cairia no
 * filesystem/binário reais. Aqui o pdftotext é sempre "não instalado".
 */
const noPdftotext = {
  findPdftotext: () => undefined,
  detectPdftotextVersion: vi.fn(),
};
import {
  diagnoseBinaries,
  ffmpegInstallHint,
  tesseractInstallHint,
  whisperInstallHint,
  type DiagnoseBinariesOptions,
} from '../../src/config/doctor.js';

/**
 * Deps de base HERMÉTICAS: tudo "ausente" por default. Cada teste sobrescreve
 * apenas o que precisa — garante que nenhum localizador/versão/FS reais rodem.
 */
function baseDeps(overrides: DiagnoseBinariesOptions = {}): DiagnoseBinariesOptions {
  return {
    platform: 'linux',
    findTesseract: () => undefined,
    detectTesseractVersion: vi.fn(),
    findFfmpeg: () => undefined,
    detectFfmpegVersion: vi.fn(),
    findWhisper: () => undefined,
    whisperModelDir: () => '/tmp/rc-models-none',
    listDir: () => [],
    ...overrides,
  };
}

/** Localiza uma entrada do diagnóstico pelo nome. */
async function diagnose(name: string, overrides: DiagnoseBinariesOptions = {}) {
  const list = await diagnoseBinaries(baseDeps(overrides));
  const entry = list.find((item) => item.name === name);
  if (entry === undefined) throw new Error(`entrada não encontrada: ${name}`);
  return entry;
}
describe('core: tesseractInstallHint — instrução por SO', () => {
  it('darwin: sugere brew', () => {
    expect(tesseractInstallHint('darwin')).toContain('brew install tesseract tesseract-lang');
  });

  it('linux: sugere apt e dnf', () => {
    const hint = tesseractInstallHint('linux');
    expect(hint).toContain('apt');
    expect(hint).toContain('dnf');
    expect(hint).toContain('tesseract');
  });

  it('win32: sugere winget UB-Mannheim e cita o path convencional', () => {
    const hint = tesseractInstallHint('win32');
    expect(hint).toContain('winget install UB-Mannheim.TesseractOCR');
    expect(hint).toContain('Tesseract-OCR');
  });

  it('plataforma desconhecida cai no hint genérico (apt/dnf)', () => {
    expect(tesseractInstallHint('freebsd' as NodeJS.Platform)).toContain('apt');
  });

  it('NÃO menciona o opt-in --download-binaries (tesseract não tem artefato oficial)', () => {
    for (const os of ['darwin', 'linux', 'win32'] as const) {
      expect(tesseractInstallHint(os)).not.toContain('--download-binaries');
    }
  });
});

describe('core: ffmpegInstallHint — instrução por SO com opt-in e BtbN', () => {
  it('darwin: brew install ffmpeg + opt-in + BtbN', () => {
    const hint = ffmpegInstallHint('darwin');
    expect(hint).toContain('brew install ffmpeg');
    expect(hint).toContain('--download-binaries');
    expect(hint).toContain('BtbN');
  });

    const [tesseract] = await diagnoseBinaries({
      platform: 'darwin',
      findTesseract,
      detectTesseractVersion,
      ...noPdftotext,
    });
  it('linux: apt/dnf install ffmpeg + BtbN', () => {
    const hint = ffmpegInstallHint('linux');
    expect(hint).toContain('apt install ffmpeg');
    expect(hint).toContain('dnf');
    expect(hint).toContain('BtbN');
  });
  it('win32: winget + BtbN', () => {
    const hint = ffmpegInstallHint('win32');
    expect(hint).toContain('winget');
    expect(hint).toContain('BtbN');
  });
});

describe('core: whisperInstallHint — instrução por SO com opt-in e releases', () => {
  it('darwin: brew install whisper-cpp + opt-in + releases', () => {
    const hint = whisperInstallHint('darwin');
    expect(hint).toContain('brew install whisper-cpp');
    expect(hint).toContain('--download-binaries');
    expect(hint).toContain('github.com/ggml-org/whisper.cpp/releases');
  });

  it('linux: whisper-cpp/compilar + releases', () => {
    const hint = whisperInstallHint('linux');
    expect(hint).toContain('whisper-cpp');
    expect(hint).toContain('releases');
  });

  it('win32: releases do GitHub', () => {
    expect(whisperInstallHint('win32')).toContain('github.com/ggml-org/whisper.cpp/releases');
  });
});

describe('core: diagnoseBinaries — ordem e composição', () => {
  it('retorna tesseract, ffmpeg, whisper.cpp e o modelo GGUF, nessa ordem', async () => {
    const list = await diagnoseBinaries(baseDeps({ platform: 'darwin' }));
    expect(list.map((item) => item.name)).toEqual([
      'tesseract',
      'ffmpeg',
      'whisper.cpp',
      'modelo whisper (GGUF)',
    ]);
  });
});

describe('core: diagnoseBinaries — tesseract', () => {
  it('found=true com path e versão quando localizado e a versão é legível', async () => {
    const tesseract = await diagnose('tesseract', {
      platform: 'darwin',
      findTesseract: vi.fn().mockReturnValue({ path: '/opt/homebrew/bin/tesseract' }),
      detectTesseractVersion: vi.fn().mockResolvedValue('5.5.0'),
    });
    expect(tesseract).toEqual({
      name: 'tesseract',
      found: true,
      path: '/opt/homebrew/bin/tesseract',
      version: '5.5.0',
      installHint: expect.stringContaining('brew'),
    });
  });

  it('found=true sem versão quando o binário existe mas a versão é ilegível', async () => {
    const findTesseract = vi.fn().mockReturnValue({ path: '/usr/bin/tesseract' });
    const detectTesseractVersion = vi.fn().mockResolvedValue(undefined);

    const [tesseract] = await diagnoseBinaries({
      platform: 'linux',
      findTesseract,
      detectTesseractVersion,
      ...noPdftotext,
    });
    const tesseract = await diagnose('tesseract', {
      findTesseract: vi.fn().mockReturnValue({ path: '/usr/bin/tesseract' }),
      detectTesseractVersion: vi.fn().mockResolvedValue(undefined),
    });    expect(tesseract.found).toBe(true);
    expect(tesseract.path).toBe('/usr/bin/tesseract');
    expect(tesseract.version).toBeUndefined();
  });

  it('ausente: found=false, sem path/versão, hint do SO e SEM detectar versão', async () => {
    const detectTesseractVersion = vi.fn();

    const [tesseract] = await diagnoseBinaries({
      platform: 'win32',
      findTesseract,
      detectTesseractVersion,
      ...noPdftotext,
    });
    const tesseract = await diagnose('tesseract', {
      platform: 'win32',
      findTesseract: vi.fn().mockReturnValue(undefined),
      detectTesseractVersion,
    });    expect(tesseract).toEqual({
      name: 'tesseract',
      found: false,
      installHint: expect.stringContaining('winget install UB-Mannheim.TesseractOCR'),
    });
    expect(detectTesseractVersion).not.toHaveBeenCalled();
  });
});

describe('core: pdftotextInstallHint — instrução por SO', () => {
  it('darwin: sugere brew install poppler', () => {
    expect(pdftotextInstallHint('darwin')).toBe('brew install poppler');
  });

  it('linux: sugere apt e dnf com poppler-utils', () => {
    const hint = pdftotextInstallHint('linux');
    expect(hint).toContain('apt');
    expect(hint).toContain('dnf');
    expect(hint).toContain('poppler-utils');
  });

  it('win32: sugere winget oschwartz10612.Poppler e cita o choco como alternativa', () => {
    const hint = pdftotextInstallHint('win32');
    expect(hint).toContain('winget install oschwartz10612.Poppler');
    expect(hint).toContain('choco');
  });

  it('plataforma desconhecida cai no hint genérico (apt/dnf)', () => {
    expect(pdftotextInstallHint('freebsd' as NodeJS.Platform)).toContain('apt');
  });
});

describe('core: diagnoseBinaries — pdftotext (segundo binário)', () => {
  /** Deps de tesseract "ausente" para isolar as asserções no pdftotext. */
  const noTesseract = { findTesseract: () => undefined, detectTesseractVersion: vi.fn() };

  it('found=true com path e versão quando o pdftotext é localizado e legível', async () => {
    const findPdftotext = vi.fn().mockReturnValue({ path: '/opt/homebrew/bin/pdftotext' });
    const detectPdftotextVersion = vi.fn().mockResolvedValue('24.02.0');

    const [, pdftotext] = await diagnoseBinaries({
      platform: 'darwin',
      ...noTesseract,
      findPdftotext,
      detectPdftotextVersion,
    });

    expect(pdftotext).toEqual({
      name: 'pdftotext',
      found: true,
      path: '/opt/homebrew/bin/pdftotext',
      version: '24.02.0',
      installHint: 'brew install poppler',
    });
  });

  it('found=false, sem path/versão, com installHint do SO e sem detectar versão', async () => {
    const findPdftotext = vi.fn().mockReturnValue(undefined);
    const detectPdftotextVersion = vi.fn();

    const [, pdftotext] = await diagnoseBinaries({
      platform: 'win32',
      ...noTesseract,
      findPdftotext,
      detectPdftotextVersion,
    });

    expect(pdftotext).toEqual({
      name: 'pdftotext',
      found: false,
      installHint: expect.stringContaining('winget install oschwartz10612.Poppler'),
    });
    expect(pdftotext.path).toBeUndefined();
    expect(pdftotext.version).toBeUndefined();
    expect(detectPdftotextVersion).not.toHaveBeenCalled();
describe('core: diagnoseBinaries — ffmpeg', () => {
  it('found=true com path e versão da 1ª linha de `ffmpeg -version`', async () => {
    const ffmpeg = await diagnose('ffmpeg', {
      platform: 'darwin',
      findFfmpeg: vi.fn().mockReturnValue({ path: '/opt/homebrew/bin/ffmpeg' }),
      detectFfmpegVersion: vi.fn().mockResolvedValue('6.1.1'),
    });
    expect(ffmpeg).toEqual({
      name: 'ffmpeg',
      found: true,
      path: '/opt/homebrew/bin/ffmpeg',
      version: '6.1.1',
      installHint: expect.stringContaining('brew install ffmpeg'),
    });
  });

  it('found=true sem versão quando a saída é ilegível', async () => {
    const ffmpeg = await diagnose('ffmpeg', {
      findFfmpeg: vi.fn().mockReturnValue({ path: '/usr/bin/ffmpeg' }),
      detectFfmpegVersion: vi.fn().mockResolvedValue(undefined),
    });
    expect(ffmpeg.found).toBe(true);
    expect(ffmpeg.version).toBeUndefined();
  });

  it('ausente: found=false, hint com BtbN, SEM detectar versão', async () => {
    const detectFfmpegVersion = vi.fn();
    const ffmpeg = await diagnose('ffmpeg', {
      platform: 'linux',
      findFfmpeg: vi.fn().mockReturnValue(undefined),
      detectFfmpegVersion,
    });
    expect(ffmpeg.found).toBe(false);
    expect(ffmpeg.installHint).toContain('BtbN');
    expect(detectFfmpegVersion).not.toHaveBeenCalled();
  });
});

describe('core: diagnoseBinaries — whisper.cpp', () => {
  it('found=true com path (evidência) e SEM versão — reporta qual binário via path', async () => {
    const whisper = await diagnose('whisper.cpp', {
      platform: 'darwin',
      findWhisper: vi.fn().mockReturnValue({ path: '/opt/homebrew/bin/whisper-cli', binaryName: 'whisper-cli' }),
    });
    expect(whisper).toEqual({
      name: 'whisper.cpp',
      found: true,
      path: '/opt/homebrew/bin/whisper-cli',
      installHint: expect.stringContaining('brew install whisper-cpp'),
    });
    expect(whisper.version).toBeUndefined();
  });

  it('detecta também o binário legado `main` (path revela qual)', async () => {
    const whisper = await diagnose('whisper.cpp', {
      findWhisper: vi.fn().mockReturnValue({ path: '/usr/local/bin/main', binaryName: 'main' }),
    });
    expect(whisper.found).toBe(true);
    expect(whisper.path).toBe('/usr/local/bin/main');
  });

  it('ausente: found=false, hint com releases do GitHub', async () => {
    const whisper = await diagnose('whisper.cpp', {
      platform: 'win32',
      findWhisper: vi.fn().mockReturnValue(undefined),
    });
    expect(whisper.found).toBe(false);
    expect(whisper.installHint).toContain('github.com/ggml-org/whisper.cpp/releases');
  });
});

describe('core: diagnoseBinaries — modelo GGUF', () => {
  it('presente: found=true com path do .gguf no dir de cache', async () => {
    const model = await diagnose('modelo whisper (GGUF)', {
      whisperModelDir: () => '/cache/models',
      listDir: () => ['README.txt', 'ggml-base.gguf'],
    });
    expect(model.found).toBe(true);
    expect(model.path).toBe('/cache/models/ggml-base.gguf');
  });

  it('ausente (dir sem .gguf): found=false com hint apontando o dir e o opt-in', async () => {
    const model = await diagnose('modelo whisper (GGUF)', {
      whisperModelDir: () => '/cache/models',
      listDir: () => ['outro.bin'],
    });
    expect(model.found).toBe(false);
    expect(model.installHint).toContain('/cache/models');
    expect(model.installHint).toContain('--download-binaries');
  });

  it('degrada graciosamente quando o dir não existe (listDir lança)', async () => {
    const model = await diagnose('modelo whisper (GGUF)', {
      whisperModelDir: () => '/cache/models',
      listDir: () => {
        throw new Error('ENOENT');
      },
    });
    expect(model.found).toBe(false);  });
});

describe('core: diagnoseBinaries — defaults de produção', () => {
  it('sem deps injetadas retorna tesseract e pdftotext, cada um com installHint não vazio', async () => {
    const diagnoses = await diagnoseBinaries();
    expect(diagnoses.map((d) => d.name)).toEqual(['tesseract', 'pdftotext']);
    for (const diagnosis of diagnoses) {
      expect(typeof diagnosis.found).toBe('boolean');
      expect(diagnosis.installHint.length).toBeGreaterThan(0);
    }
  it('sem deps injetadas retorna as 4 entradas com installHint não vazio, sem lançar', async () => {
    const list = await diagnoseBinaries();
    expect(list).toHaveLength(4);
    for (const item of list) {
      expect(typeof item.found).toBe('boolean');
      expect(item.installHint.length).toBeGreaterThan(0);
    }
    expect(list[0]?.name).toBe('tesseract');  });
});
