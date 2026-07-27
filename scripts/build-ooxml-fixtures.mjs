#!/usr/bin/env node
// @ts-check
//
// build-ooxml-fixtures.mjs — gera fixtures OOXML DETERMINÍSTICAS para os testes do
// extrator (#184), usando o `zip` do sistema (arquivos zip REAIS, não gerados pelo
// nosso próprio leitor — evita mascarar bugs). Regenerar:  node scripts/build-ooxml-fixtures.mjs
//
// Produz em tests/fixtures/ooxml/:
//   sample.docx  — 3 parágrafos (tab, entidades XML, xml:space) → texto conhecido
//   sample.pptx  — 2 slides (<a:t>) → texto conhecido, na ordem dos slides
//   sample.xlsx  — sharedStrings (<t>) → texto conhecido
//   plain.zip    — zip comum (readme.txt), STORED (-0): NÃO é OOXML → unsupported
//
// Node puro (loga em stderr; sem console). Requer o binário `zip` no PATH.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'tests', 'fixtures', 'ooxml');
const log = (/** @type {string} */ m) => process.stderr.write(`[ooxml-fixtures] ${m}\n`);

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>\n';

const DOCX_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Ofício nº 123</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Linha com  espaço</w:t><w:tab/><w:t>após tab</w:t></w:r></w:p>
    <w:p><w:r><w:t>A &amp; B &lt;fim&gt;</w:t></w:r></w:p>
  </w:body>
</w:document>
`;

const PPTX_PRESENTATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:presentation>\n';
const pptSlide = (/** @type {string[]} */ paras) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
${paras.map((t) => `    <a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('\n')}
  </p:spTree></p:cSld>
</p:sld>
`;

const XLSX_WORKBOOK = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"></workbook>\n';
const XLSX_SHARED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>Cabeçalho</t></si>
  <si><t xml:space="preserve">Célula A</t></si>
</sst>
`;

/** Monta uma árvore de arquivos num diretório temp e zipa em `outFile`. */
function zipTree(/** @type {string} */ label, /** @type {Record<string,string>} */ files, /** @type {string} */ outFile, /** @type {boolean} */ stored) {
  const build = mkdtempSync(join(tmpdir(), `ooxml-${label}-`));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(build, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
    rmSync(outFile, { force: true });
    // -X: sem atributos extras de plataforma; -r: recursivo; -0: stored (sem deflate).
    const args = ['-X', '-r', ...(stored ? ['-0'] : []), outFile, '.'];
    execFileSync('zip', args, { cwd: build, stdio: 'ignore' });
    log(`gerado ${outFile}`);
  } finally {
    rmSync(build, { recursive: true, force: true });
  }
}

mkdirSync(OUT, { recursive: true });

zipTree('docx', { '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': DOCX_DOCUMENT }, join(OUT, 'sample.docx'), false);
zipTree(
  'pptx',
  {
    '[Content_Types].xml': CONTENT_TYPES,
    'ppt/presentation.xml': PPTX_PRESENTATION,
    'ppt/slides/slide1.xml': pptSlide(['Título do slide 1', 'Bullet um']),
    'ppt/slides/slide2.xml': pptSlide(['Slide dois']),
  },
  join(OUT, 'sample.pptx'),
  false,
);
zipTree('xlsx', { '[Content_Types].xml': CONTENT_TYPES, 'xl/workbook.xml': XLSX_WORKBOOK, 'xl/sharedStrings.xml': XLSX_SHARED }, join(OUT, 'sample.xlsx'), false);
zipTree('plain', { 'readme.txt': 'apenas um zip comum, sem OOXML\n' }, join(OUT, 'plain.zip'), true);

// Fixtures adversariais/degradadas (gap da review #184):
// xlsx SEM sharedStrings (planilha só de números) e pptx SEM slides → sem texto.
zipTree('xlsx-nostrings', { '[Content_Types].xml': CONTENT_TYPES, 'xl/workbook.xml': XLSX_WORKBOOK }, join(OUT, 'nostrings.xlsx'), false);
zipTree('pptx-noslides', { '[Content_Types].xml': CONTENT_TYPES, 'ppt/presentation.xml': PPTX_PRESENTATION }, join(OUT, 'noslides.pptx'), false);

log('OK');
