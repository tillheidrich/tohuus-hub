/**
 * Quick P2 fixes of the review of 18.10.2026: recipe source links only http(s) (P2-11), outbound connections not to
 * the server's own addresses and only on 80/443 (P2-7), MCP image_url only through the guarded fetch (P2-6).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-p2-'));
process.env.DATA_DIR = dir;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('P2-11 recipe source links', () => {
  it('keeps http(s) links and drops javascript:, data: and other schemes on every way in', async () => {
    const { safeSourceUrl, saveRecipe } = await import('../server/lib/recipes');
    const { db } = await import('../server/db');
    expect(safeSourceUrl('https://example.org/rezept')).toBe('https://example.org/rezept');
    expect(safeSourceUrl(' http://example.org ')).toBe('http://example.org');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.org', '//example.org', 'example.org', 'https://' + 'a'.repeat(2001), 42, null])
      expect(safeSourceUrl(bad), String(bad).slice(0, 30)).toBeNull();
    const id = saveRecipe({ title: 'Test', source_url: 'javascript:alert(1)', ingredients: [], steps: [] } as any);
    expect((db.prepare('SELECT source_url FROM recipes WHERE id = ?').get(id) as { source_url: string | null }).source_url).toBeNull();
  });
});

describe('P2-7 outbound guard', () => {
  it('only 80/443 unless OUTBOUND_ALLOWED_PORTS names more', async () => {
    const { portAllowed } = await import('../server/lib/net');
    expect(portAllowed('')).toBe(true);
    expect(portAllowed(443)).toBe(true);
    expect(portAllowed('80')).toBe(true);
    expect(portAllowed('8000', '')).toBe(false);
    expect(portAllowed('8123', '')).toBe(false);
    expect(portAllowed('8448', '8448, 8443')).toBe(true);
  });
  it('the server’s own public addresses (BLOCK_OWN_IPS) count as not allowed', async () => {
    const { isPrivateIp, setOwnIps } = await import('../server/lib/net');
    expect(isPrivateIp('46.224.49.66')).toBe(false);
    setOwnIps('46.224.49.66, 2a01:4f8:c17::/48, nonsense');
    expect(isPrivateIp('46.224.49.66')).toBe(true);
    expect(isPrivateIp('2a01:4f8:c17:1::1')).toBe(true);
    expect(isPrivateIp('46.224.49.67')).toBe(false);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    setOwnIps('');
    expect(isPrivateIp('46.224.49.66')).toBe(false);
  });
  it('the guarded agent refuses a webhook to an odd port and to a private address before connecting', async () => {
    const { privateBlockingAgent, setOwnIps } = await import('../server/lib/net');
    const { fetch } = await import('undici');
    const fails = async (u: string) => {
      try {
        await fetch(u, { dispatcher: privateBlockingAgent, signal: AbortSignal.timeout(3000) });
        return '';
      } catch (e) {
        return String((e as any)?.cause?.message ?? (e as Error).message);
      }
    };
    expect(await fails('http://93.184.215.14:8000/hook')).toMatch(/Port not allowed/i);
    expect(await fails('http://127.0.0.1/hook')).toMatch(/Address not allowed/i);
    setOwnIps('93.184.215.14');
    expect(await fails('http://93.184.215.14/hook')).toMatch(/Address not allowed/i);
    setOwnIps('');
  });
  it('safeFetch (MCP image_url, recipe photos) refuses other schemes, odd ports and private hosts', async () => {
    const { safeFetch } = await import('../server/lib/net');
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.org:8080/x.jpg', 'http://localhost/x.jpg', 'http://10.0.0.1/x.jpg'])
      await expect(safeFetch(u), u).rejects.toThrow();
  });
});
