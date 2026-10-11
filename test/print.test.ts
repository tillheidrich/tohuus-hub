import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-print-'));
process.env.TZ = 'Europe/Berlin';
process.env.BASE_URL = 'http://hub.test'; // vitest sets BASE_URL='/' otherwise

let db: typeof import('../server/db').db;
let setSetting: typeof import('../server/db').setSetting;
let tickets: typeof import('../server/lib/tickets');
let print: typeof import('../server/lib/print');
let pos: typeof import('../server/lib/escpos');
let catalog: typeof import('../server/lib/catalog');
let orders: typeof import('../server/lib/orders');
let coffee: number;

/** A fake network printer: collects every job's bytes. */
let jobs: Buffer[] = [];
let port = 0;
let server: net.Server;

const svgText = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'));

beforeAll(async () => {
  ({ db, setSetting } = await import('../server/db'));
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  setSetting('language', 'en');
  setSetting('household.name', 'The Mustermanns');
  catalog = await import('../server/lib/catalog');
  orders = await import('../server/lib/orders');
  tickets = await import('../server/lib/tickets');
  print = await import('../server/lib/print');
  pos = await import('../server/lib/escpos');
  coffee = catalog.createProduct({ name: 'Cappuccino', trackMode: 'none', orderable: true, orderGroup: 'Drinks' });
  db.prepare('UPDATE products SET order_options = ? WHERE id = ?').run(JSON.stringify([{ group: 'Milk', choices: ['Oat', 'Normal'], multi: false }]), coffee);
  catalog.addToShopping({ text: 'Milk', qty: 2 });
  catalog.addToShopping({ text: 'Bananas' });
  catalog.addToShopping({ text: 'Dishwasher tabs' });
  server = net.createServer((s) => {
    const chunks: Buffer[] = [];
    s.on('data', (d) => chunks.push(Buffer.from(d)));
    s.on('end', () => jobs.push(Buffer.concat(chunks)));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as net.AddressInfo).port;
});

afterAll(() => server?.close());

const waitForJob = async (n: number) => {
  for (let i = 0; i < 100 && jobs.length < n; i++) await new Promise((r) => setTimeout(r, 30));
};

describe('ticket renderers', () => {
  it('fridge note: header, text and footer', async () => {
    const tk = await tickets.buildTicket({ type: 'note', text: 'Back at six – pizza in the oven', from: 'Till' }, 58);
    const { svg, width } = tickets.renderSvg(tk, 58);
    expect(width).toBe(384);
    const lines = svgText(svg);
    expect(lines[0]).toBe('TOHUUS HUB');
    expect(lines).toContain('The Mustermanns');
    expect(lines).toContain('FRIDGE NOTE');
    expect(lines).toContain('From');
    expect(lines).toContain('Till');
    expect(lines.join(' ')).toContain('Back at six – pizza in the oven');
    expect(lines[lines.length - 1]).toBe('Stick it on the fridge');
    expect(svg).not.toContain('<path'); // no QR on a fridge note
  });

  it('shopping list groups by aisle with check boxes and a QR back into the app', async () => {
    const tk = await tickets.buildTicket({ type: 'shopping' }, 80);
    const { svg, width } = tickets.renderSvg(tk, 80);
    expect(width).toBe(576);
    const lines = svgText(svg);
    expect(lines).toContain('SHOPPING SLIP');
    expect(lines).toContain('2 Milk');
    expect(lines).toContain('Bananas');
    expect(lines.filter((l) => l === l.toUpperCase() && /^[A-Z &]+$/.test(l)).length).toBeGreaterThanOrEqual(2); // aisle headings
    expect((svg.match(/<rect[^>]*fill="none"/g) ?? []).length).toBe(3); // three boxes
    expect(svg).toContain('<path d="M'); // QR
    const text = tickets.renderText(tk, 48);
    expect(text).toContain('[ ] 2 Milk');
    expect(text).toContain('http://hub.test/einkauf');
    expect(text.split('\n').every((l) => [...l].length <= 48)).toBe(true);
  });

  it('kitchen ticket shows order number, options and per-item notes; Fredirando turns it into a delivery note', async () => {
    const id = orders.createOrder({ note: 'and a blanket', lines: [{ product_id: coffee, qty: 2, options: ['Oat'], note: 'extra hot' }] }, { userId: 1, name: 'Lea' });
    let lines = svgText(tickets.renderSvg(await tickets.buildTicket({ type: 'order', id }, 58), 58).svg);
    expect(lines).toContain('KITCHEN TICKET');
    expect(lines).toContain(`#${String(id).padStart(3, '0')}`);
    expect(lines).toContain('2×');
    expect(lines).toContain('Cappuccino');
    expect(lines).toContain('+ Oat');
    expect(lines).toContain('„extra hot“');
    expect(lines.join(' ')).toContain('Wish: and a blanket');
    expect(lines).toContain('Lea');
    setSetting('brand.choice', 'fredirando');
    lines = svgText(tickets.renderSvg(await tickets.buildTicket({ type: 'order', id }, 58), 58).svg);
    setSetting('brand.choice', 'tohuus');
    expect(lines[0]).toBe('FREDIRANDO');
    expect(lines).toContain('DELIVERY NOTE');
    expect(lines).toContain('Delivery to');
    expect(lines).toContain('Sofa');
  });

  it('missing records are a 404', async () => {
    await expect(tickets.buildTicket({ type: 'order', id: 9999 })).rejects.toMatchObject({ status: 404 });
    await expect(tickets.buildTicket({ type: 'note', text: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  it('wraps by monospace columns and splits very long words', () => {
    expect(tickets.wrap('a bb ccc dddd', 6)).toEqual(['a bb', 'ccc', 'dddd']);
    expect(tickets.wrap('Donaudampfschifffahrt', 8)).toEqual(['Donaudam', 'pfschiff', 'fahrt']);
  });

  it('renders a PNG at printer width', async () => {
    const png = await tickets.renderPng(await tickets.buildTicket({ type: 'test' }, 58), 58);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(384);
  });
});

describe('ESC/POS', () => {
  it('encodes umlauts and Swedish letters for CP858 and CP1252', () => {
    expect([...pos.encodeText('Äöå€', 'cp858')]).toEqual([0x8e, 0x94, 0x86, 0xd5]);
    expect([...pos.encodeText('Äöå€', 'cp1252')]).toEqual([0xc4, 0xf6, 0xe5, 0x80]);
    expect(pos.encodeText('„hi“ ☐', 'cp858').toString('latin1')).toBe('"hi" [ ]');
  });

  it('packs a raster band (GS v 0) MSB first', () => {
    const bits = new Uint8Array(16 * 2);
    bits[0] = 1; // top-left
    bits[16 + 15] = 1; // second row, last pixel
    const r = pos.raster(bits, 16, 2);
    expect([...r.subarray(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0]);
    expect([...r.subarray(8)]).toEqual([0x80, 0x00, 0x00, 0x01]);
  });

  it('sends a raster job to a network printer: init, raster header, feed and cut', async () => {
    const p = print.savePrinter({ name: 'Kitchen', host: '127.0.0.1', port, paper: 58, cut: 'partial' });
    jobs = [];
    const res = await print.printTicket({ type: 'shopping' }, { printer: p, actor: 'Till' });
    expect(res.ok).toBe(true);
    await waitForJob(1);
    const b = jobs[0];
    expect([...b.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    const at = b.indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00]));
    expect(at).toBeGreaterThan(0);
    expect(b[at + 4] | (b[at + 5] << 8)).toBe(48); // 384 dots = 48 bytes per row
    expect([...b.subarray(-7)]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0x00]);
    expect(print.getPrinter(p.id)?.last_ok_at).toBeTruthy();
  });

  it('text mode selects the code page and prints text, cut "none" leaves the paper uncut', async () => {
    const p = print.savePrinter({ name: 'Bar', host: '127.0.0.1', port, mode: 'text', codepage: 'cp858', cut: 'none', paper: 58 });
    jobs = [];
    await print.printTicket({ type: 'note', text: 'Smörgåsbord für alle' }, { printer: p });
    await waitForJob(1);
    const b = jobs[0];
    expect([...b.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(b.includes(pos.encodeText('Smörgåsbord', 'cp858'))).toBe(true);
    expect(b.includes(Buffer.from([0x1d, 0x56]))).toBe(false);
  });

  it('an unreachable printer gives a friendly error and is remembered', async () => {
    const dead = net.createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', () => r()));
    const deadPort = (dead.address() as net.AddressInfo).port;
    await new Promise<void>((r) => dead.close(() => r()));
    const p = print.savePrinter({ name: 'Offline', host: '127.0.0.1', port: deadPort });
    await expect(print.printTicket({ type: 'test' }, { printer: p })).rejects.toMatchObject({ status: 502 });
    expect(print.getPrinter(p.id)?.last_error).toMatch(/Offline/);
    print.deletePrinter(p.id);
  });

  it('rejects hosts that are not a host name or IP', () => {
    expect(() => print.savePrinter({ name: 'x', host: 'http://evil/x' })).toThrow();
    expect(print.validHost('192.168.1.50')).toBe(true);
    expect(print.validHost('tm-m30.local')).toBe(true);
  });
});

describe('automations', () => {
  it('auto-prints new orders exactly once, and only those after switching it on', async () => {
    const before = orders.createOrder({ lines: [{ product_id: coffee, qty: 1, options: [] }] }, { userId: 1, name: 'Lea' });
    db.prepare(`UPDATE orders SET created_at = datetime('now', '-1 minute') WHERE id <= ?`).run(before);
    for (const p of print.listPrinters()) print.deletePrinter(p.id);
    const p = print.savePrinter({ name: 'Kitchen', host: '127.0.0.1', port, auto_orders: 'all' });
    expect(p.auto_since).toBeTruthy();
    const fresh = orders.createOrder({ lines: [{ product_id: coffee, qty: 1, options: ['Oat'] }] }, { userId: 1, name: 'Lea' });
    jobs = [];
    expect(await print.autoPrintOrders()).toBe(1);
    expect(await print.autoPrintOrders()).toBe(0);
    await waitForJob(1);
    expect(jobs.length).toBe(1);
    const logged = db.prepare(`SELECT auto_key FROM print_jobs WHERE printer_id = ? AND auto_key IS NOT NULL`).all(p.id) as { auto_key: string }[];
    expect(logged.map((l) => l.auto_key)).toEqual([`order:${fresh}`]);
  });

  it('"party only" skips sofa orders', async () => {
    for (const p of print.listPrinters()) print.deletePrinter(p.id);
    print.savePrinter({ name: 'Party', host: '127.0.0.1', port, auto_orders: 'party' });
    orders.createOrder({ lines: [{ product_id: coffee, qty: 1, options: [] }] }, { userId: 1, name: 'Lea' });
    expect(await print.autoPrintOrders()).toBe(0);
  });

  it('quiet hours wrap around midnight', () => {
    expect(print.inQuietHours('23:00', '21:30', '07:00')).toBe(true);
    expect(print.inQuietHours('06:59', '21:30', '07:00')).toBe(true);
    expect(print.inQuietHours('07:00', '21:30', '07:00')).toBe(false);
    expect(print.inQuietHours('13:00', '12:00', '14:00')).toBe(true);
    expect(print.inQuietHours('13:00', '07:00', '07:00')).toBe(false);
  });
});
