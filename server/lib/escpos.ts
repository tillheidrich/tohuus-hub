/**
 * Tiny ESC/POS encoder for thermal receipt printers (Epson TM, Star in ESC/POS mode, the cheap 58/80 mm Wi-Fi ones).
 * Raster mode (GS v 0) prints a 1-bit image, so umlauts, Swedish letters and QR codes always work.
 * Text mode uses the printer's own font with code page CP858 or Windows-1252 (Epson numbering).
 */
import net from 'node:net';
import { featureOff } from './tenancy.js';

export const ESC = 0x1b;
export const GS = 0x1d;

export type Cut = 'partial' | 'full' | 'none';
export type Codepage = 'cp858' | 'cp1252';

export const init = () => Buffer.from([ESC, 0x40]);
export const feed = (lines: number) => Buffer.from([ESC, 0x64, Math.max(0, Math.min(255, Math.round(lines)))]);
export const align = (a: 'left' | 'center' | 'right') => Buffer.from([ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0]);
export const bold = (on: boolean) => Buffer.from([ESC, 0x45, on ? 1 : 0]);
/** GS ! n – width/height multiplier 1..8 */
export const size = (w: number, h: number) => Buffer.from([GS, 0x21, (((Math.max(1, Math.min(8, w)) - 1) << 4) | (Math.max(1, Math.min(8, h)) - 1)) & 0xff]);
export function cut(kind: Cut) {
  if (kind === 'none') return Buffer.alloc(0);
  // GS V m – 0x41 full cut / 0x42 partial cut, each after feeding n dots
  return Buffer.from([GS, 0x56, kind === 'full' ? 0x41 : 0x42, 0x00]);
}

/** Epson ESC t numbering */
const CODEPAGE_N: Record<Codepage, number> = { cp858: 19, cp1252: 16 };
export const codepage = (cp: Codepage) => Buffer.from([ESC, 0x74, CODEPAGE_N[cp]]);

// 0x80–0xFF of CP850 with the euro sign at 0xD5 (= CP858)
const CP858_HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜø£Ø×ƒ' +
  'áíóúñÑªº¿®¬½¼¡«»' +
  '░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤' +
  'ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀' +
  'ÓßÔÒõÕµþÞÚÛÙýÝ¯´' +
  '­±‗¾¶§÷¸°¨·¹³²■ ';
const CP1252_80 = '€\0‚ƒ„…†‡ˆ‰Š‹Œ\0Ž\0\0‘’“”•–—˜™š›œ\0žŸ';

const TABLES: Record<Codepage, Map<string, number>> = {
  cp858: new Map([...CP858_HIGH].map((c, i) => [c, 0x80 + i])),
  cp1252: (() => {
    const m = new Map<string, number>();
    [...CP1252_80].forEach((c, i) => c !== '\0' && m.set(c, 0x80 + i));
    for (let i = 0xa0; i <= 0xff; i++) m.set(String.fromCharCode(i), i);
    return m;
  })(),
};

const FALLBACK: Record<string, string> = { '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'", '‚': ',', '–': '-', '—': '-', '…': '...', '•': '*', '☐': '[ ]', '☑': '[x]', '×': 'x', '→': '->', '·': '-', ' ': ' ' };

/** Encode text for the printer's code page; characters it doesn't have fall back to ASCII look-alikes or '?'. */
export function encodeText(text: string, cp: Codepage): Buffer {
  const table = TABLES[cp];
  const out: number[] = [];
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (code === 0x0a || (code >= 0x20 && code < 0x7f)) out.push(code);
    else if (table.has(ch)) out.push(table.get(ch)!);
    else if (FALLBACK[ch] !== undefined) for (const c of FALLBACK[ch]) out.push(table.get(c) ?? c.charCodeAt(0));
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out.push(base.length === 1 && base.charCodeAt(0) < 0x7f ? base.charCodeAt(0) : 0x3f);
    }
  }
  return Buffer.from(out);
}

/**
 * 1-bit raster (true = black) → GS v 0 commands, in bands so small printers don't overflow their buffer.
 * `width` must be the dot width (384 for 58 mm, 576 for 80 mm).
 */
export function raster(bits: Uint8Array, width: number, height: number, band = 128): Buffer {
  const bytesPerRow = Math.ceil(width / 8);
  const parts: Buffer[] = [];
  for (let y0 = 0; y0 < height; y0 += band) {
    const h = Math.min(band, height - y0);
    const head = Buffer.from([GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]);
    const body = Buffer.alloc(bytesPerRow * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < width; x++) if (bits[(y0 + y) * width + x]) body[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    parts.push(head, body);
  }
  return Buffer.concat(parts);
}

/** Grey pixels (0 = black … 255 = white) → 1-bit. Floyd–Steinberg when `dither`, else a plain threshold. */
export function toBits(grey: Uint8Array | Buffer, width: number, height: number, opts: { threshold?: number; dither?: boolean } = {}): Uint8Array {
  const thr = opts.threshold ?? 160;
  const out = new Uint8Array(width * height);
  if (!opts.dither) {
    for (let i = 0; i < out.length; i++) out[i] = grey[i] < thr ? 1 : 0;
    return out;
  }
  const buf = Float32Array.from(grey);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i];
      const nv = old < thr ? 0 : 255;
      out[i] = nv === 0 ? 1 : 0;
      const err = old - nv;
      if (x + 1 < width) buf[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1] += (err * 3) / 16;
        buf[i + width] += (err * 5) / 16;
        if (x + 1 < width) buf[i + width + 1] += err / 16;
      }
    }
  return out;
}

export interface JobOpts {
  cut: Cut;
  feedLines: number;
}

/** Whole raster job: init → image → feed → cut. */
export function rasterJob(bits: Uint8Array, width: number, height: number, o: JobOpts): Buffer {
  return Buffer.concat([init(), align('left'), raster(bits, width, height), feed(o.feedLines), cut(o.cut)]);
}

/** Send bytes to a network printer (raw TCP, usually port 9100). */
export function sendTcp(host: string, port: number, data: Buffer, timeoutMs = 8000): Promise<void> {
  // ToHuus Cloud: no connections into anyone's LAN (or ours)
  if (featureOff('lanPrinters')) return Promise.reject(new Error('Network printers are not available in ToHuus Cloud.'));
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    sock.on('error', (e) => finish(e));
    sock.on('connect', () => {
      sock.end(data, () => {
        // give slow printers a moment to drain before the socket closes
        setTimeout(() => finish(), 150);
      });
    });
  });
}
