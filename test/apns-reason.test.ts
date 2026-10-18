import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-apns-reason-'));

describe('APNs refusal codes in words', () => {
  it('explains BadEnvironmentKeyInToken and leaves unknown codes alone', async () => {
    const { apnsReasonText } = await import('../server/lib/apns');
    expect(apnsReasonText('BadEnvironmentKeyInToken')).toMatch(/Sandbox & Production/);
    expect(apnsReasonText('BadDeviceToken')).toBeNull();
    expect(apnsReasonText(null)).toBeNull();
  });
});
