/**
 * A small ZIP writer and reader (deflate or stored, no ZIP64, no encryption) for the cloud move file
 * (server/lib/move.ts). Enough for a few thousand entries of up to a few hundred MB in total.
 */
import zlib from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const dosTime = (d: Date) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

export function writeZip(entries: ZipEntry[], now = new Date()): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosTime(now);
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = zlib.crc32(e.data) >>> 0;
    // images are already compressed: store them; JSON and text get deflated
    const deflate = !/\.(webp|jpe?g|png|gif|avif|pdf|zip)$/i.test(e.name);
    const body = deflate ? zlib.deflateRawSync(e.data, { level: 6 }) : e.data;
    const method = deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

export class ZipError extends Error {}

/** Read all entries. Limits: `maxEntries`, `maxBytes` (uncompressed, in total) – zip bombs end here. */
export function readZip(buf: Buffer, limits: { maxEntries?: number; maxBytes?: number } = {}): ZipEntry[] {
  const maxEntries = limits.maxEntries ?? 20_000;
  const maxBytes = limits.maxBytes ?? 1024 * 1024 * 1024;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new ZipError('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > maxEntries) throw new ZipError('too many files in the zip');
  if (p + cdSize > buf.length) throw new ZipError('broken zip');
  const out: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('broken zip directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const loff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    total += usize;
    if (total > maxBytes) throw new ZipError('the zip is too large when unpacked');
    if (buf.readUInt32LE(loff) !== 0x04034b50) throw new ZipError('broken zip entry');
    const start = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) });
    else throw new ZipError('unsupported compression');
    if (data.length !== usize) throw new ZipError('broken zip entry size');
    out.push({ name, data });
  }
  return out;
}
