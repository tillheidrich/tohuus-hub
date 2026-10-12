/**
 * Stand-in for server/lib/ocr.ts (built on the b-core branch): the same signature, but no OCR engine.
 * After the merge, offers.ts imports `ocrImage` from './ocr.js' instead and this file can go.
 * Throws an error with code 'ocr.unavailable'; callers fall back to the vision model (if configured) or ask for text.
 */
export interface OcrResult {
  lines: string[];
  confidence: number;
}

export async function ocrImage(_buffer: Buffer): Promise<OcrResult> {
  throw Object.assign(new Error('ocr.unavailable'), { code: 'ocr.unavailable' });
}
