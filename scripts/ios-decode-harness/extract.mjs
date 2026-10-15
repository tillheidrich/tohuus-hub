// Pulls the APIClient extensions, Codable types and a few helpers out of the SwiftUI feature files, so the app's API
// layer compiles on Linux (used by build.sh).
import fs from 'node:fs';
import path from 'node:path';
const [,, iosDir, outDir] = process.argv;
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : p.endsWith('.swift') && o.push(p); } return o; };
// skip strings/comments when matching braces
function blockEnd(src, open) {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    const c = src[k];
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) return src.length; continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k) + 1; continue; }
    if (c === '"') {
      if (src.startsWith('"""', k)) { k = src.indexOf('"""', k + 3) + 2; continue; }
      k++;
      let paren = 0;
      while (k < src.length) {
        if (src[k] === '\\' && src[k + 1] === '(') { paren++; k += 2; continue; }
        if (paren && src[k] === ')') { paren--; k++; continue; }
        if (paren && src[k] === '"') { // nested string inside interpolation
          k++; while (k < src.length && src[k] !== '"') { if (src[k] === '\\') k++; k++; } k++; continue; }
        if (!paren && src[k] === '\\') { k += 2; continue; }
        if (!paren && src[k] === '"') break;
        k++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return k + 1;
  }
  return src.length;
}
const files = [...walk(path.join(iosDir, 'ToHuus/Features')), path.join(iosDir, 'ToHuus/Design/Components.swift')];
const EXTRA = ['PasskeyOptionsAnswer', 'PasskeyRegistrationResult', 'orNull', 'HandoverItemInput', 'handoverNul', 'MenuQty', 'AIImportTemplate', 'PersonColors', 'Money'];
const decl = new RegExp(String.raw`^(?:(?:private|fileprivate|public|internal)\s+)?(?:(extension\s+APIClient\b[^{]*)|((?:struct|enum|func)\s+(?:${EXTRA.join('|')})\b[^{]*)|((?:struct|enum|final class|class)\s+(\w+)\s*(?:<[^>]*>)?\s*:[^{]*\b(?:Decodable|Codable|Encodable)\b[^{]*))\{`, 'gm');
let out = '';
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  decl.lastIndex = 0;
  const parts = [];
  while ((m = decl.exec(src))) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    const end = blockEnd(src, open);
    let text = src.slice(m.index, end).replace(/^(private|fileprivate)\s+/, '');
    parts.push(text);
    decl.lastIndex = end;
  }
  if (parts.length) out += `// ---- ${path.relative(iosDir, f)}\n` + parts.join('\n\n') + '\n\n';
}
fs.writeFileSync(path.join(outDir, 'Extracted.swift'), 'import Foundation\n\n' + out);
