import { createWorker, type Worker } from 'tesseract.js';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
export class LocalOcr {
  private worker?: Worker;
  constructor(private directory: string) {}
  async read(bytes: Uint8Array) {
    if (bytes.byteLength > 20_000_000) throw new Error('Imagem acima do limite de OCR.');
    if (!this.worker) {
      const cachePath = path.join(this.directory, 'learning', 'ocr-cache');
      await mkdir(cachePath, { recursive: true });
      this.worker = await createWorker('por', 1, { cachePath });
    }
    const result = await this.worker.recognize(Buffer.from(bytes));
    const text = result.data.text.trim();
    if (text.length < 20 || result.data.confidence < 40)
      throw new Error('OCR sem confiança suficiente.');
    return { text, confidence: result.data.confidence };
  }
  async close() {
    await this.worker?.terminate();
    this.worker = undefined;
  }
}
