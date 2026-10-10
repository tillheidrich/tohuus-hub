import QR from 'qrcode';
import { describe, expect, it } from 'vitest';
import { qrMatrix } from '../server/lib/qr';

describe('qr encoder', () => {
  it('matches the qrcode package module by module (byte mode, level M, fixed masks)', () => {
    const versions = new Set<number>();
    for (const len of [1, 10, 14, 20, 30, 50, 80, 100, 130, 180, 230, 300, 400, 500, 600]) {
      const s = ('https://tohuus.example/q/' + 'aÄ'.repeat(len)).slice(0, 25 + len);
      for (const mask of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const q = QR.create(s, { errorCorrectionLevel: 'M', maskPattern: mask as any });
        if (q.version > 20 || q.segments.length !== 1 || (q.segments[0] as any).mode.id !== 'Byte') continue;
        versions.add(q.version);
        const m = qrMatrix(s, mask);
        const n = q.modules.size;
        expect(m.length, `size for ${len}`).toBe(n);
        let diff = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Boolean(q.modules.get(y, x)) !== m[y][x]) diff++;
        expect(diff, `len ${len} mask ${mask} v${q.version}`).toBe(0);
      }
    }
    expect(versions.size).toBeGreaterThan(8);
    expect(Math.max(...versions)).toBeGreaterThanOrEqual(14);
  });
});
