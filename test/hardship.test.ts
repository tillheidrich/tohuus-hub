import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-hardship-'));
process.env.MULTI_TENANT = 'true';
process.env.TOHUUS_MASTER_KEY = 'a'.repeat(64);

let hardship: typeof import('../server/lib/hardship');

beforeAll(async () => {
  hardship = await import('../server/lib/hardship');
});

describe('Wir können uns das nicht leisten', () => {
  it('stores a request once per address, ignores bots, gifts a single-use code', async () => {
    await hardship.requestHardship({ email: 'Mira@example.org', name: 'Mira', people: '2 Erwachsene, 2 Kinder', message: 'Gerade knapp.' });
    await hardship.requestHardship({ email: 'mira@example.org', message: 'nochmal' });
    await hardship.requestHardship({ email: 'bot@example.org', website: 'http://spam' });
    const list = hardship.listHardship() as { id: number; email: string; status: string }[];
    expect(list.map((r) => r.email)).toEqual(['mira@example.org']);
    await expect(hardship.requestHardship({ email: 'kein-mail' })).rejects.toThrow();
    const r = await hardship.grantHardship(list[0].id, 'plus', 365, 'test');
    expect(r.code).toMatch(/^[A-Z0-9-]{8,}$/);
    expect((hardship.listHardship() as { status: string }[])[0].status).toBe('granted');
    await expect(hardship.grantHardship(list[0].id, 'plus', 365, 'test')).rejects.toThrow();
  });
});
