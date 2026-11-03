import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfText } from '../server/learning/pdf.js';
import { allowedMaterialUrl } from '../server/learning/external.js';

test('PDF reader extracts page text without executing document scripts', async () => {
  const stream = 'BT /F1 12 Tf 30 100 Td (Financial learning fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const pages = await pdfText(Buffer.from(pdf));
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /Financial learning fixture/);
  assert.equal(pages[0].page, 1);
});
test('external material reader rejects credentials, local addresses, arbitrary destinations and non-HTTPS', () => {
  for (const url of [
    'http://scorm.onilearning.com.br/a',
    'https://127.0.0.1/a',
    'https://example.com/a',
    'https://name:secret@scorm.onilearning.com.br/a',
    'https://scorm.onilearning.com.br:444/a',
  ])
    assert.throws(() => allowedMaterialUrl(url));
  assert.equal(
    allowedMaterialUrl('https://scorm.onilearning.com.br/item-trilha.php?id=1'),
    'https://scorm.onilearning.com.br/item-trilha.php?id=1',
  );
});
