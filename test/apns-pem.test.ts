import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizePem } from '../server/lib/apns';

// A .p8 pasted into a dashboard arrives in many shapes (Coolify 18.10.2026: "DECODER routines::unsupported").
describe('APNs key: pasted .p8 is repaired', () => {
  const pem = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const shapes: Record<string, string> = {
    clean: pem,
    'newlines as spaces': pem.replace(/\n/g, ' '),
    'no newlines at all': pem.replace(/\n/g, ''),
    'escaped \\n': pem.replace(/\n/g, '\\n'),
    'in quotes': `"${pem}"`,
    'CRLF and indent': pem.replace(/\n/g, '\r\n   '),
    'body only': pem.replace(/-----[A-Z ]+-----/g, '').trim(),
  };
  for (const [name, raw] of Object.entries(shapes)) {
    it(name, () => {
      const key = normalizePem(raw)!;
      expect(() => crypto.createPrivateKey(key)).not.toThrow();
      expect(crypto.createPrivateKey(key).export({ format: 'pem', type: 'pkcs8' }).toString()).toBe(pem);
    });
  }
  it('empty stays empty', () => {
    expect(normalizePem(undefined)).toBeUndefined();
    expect(normalizePem('   ')).toBeUndefined();
  });
});
