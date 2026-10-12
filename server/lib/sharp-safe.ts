/**
 * sharp with a pixel limit for everything ToHuus decodes: 40 megapixels (a 7000×5700 photo) – a crafted image with
 * huge dimensions ("decompression bomb") is refused instead of exhausting memory. Import this, never 'sharp'.
 */
import sharpLib, { type SharpOptions } from 'sharp';

export const MAX_INPUT_PIXELS = 40_000_000;

const sharp = ((input?: any, opts?: SharpOptions) =>
  input !== undefined && input !== null && typeof input === 'object' && !Buffer.isBuffer(input) && !ArrayBuffer.isView(input) && !('length' in input)
    ? sharpLib({ limitInputPixels: MAX_INPUT_PIXELS, ...input, ...opts })
    : sharpLib(input, { limitInputPixels: MAX_INPUT_PIXELS, ...opts })) as typeof sharpLib;

export default sharp;
