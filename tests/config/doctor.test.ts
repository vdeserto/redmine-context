/**
 * Testes do diagnóstico de binários de mídia (M3-11, #53, ADR-002). Escrito
 * ANTES da implementação (TDD). A plataforma, a localização do binário e a
 * detecção de versão são TODAS injetadas — nenhum binário real é chamado e
 * nenhum acesso ao filesystem real acontece aqui. Provam: hint correto por SO
 * (darwin/linux/win32), estados found/ausente e a exibição da versão quando
 * presente.
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
});

describe('core: diagnoseBinaries — tesseract presente', () => {
  it('found=true com path e versão quando o binário é localizado e a versão é legível', async () => {
    const findTesseract = vi.fn().mockReturnValue({ path: '/opt/homebrew/bin/tesseract' });
    const detectTesseractVersion = vi.fn().mockResolvedValue('5.5.0');

    const [tesseract] = await diagnoseBinaries({
      platform: 'darwin',
      findTesseract,
      detectTesseractVersion,
      ...noPdftotext,
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

    expect(tesseract.found).toBe(true);
    expect(tesseract.path).toBe('/usr/bin/tesseract');
    expect(tesseract.version).toBeUndefined();
  });
});

describe('core: diagnoseBinaries — tesseract ausente', () => {
  it('found=false, sem path/versão, com installHint do SO e sem detectar versão', async () => {
    const findTesseract = vi.fn().mockReturnValue(undefined);
    const detectTesseractVersion = vi.fn();

    const [tesseract] = await diagnoseBinaries({
      platform: 'win32',
      findTesseract,
      detectTesseractVersion,
      ...noPdftotext,
    });

    expect(tesseract).toEqual({
      name: 'tesseract',
      found: false,
      installHint: expect.stringContaining('winget install UB-Mannheim.TesseractOCR'),
    });
    expect(tesseract.path).toBeUndefined();
    expect(tesseract.version).toBeUndefined();
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
  });
});

describe('core: diagnoseBinaries — defaults de produção', () => {
  it('sem deps injetadas retorna tesseract e pdftotext, cada um com installHint não vazio', async () => {
    const diagnoses = await diagnoseBinaries();
    expect(diagnoses.map((d) => d.name)).toEqual(['tesseract', 'pdftotext']);
    for (const diagnosis of diagnoses) {
      expect(typeof diagnosis.found).toBe('boolean');
      expect(diagnosis.installHint.length).toBeGreaterThan(0);
    }
  });
});
