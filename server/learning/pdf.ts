import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function pdfText(bytes: Uint8Array) {
  if (bytes.byteLength > 30_000_000) throw new Error('Arquivo acima do limite de leitura (30 MB).');
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    const pages: { page: number; text: string }[] = [];
    if (doc.numPages > 1000)
      throw new Error('Documento acima do limite de leitura (1000 páginas).');
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push({
        page: i,
        text: content.items
          .map((item) =>
            'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '',
          )
          .join('')
          .trim(),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
