/**
 * Gerador de PDF MÍNIMO (formato 1.4) com uma camada de texto — usado só pelo
 * teste de integração REAL do {@link PdfExtractor} (opt-in). Escrito à mão para
 * NÃO versionar uma fixture binária no repo: monta o header `%PDF-1.4`, os
 * objetos (Catalog → Pages → Page → Contents → Font), a `xref` com os offsets
 * corretos e o `trailer`. O conteúdo da página é um único operador de texto
 * (`BT … (texto) Tj … ET`) com a fonte padrão Helvetica.
 *
 * O `pdftotext` extrai exatamente esse `texto` — o que prova a integração real.
 */

/**
 * Monta os bytes de um PDF 1.4 válido e mínimo exibindo `text` numa única página.
 *
 * @param text - Texto a embutir na página (apenas ASCII/latin1; sem parênteses).
 * @returns Os bytes do PDF prontos para gravar em disco.
 * @example
 * await writeFile('hello.pdf', makeTextPdf('HELLO PDF'));
 */
export function makeTextPdf(text: string): Buffer {
  // Reason: parênteses são delimitadores de string literal no PDF — escapamos os
  // que aparecerem no texto para manter o objeto de conteúdo bem-formado.
  const safe = text.replace(/([()\\])/g, '\\$1');
  const contentStream = `BT /F1 24 Tf 72 700 Td (${safe}) Tj ET`;

  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefPos = pdf.length;
  const size = bodies.length + 1;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}
