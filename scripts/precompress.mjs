// Writes .br and .gz next to the built web files (dist/web), so the server can send them pre-compressed to
// self-hosters without a reverse proxy that compresses (server/lib/compress.ts picks them by Accept-Encoding).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(process.argv[2] ?? 'dist/web');
const EXT = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.wasm', '.txt', '.xml', '.map']);
let files = 0;
let saved = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (EXT.has(path.extname(e.name)) && fs.statSync(p).size > 1024) {
      const buf = fs.readFileSync(p);
      const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      const gz = zlib.gzipSync(buf, { level: 9 });
      if (br.length < buf.length) fs.writeFileSync(p + '.br', br);
      if (gz.length < buf.length) fs.writeFileSync(p + '.gz', gz);
      files++;
      saved += buf.length - Math.min(br.length, buf.length);
    }
  }
};
if (fs.existsSync(root)) walk(root);
console.log(`precompress: ${files} files in ${path.relative(process.cwd(), root) || root}, ${(saved / 1024).toFixed(0)} kB smaller with brotli`);
