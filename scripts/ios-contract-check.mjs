#!/usr/bin/env node
// API contract check: every HTTP call the iOS app makes (ios/**/*.swift) must hit a route the server defines
// (server/routes/*.ts, server/lib/caldav.ts, mounted in server/index.ts).
//
//   node scripts/ios-contract-check.mjs            summary + unmatched calls
//   node scripts/ios-contract-check.mjs --verbose  also lists every matched call and calls with an unknown method
//   node scripts/ios-contract-check.mjs --json     machine-readable result
//
// Exit code 1 when an iOS call has no server route (wrong path or wrong method).
// Heuristics: the method comes from a preceding "GET"/"POST"/… argument or from the helper's name (get → GET,
// upload → POST …); interpolations "\(x)" match any single path segment; query strings are ignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const VERBOSE = args.has('--verbose');
const JSON_OUT = args.has('--json');
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];
const nestedMounted = new Set();
/** registration order: Express answers with the first matching route */
let mountSeq = 0;
const order = (atLine, line) => mountSeq * 1e6 + (atLine ?? line) * 1e2 + (atLine ? Math.min(99, line / 1e3) : 0);

const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (dir, ext, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(root, p);
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const joinPath = (...parts) => ('/' + parts.filter(Boolean).join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
const strList = (s) => [...s.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);

// ───────────────────────── server side ─────────────────────────

/** module file → { exportName → localName } and local router names */
function routersOf(file) {
  const src = read(file);
  const routers = new Set();
  for (const m of src.matchAll(/(?:export\s+)?const\s+(\w+)\s*=\s*(?:express\.)?Router\(/g)) routers.add(m[1]);
  // routers imported from sibling route files and mounted inside this one (core.ts → places.ts, features.ts → rhythm.ts)
  const imports = {};
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([\w-]+)\.js'/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (orig) imports[(alias ?? orig).trim()] = { file: path.join(path.dirname(file), m[2] + '.ts'), name: orig.trim() };
    }
  }
  return { src, routers, imports };
}

/** routes of one router `name` in `file`, with the given prefix; follows nested `name.use(prefix?, other)` */
function collectRoutes(file, name, prefix, out, seen = new Set(), atLine = null) {
  const key = `${file}#${name}#${prefix}`;
  if (seen.has(key) || !fs.existsSync(file)) return;
  seen.add(key);
  const { src, imports } = routersOf(file);
  const id = name.replace(/\$/g, '\\$');
  const pathSpec = String.raw`(\[[^\]]*\]|'[^']*'|"[^"]*")`;
  const re = new RegExp(String.raw`\b${id}\s*\.\s*(${METHODS.join('|')})\s*\(\s*${pathSpec}`, 'g');
  for (const m of src.matchAll(re)) {
    for (const p of strList(m[2])) out.push({ method: m[1].toUpperCase(), path: joinPath(prefix, p), file: rel(file), line: lineOf(src, m.index), order: order(atLine, lineOf(src, m.index)) });
  }
  // routes built in a helper: const editRoutes = (prefix: string) => { r.put(`${prefix}/face`, …) }; editRoutes('/people/me')
  for (const m of src.matchAll(new RegExp(String.raw`\b${id}\s*\.\s*(${METHODS.join('|')})\s*\(\s*\`\$\{(\w+)\}([^\`$]*)\``, 'g'))) {
    const [, meth, param, rest] = m;
    const head = src.slice(0, m.index);
    const defs = [...head.matchAll(new RegExp(String.raw`(?:const|function)\s+(\w+)\s*=?\s*\(\s*${param}\b`, 'g'))];
    const fn = defs.at(-1)?.[1];
    if (!fn) continue;
    for (const c of src.matchAll(new RegExp(String.raw`\b${fn}\(\s*'([^']*)'\s*\)`, 'g')))
      out.push({ method: meth.toUpperCase(), path: joinPath(prefix, c[1] + rest), file: rel(file), line: lineOf(src, m.index), order: order(atLine, lineOf(src, m.index)) });
  }
  // r.route('/x').get(...).post(...)
  for (const m of src.matchAll(new RegExp(String.raw`\b${id}\s*\.\s*route\(\s*${pathSpec}\s*\)((?:\s*\.\s*(?:${METHODS.join('|')})\s*\()?)`, 'g'))) {
    const tail = src.slice(m.index, m.index + 4000);
    const methods = [...tail.matchAll(new RegExp(String.raw`\)\s*\.\s*(${METHODS.join('|')})\s*\(`, 'g'))].map((x) => x[1]);
    for (const p of strList(m[1])) for (const meth of new Set(methods)) out.push({ method: meth.toUpperCase(), path: joinPath(prefix, p), file: rel(file), line: lineOf(src, m.index), order: order(atLine, lineOf(src, m.index)) });
  }
  // for (const p of ['/a', '/b']) r.post(p, …)
  for (const m of src.matchAll(new RegExp(String.raw`for\s*\(\s*const\s+(\w+)\s+of\s+(\[[^\]]*\])\s*\)\s*${id}\s*\.\s*(${METHODS.join('|')}|use)\s*\(\s*(\w+)`, 'g'))) {
    if (m[1] !== m[4]) continue;
    const meth = m[3] === 'use' ? 'USE' : m[3].toUpperCase();
    for (const p of strList(m[2])) out.push({ method: meth, path: joinPath(prefix, p), file: rel(file), line: lineOf(src, m.index), loop: true, order: order(atLine, lineOf(src, m.index)) });
  }
  // nested routers
  for (const m of src.matchAll(new RegExp(String.raw`\b${id}\s*\.\s*use\(\s*(?:${pathSpec}\s*,\s*)?([\w\s,]+)\)`, 'g'))) {
    const sub = m[1] ? strList(m[1]) : [''];
    for (const ident of m[2].split(',').map((s) => s.trim())) {
      const imp = imports[ident];
      if (imp) {
        nestedMounted.add(`${imp.file}#${imp.name}`);
        for (const p of sub) collectRoutes(imp.file, imp.name, joinPath(prefix, p), out, seen, atLine ?? lineOf(src, m.index));
      }
    }
  }
}

function serverRoutes() {
  const indexFile = path.join(root, 'server/index.ts');
  const src = read(indexFile);
  const alias = {};
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/(routes\/[\w-]+|lib\/caldav)\.js'/g)) {
    for (const part of m[1].split(',')) {
      const [orig, a] = part.trim().split(/\s+as\s+/);
      if (orig) alias[(a ?? orig).trim()] = { file: path.join(root, 'server', m[2] + '.ts'), name: orig.trim() };
    }
  }
  const out = [];
  const mounted = new Set();
  for (const m of src.matchAll(/app\.use\(\s*(?:(\[[^\]]*\]|'[^']*')\s*,\s*)?([\w\s,]+)\)/g)) {
    const prefixes = m[1] ? strList(m[1]) : [''];
    for (const ident of m[2].split(',').map((s) => s.trim())) {
      const a = alias[ident];
      if (!a) continue;
      mounted.add(`${a.file}#${a.name}`);
      mountSeq++;
      for (const p of prefixes) collectRoutes(a.file, a.name, p, out);
    }
  }
  // routes defined directly on `app` in index.ts
  for (const m of src.matchAll(new RegExp(String.raw`\bapp\.(${METHODS.join('|')})\(\s*('[^']*')`, 'g')))
    out.push({ method: m[1].toUpperCase(), path: strList(m[2])[0], file: 'server/index.ts', line: lineOf(src, m.index), order: 1e12 });
  // routers that exist but are mounted nowhere (worth knowing: an iOS call to them would 404)
  const unmounted = [];
  for (const f of walk(path.join(root, 'server/routes'), '.ts')) {
    for (const r of routersOf(f).routers) if (!mounted.has(`${f}#${r}`) && !nestedMounted.has(`${f}#${r}`)) unmounted.push(`${rel(f)}#${r}`);
  }
  // cloud.ts answers these with 404 "Not available in ToHuus Cloud" (self-hosted only)
  const notInCloud = out.filter((r) => r.loop && (r.method === 'USE' || /notInCloud/.test(read(path.join(root, r.file)).split('\n')[r.line - 1])));
  return { routes: out.filter((r) => !r.loop || r.method !== 'USE'), unmounted, notInCloud };
}

/** Express 5 path → list of segment patterns (optional `{…}` groups expand to variants) */
function expandOptional(p) {
  const i = p.indexOf('{');
  if (i < 0) return [p];
  let depth = 0, j = i;
  for (; j < p.length; j++) {
    if (p[j] === '{') depth++;
    else if (p[j] === '}' && --depth === 0) break;
  }
  const inner = p.slice(i + 1, j);
  return [...expandOptional(p.slice(0, i) + p.slice(j + 1)), ...expandOptional(p.slice(0, i) + inner + p.slice(j + 1))];
}
const segs = (p) => p.split('/').filter(Boolean);

// ───────────────────────── iOS side ─────────────────────────

const PH = '\u0000'; // placeholder for an interpolation

/** All Swift string literals with their content; interpolations become PH (and are scanned for nested literals). */
function swiftStrings(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  function readString(start) {
    // at a quote (possibly preceded by #s); returns { end, text }
    let hashes = 0;
    let k = start;
    while (src[k] === '#') { hashes++; k++; }
    const multi = src.startsWith('"""', k);
    k += multi ? 3 : 1;
    const close = (multi ? '"""' : '"') + '#'.repeat(hashes);
    const esc = '\\' + '#'.repeat(hashes);
    let text = '';
    while (k < n) {
      if (src.startsWith(close, k)) return { end: k + close.length, text };
      if (src.startsWith(esc, k)) {
        const after = k + esc.length;
        if (src[after] === '(') {
          // interpolation: skip balanced parens, scanning nested strings
          let depth = 1, q = after + 1;
          while (q < n && depth > 0) {
            if (src[q] === '"' || (src[q] === '#' && /^#+"/.test(src.slice(q, q + 5)))) {
              const inner = readString(q);
              out.push({ index: q, text: inner.text, nested: true });
              q = inner.end;
              continue;
            }
            if (src[q] === '(') depth++;
            else if (src[q] === ')') depth--;
            q++;
          }
          text += PH;
          k = q;
          continue;
        }
        text += src[after] ?? '';
        k = after + 1;
        continue;
      }
      if (!multi && src[k] === '\n') return { end: k, text };
      text += src[k++];
    }
    return { end: k, text };
  }
  while (i < n) {
    if (src.startsWith('//', i)) { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (src[i] === '"' || (src[i] === '#' && /^#+"/.test(src.slice(i, i + 5)))) {
      const s = readString(i);
      out.push({ index: i, end: s.end, text: s.text });
      i = s.end;
      continue;
    }
    i++;
  }
  return out;
}

// url(…) feeds image views / downloads, appendingPathComponent the connect check, WebPageView a web page: all GET
const GET_FNS = new Set(['get', 'getData', 'ixRaw', 'ixDownload', 'rawJSON', 'imageData', 'download', 'getRaw', 'fetchJSON', 'url', 'appendingPathComponent', 'WebPageView', 'range']);
const POST_FNS = new Set(['upload', 'ixUpload', 'postRaw', 'post']);

/** Helpers that take a path below a fixed prefix: `act("POST", "trips/\(id)/pack", …)` → /api/away/trips/:id/pack.
 *  `within` limits a rule to the lines of one type (the "before" tab adds trips/\(id)/ itself). */
const RELATIVE = [
  { file: /Away\/AwayView\.swift$/, fn: /^(act|awaySend)$/, prefix: 'api/away/', within: null },
  { file: /Away\/AwayView\.swift$/, fn: /^act$/, prefix: `api/away/trips/${PH}/`, within: /struct AwayBeforeTab\b/ },
];

/** the range [start, end) of the brace block that starts at the first `{` after `from` */
function braceBlock(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return [from, from];
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return [open, k + 1];
  }
  return [open, src.length];
}

/** method from what precedes a path argument */
function methodBefore(before, file) {
  let b = /(\w+)\s*\(\s*"([A-Z]+)"\s*,\s*$/.exec(before);
  if (b && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(b[2])) return { method: b[2], via: b[1] };
  if ((b = /(\w+)\s*\(\s*(method|m|verb)\s*,\s*$/.exec(before))) return { method: null, via: b[1] };
  if ((b = /\brun\s*\(\s*"[a-z]+"\s*,\s*$/.exec(before)) && file.endsWith('HomeAssistantView.swift')) return { method: 'POST', via: 'run' };
  if ((b = /\bWebPageView\([^()]*path:\s*$/.exec(before))) return { method: 'GET', via: 'WebPageView' };
  if ((b = /(?:\.|\b)(\w+)\s*\(\s*(?:(?:of|path):\s*)?(?:[\w.]+\s*\?\s*(?:"[^"]*"\s*:\s*)?)?$/.exec(before))) {
    const via = b[1];
    // ios/Shared/UploadQueue.swift: request(_ path:, method: String = "POST")
    if (via === 'request' && file.endsWith('UploadQueue.swift')) return { method: 'POST', via };
    return { method: GET_FNS.has(via) ? 'GET' : POST_FNS.has(via) ? 'POST' : null, via };
  }
  return { method: null, via: null };
}

function iosCalls() {
  const files = walk(path.join(root, 'ios'), '.swift').filter((f) => !/\/(ToHuusTests|ToHuusUITests)\//.test(f));
  const calls = [];
  // functions that return a path base: func personBase(…) -> String { isMe ? "api/people/me" : "api/people/person/\(key)" }
  const bases = new Map();
  const baseRanges = new Map();
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/func\s+(\w+)\s*\([^)]*\)\s*->\s*String\s*\{/g)) {
      const [a, z] = braceBlock(src, m.index);
      const lits = swiftStrings(src.slice(a, z)).filter((x) => /^\/?api\//.test(x.text)).map((x) => x.text);
      if (!lits.length) continue;
      bases.set(m[1], lits);
      baseRanges.set(f, [...(baseRanges.get(f) ?? []), [a, z]]);
    }
  }
  for (const f of files) {
    const src = read(f);
    const file = rel(f);
    // base + "/suffix"
    for (const [fn, lits] of bases) {
      for (const m of src.matchAll(new RegExp(String.raw`\b${fn}\(([^()]|\([^()]*\))*\)\s*\+\s*"([^"]*)"`, 'g'))) {
        const { method, via } = methodBefore(src.slice(Math.max(0, m.index - 200), m.index), file);
        for (const l of lits) calls.push({ method, path: '/' + (l + m[2]).replace(/^\//, '').split('?')[0], file, line: lineOf(src, m.index), via });
      }
    }
    // relative helpers
    for (const rule of RELATIVE.filter((r) => r.file.test(file))) {
      let ranges = [[0, src.length]];
      if (rule.within) {
        const w = rule.within.exec(src);
        ranges = w ? [braceBlock(src, w.index)] : [];
      }
      const others = RELATIVE.filter((r) => r !== rule && r.file.test(file) && r.within).map((r) => r.within.exec(src)).filter(Boolean).map((w) => braceBlock(src, w.index));
      for (const s of swiftStrings(src)) {
        if (!ranges.some(([a, z]) => s.index >= a && s.index < z)) continue;
        if (!rule.within && others.some(([a, z]) => s.index >= a && s.index < z)) continue;
        const b = new RegExp(String.raw`\b(\w+)\s*\(\s*"([A-Z]+)"\s*,\s*$`).exec(src.slice(Math.max(0, s.index - 80), s.index));
        if (!b || !rule.fn.test(b[1]) || /^\/?api\//.test(s.text)) continue;
        calls.push({ method: b[2], path: '/' + (rule.prefix + s.text).split('?')[0], file, line: lineOf(src, s.index), via: b[1], abs: f, pos: s.end });
      }
    }
    const strings = swiftStrings(src);
    for (const s of strings) {
      const m = /^\/?api\//.exec(s.text);
      if (!m) continue;
      if ((baseRanges.get(f) ?? []).some(([a, z]) => s.index >= a && s.index < z)) continue;
      // a path prefix used by a relative helper ("api/away/\(path)") is checked through its callers
      if (RELATIVE.some((r) => r.file.test(file) && s.text === r.prefix + PH)) continue;
      const before = src.slice(Math.max(0, s.index - 200), s.index);
      let { method, via } = methodBefore(before, file);
      // the method may also be given in a URLRequest: req.httpMethod = "POST" a few lines below
      if (!method) {
        const after = src.slice(s.index, s.index + 600);
        const hm = /httpMethod\s*=\s*"([A-Z]+)"/.exec(after);
        if (hm) method = hm[1];
      }
      let p = s.text.replace(/^\//, '').split('?')[0].replace(/#.*/, '');
      calls.push({ method, path: '/' + p, file: rel(f), line: lineOf(src, s.index), via, abs: f, pos: s.end });
    }
  }
  return calls;
}

// ───────────────────────── matching ─────────────────────────

function segMatch(iosSeg, serverSeg) {
  if (serverSeg.startsWith(':')) return true;
  if (iosSeg.includes(PH)) {
    if (iosSeg === PH) return true;
    // "file-\(x).pdf" vs a literal: compare the fixed parts
    const re = new RegExp('^' + iosSeg.split(PH).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return re.test(serverSeg) || /[:*]/.test(serverSeg);
  }
  return iosSeg === serverSeg;
}

function pathMatch(iosPath, serverPath) {
  const a = segs(iosPath);
  for (const variant of expandOptional(serverPath)) {
    const b = segs(variant);
    let ok = true;
    let i = 0;
    for (; i < b.length; i++) {
      if (b[i].startsWith('*')) { i = -1; break; } // splat: rest matches
      if (i >= a.length || !segMatch(a[i], b[i])) { ok = false; break; }
    }
    if (ok && (i === -1 || a.length === b.length)) return true;
    // a trailing interpolation in iOS may stand for several segments ("api/away/\(path)")
    if (!ok || a.length !== b.length) {
      if (a.length && a[a.length - 1] === PH && b.length >= a.length) {
        let ok2 = true;
        for (let k = 0; k < a.length - 1; k++) if (!segMatch(a[k], b[k])) ok2 = false;
        if (ok2) return true;
      }
    }
  }
  return false;
}

/** a param route whose handler starts with `if (…) return next()` lets other routes answer */
function passesOn(route) {
  const lines = read(path.join(root, route.file)).split('\n').slice(route.line - 1, route.line + 3).join('\n');
  return /return\s+(void\s+)?next\(\)/.test(lines);
}

/** the route has a fixed word where the call has "\(x)" – only a clash if x happens to be that word */
function literalVsInterpolation(iosPath, serverPath) {
  const a = segs(iosPath);
  return expandOptional(serverPath).every((v) => segs(v).some((b, i) => a[i] === PH && !/^[:*]/.test(b)));
}

/** how many of the call's literal segments a route matches with literal segments */
function literalScore(iosPath, serverPath) {
  const a = segs(iosPath);
  let best = 0;
  for (const v of expandOptional(serverPath)) {
    const b = segs(v);
    let n = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (!a[i].includes(PH) && a[i] === b[i]) n++;
    best = Math.max(best, n);
  }
  return best;
}


// ───────────────────────── request bodies ─────────────────────────

/** top-level keys of the object literal starting at `open` ("{") – `a: …`, `'a': …`, shorthand `a,` */
function objectKeys(src, open) {
  const keys = [];
  let depth = 0, k = open, token = '', expectKey = true;
  for (; k < src.length; k++) {
    const ch = src[k];
    if (ch === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) break; continue; }
    if (ch === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch; let j = k + 1;
      while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; }
      if (depth === 1 && expectKey) token = src.slice(k + 1, j);
      k = j; continue;
    }
    if ('{[('.includes(ch)) { depth++; if (depth > 1) expectKey = false; continue; }
    if ('}])'.includes(ch)) {
      if (depth === 1 && expectKey && /^(\.\.\.)?\w+$/.test(token.trim())) keys.push(token.trim()); // shorthand / spread before "}"
      depth--; if (depth === 0) return { keys, end: k + 1 }; continue;
    }
    if (depth !== 1) continue;
    if (ch === ':' && expectKey) { if (token.trim()) keys.push(token.trim().replace(/\?$/, '')); expectKey = false; token = ''; continue; }
    if (ch === ',') {
      const t = token.trim();
      if (expectKey && /^\w+$/.test(t)) keys.push(t);
      else if (expectKey && /^\.\.\.\w+$/.test(t)) keys.push(t); // spread: resolved by the caller
      expectKey = true; token = ''; continue;
    }
    if (expectKey) token += ch;
  }
  return { keys, end: k };
}

const libSources = new Map();
function findSchemaConst(name, file) {
  const files = [file, ...walk(path.join(root, 'server/lib'), '.ts')];
  for (const f of files) {
    if (!libSources.has(f)) libSources.set(f, read(f));
    const src = libSources.get(f);
    const m = new RegExp(String.raw`(?:export\s+)?const\s+${name}\s*(?::[^=]+)?=\s*`).exec(src);
    if (m) return { src, at: m.index + m[0].length, file: f };
  }
  return null;
}

/** keys a zod expression accepts; null = unknown, '*' in keys = anything (passthrough / record / any) */
function schemaKeys(src, at, file, depth = 0) {
  if (depth > 4) return null;
  const rest = src.slice(at, at + 20000);
  let m;
  if ((m = /^z\s*\.\s*object\(\s*\{/.exec(rest))) {
    const o = objectKeys(src, at + m[0].length - 1);
    const tail = src.slice(o.end, o.end + 200);
    const keys = new Set();
    for (const k of o.keys) {
      if (!k.startsWith('...')) { keys.add(k); continue; }
      // ...ListPrivacy – a plain object of fields defined in the same file or a lib
      const c = findSchemaConst(k.slice(3), file);
      const open = c ? c.src.indexOf('{', c.at) : -1;
      if (c && open >= 0 && open - c.at < 5) for (const x of objectKeys(c.src, open).keys) keys.add(x);
      else keys.add('*');
    }
    if (/^\s*\)\s*\.\s*(passthrough|catchall)\(/.test(tail)) keys.add('*');
    const ext = /^\s*\)\s*\.\s*extend\(\s*\{/.exec(tail);
    if (ext) for (const k of objectKeys(src, o.end + ext[0].length - 1).keys) keys.add(k);
    return keys;
  }
  if ((m = /^z\s*\.\s*object\(\s*(\w+)\s*\)/.exec(rest))) {
    // z.object(Privacy) – a plain object of fields
    const c = findSchemaConst(m[1], file);
    const open = c ? c.src.indexOf('{', c.at) : -1;
    return c && open >= 0 && open - c.at < 5 ? new Set(objectKeys(c.src, open).keys) : null;
  }
  if ((m = /^z\.(record|any|unknown)\(/.exec(rest))) return new Set(['*']);
  if ((m = /^(\w+)(\s*\.\s*(partial|strict|required)\(\))*\s*\.\s*extend\(\s*\{/.exec(rest))) {
    const base = resolveSchema(m[1], file, depth + 1);
    const ext = objectKeys(src, at + m[0].length - 1).keys;
    return base ? new Set([...base, ...ext]) : null;
  }
  if ((m = /^(\w+)\b/.exec(rest)) && m[1] !== 'z') return resolveSchema(m[1], file, depth + 1);
  return null;
}
function resolveSchema(name, file, depth) {
  const c = findSchemaConst(name, file);
  return c ? schemaKeys(c.src, c.at, c.file, depth) : null;
}

/** what the handler of a route reads from req.body */
function bodyKeysOf(route) {
  const file = path.join(root, route.file);
  if (!libSources.has(file)) libSources.set(file, read(file));
  const src = libSources.get(file);
  const lines = src.split('\n');
  const start = lines.slice(0, route.line - 1).join('\n').length + 1;
  // the handler: up to the next route definition at the start of a line
  const after = src.slice(start + 1);
  const next = after.search(/\n(?:\w+)\.(?:get|post|put|patch|delete|all|use)\(|\n(?:export\s+)?(?:const|function|for)\s/);
  const handler = src.slice(start, next < 0 ? src.length : start + 1 + next);
  const keys = new Set();
  let known = false;
  // schema.parse(req.body …) – find the expression before ".parse("
  for (const pm of handler.matchAll(/\.parse\(\s*req\.body/g)) {
    // walk back to the start of the schema expression: z.object( … ) or an identifier
    const before = handler.slice(0, pm.index).replace(/\s+$/, '');
    let exprStart = -1;
    // balanced: if it ends with ")" find the matching "("…; whitespace inside a chain (z\n  .object(…)) is skipped
    let j = before.length - 1, depth = 0;
    while (j >= 0) {
      const ch = before[j];
      if (ch === ')' || ch === '}' || ch === ']') depth++;
      else if (ch === '(' || ch === '{' || ch === '[') { if (depth === 0) break; depth--; }
      else if (depth === 0 && /\s/.test(ch) && /^\s*\./.test(before.slice(j))) { j--; continue; }
      else if (depth === 0 && /[\s=,;:?]/.test(ch)) break;
      j--;
    }
    exprStart = j + 1;
    const ks = schemaKeys(handler, exprStart, file);
    if (ks) { known = true; for (const k of ks) keys.add(k); }
    else return null;
  }
  for (const dm of handler.matchAll(/req\.body\??\.(\w+)/g)) { known = true; keys.add(dm[1]); }
  for (const dm of handler.matchAll(/const\s*\{([^}]+)\}\s*=\s*req\.body/g)) { known = true; for (const k of dm[1].split(',')) keys.add(k.trim().split(/[\s:=]/)[0]); }
  if (/req\.body\s*(?:as|\)|,|;|\?\?)/.test(handler.replace(/\.parse\(\s*req\.body/g, ''))) keys.add('*'); // passed on whole
  return known ? keys : null;
}

/** the keys an iOS call sends: a dictionary literal after `json:` (or the 3rd positional argument of the
 *  helpers that take one), or a variable built in the same function */
function iosBodyKeys(c) {
  const src = read(c.abs);
  // arguments after the path literal, up to the call's closing parenthesis
  let depth = 1, k = c.pos, inStr = false;
  for (; k < src.length && depth > 0; k++) {
    const ch = src[k];
    if (ch === '"' && src[k - 1] !== '\\') inStr = !inStr;
    if (inStr) continue;
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
  }
  const args = src.slice(c.pos, k - 1);
  let m = /^\s*(?:\+\s*"[^"]*"\s*)?,\s*(?:json:\s*|body:\s*)?/.exec(args);
  if (!m) return null;
  let expr = args.slice(m[0].length).trim();
  if (/^(as|query|timeout|multipart|ok|done):/.test(expr) || !expr) return null;
  if (/^body:/.test(args.slice(m[0].length - 6))) return null;
  if (expr.startsWith('nil')) return null;
  if (expr.startsWith('[')) {
    if (/^\[\s*:\s*\]/.test(expr)) return { keys: [] };
    const keys = [...dictTopKeys(expr)];
    return keys.length ? { keys } : null;
  }
  const id = /^(\w+)/.exec(expr)?.[1];
  if (!id || ['NotifyKit', 'payload', 'nil'].includes(id) && id !== 'payload') return null;
  // the enclosing function
  const fnStart = src.lastIndexOf('func ', c.pos);
  const fnText = src.slice(fnStart, c.pos);
  const keys = new Set();
  const lit = new RegExp(String.raw`(?:var|let)\s+${id}\s*(?::\s*\[String\s*:\s*Any\??\])?\s*=\s*\[`).exec(fnText);
  if (lit) for (const key of dictTopKeys(fnText.slice(lit.index + lit[0].length - 1))) keys.add(key);
  for (const a of fnText.matchAll(new RegExp(String.raw`\b${id}\["(\w+)"\]\s*=`, 'g'))) keys.add(a[1]);
  if (!lit && !keys.size) return null;
  return { keys: [...keys] };
}

function dictTopKeys(text) {
  const keys = new Set();
  let depth = 0, inStr = false, strStart = -1;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === '\\' && inStr) { if (text[k + 1] === '(') { /* interpolation: skip */ let d = 0; k++; for (; k < text.length; k++) { if (text[k] === '(') d++; else if (text[k] === ')' && --d === 0) break; } } else k++; continue; }
    if (ch === '"') {
      if (!inStr) { inStr = true; strStart = k; }
      else {
        inStr = false;
        // a key follows "[" or "," and is followed by ":" (not a ternary's `c ? "a" : "b"`)
        const lead = text.slice(0, strStart).trimEnd().slice(-1);
        if (depth === 1 && (lead === '[' || lead === ',') && /^\s*:/.test(text.slice(k + 1))) keys.add(text.slice(strStart + 1, k));
      }
      continue;
    }
    if (inStr) continue;
    if ('[({'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) { depth--; if (depth === 0) break; }
  }
  return keys;
}

function bodyCheck(matched) {
  const issues = [];
  const unresolved = [];
  let checked = 0;
  for (const c of matched) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.method) || !c.abs) continue;
    const sent = iosBodyKeys(c);
    if (!sent) continue;
    // the first matching route may be a pre-check (cloud.post('/invites', …, next)) – take the first that reads the body
    let accepted = bodyKeysOf(c.target);
    if (!accepted) for (const r of routes.filter((r) => r !== c.target && r.method === c.target.method && r.path === c.target.path)) { accepted = bodyKeysOf(r); if (accepted) break; }
    if (!accepted || accepted.has('*')) { if (sent.keys.length) unresolved.push({ ...c, sent: sent.keys, why: accepted ? 'server takes any key' : 'server schema not found' }); continue; }
    checked++;
    const unknown = sent.keys.filter((k) => !accepted.has(k));
    if (unknown.length) issues.push({ ...c, unknown, accepted: [...accepted] });
  }
  return { issues, checked, unresolved };
}

const { routes, unmounted, notInCloud } = serverRoutes();
const calls = iosCalls();
const show = (p) => p.replaceAll(PH, '\\(…)');
const result = { matched: [], wrongMethod: [], noRoute: [], unknownMethod: [], shadowed: [] };
for (const c of calls) {
  const samePath = routes.filter((r) => pathMatch(c.path, r.path));
  if (!samePath.length) { result.noRoute.push(c); continue; }
  if (!c.method) { result.unknownMethod.push({ ...c, serverMethods: [...new Set(samePath.map((r) => r.method))] }); continue; }
  // a literal route for this exact path wins: PATCH /plan/shopping must not count as PATCH /plan/:id
  const literal = samePath.filter((r) => literalScore(c.path, r.path) === segs(c.path).filter((x) => !x.includes(PH)).length);
  const hit = samePath.find((r) => r.method === c.method || r.method === 'ALL');
  const literalHit = literal.find((r) => r.method === c.method || r.method === 'ALL');
  if (hit && (!literal.length || literalHit)) {
    const target = literalHit ?? hit;
    result.matched.push({ ...c, route: `${target.method} ${target.path}`, at: `${target.file}:${target.line}`, target });
    // an earlier param route with the same method answers first (GET /x/:id registered before GET /x/list)
    const first = samePath
      .filter((r) => (r.method === c.method || r.method === 'ALL') && r.order < target.order && !passesOn(r) && !literalVsInterpolation(c.path, r.path) && literalScore(c.path, r.path) < literalScore(c.path, target.path))
      .sort((a, b) => a.order - b.order)[0];
    if (first && first !== target && literalHit) result.shadowed.push({ ...c, route: `${target.method} ${target.path} (${target.file}:${target.line})`, by: `${first.method} ${first.path} (${first.file}:${first.line})` });
  }
  else result.wrongMethod.push({ ...c, serverMethods: [...new Set((literal.length ? literal : samePath).map((r) => `${r.method} ${r.path}`))], absorbedBy: hit ? `${hit.method} ${hit.path}` : null });
}
const selfHostOnly = calls.filter((c) => notInCloud.some((r) => pathMatch(c.path, r.path) || (r.method === 'USE' && show(c.path).startsWith(r.path.replace(/:\w+/g, '')))));

const bodies = bodyCheck(result.matched);

if (JSON_OUT) {
  const clean = (l) => l.map((c) => ({ ...c, path: show(c.path) }));
  console.log(JSON.stringify({ serverRoutes: routes.length, iosCalls: calls.length, matched: result.matched.length, shadowed: clean(result.shadowed), noRoute: clean(result.noRoute), wrongMethod: clean(result.wrongMethod), unknownMethod: clean(result.unknownMethod), unmounted }, null, 2));
} else {
  console.log(`server routes: ${routes.length}   iOS call sites: ${calls.length}`);
  console.log(`matched: ${result.matched.length}   shadowed: ${result.shadowed.length}   no route: ${result.noRoute.length}   wrong method: ${result.wrongMethod.length}   method unknown (path ok): ${result.unknownMethod.length}`);
  if (result.noRoute.length) {
    console.log('\n✗ iOS calls without any server route:');
    for (const c of result.noRoute) console.log(`  ${(c.method ?? '?').padEnd(6)} ${show(c.path).padEnd(55)} ${c.file}:${c.line}`);
  }
  if (result.wrongMethod.length) {
    console.log('\n✗ iOS calls with a method the server does not accept:');
    for (const c of result.wrongMethod) console.log(`  ${c.method.padEnd(6)} ${show(c.path).padEnd(55)} ${c.file}:${c.line}   server: ${c.serverMethods.join(', ')}${c.absorbedBy ? ` (would hit ${c.absorbedBy})` : ''}`);
  }
  if (result.shadowed.length) {
    console.log('\n✗ iOS calls answered by an earlier, more general route (Express takes the first match):');
    for (const c of result.shadowed) console.log(`  ${c.method.padEnd(6)} ${show(c.path).padEnd(55)} ${c.file}:${c.line}\n         meant: ${c.route}\n         hits:  ${c.by}`);
  }
  if (VERBOSE && result.unknownMethod.length) {
    console.log('\n? method not determinable (path exists):');
    for (const c of result.unknownMethod) console.log(`  ${show(c.path).padEnd(55)} ${c.file}:${c.line}   server: ${c.serverMethods.join(', ')}`);
  }
  if (VERBOSE) {
    console.log('\n✓ matched:');
    for (const c of result.matched) console.log(`  ${c.method.padEnd(6)} ${show(c.path).padEnd(55)} ${c.file}:${c.line} → ${c.at}`);
  }
  console.log(`\nrequest bodies compared with the server's schema: ${bodies.checked}   keys the server does not read: ${bodies.issues.length}`);
  for (const c of bodies.issues) console.log(`  ${c.method.padEnd(6)} ${show(c.path).padEnd(45)} ${c.file}:${c.line}\n         sends ${c.unknown.join(', ')} – server reads ${c.accepted.join(', ') || '(nothing)'}   (${c.at})`);
  if (VERBOSE && bodies.unresolved.length) {
    console.log(`\n? bodies sent where the server's accepted keys could not be determined (${bodies.unresolved.length}):`);
    for (const c of bodies.unresolved) console.log(`  ${c.method.padEnd(6)} ${show(c.path).padEnd(45)} ${c.file}:${c.line}  sends ${c.sent.join(', ')}  (${c.why}, ${c.at})`);
  }
  if (selfHostOnly.length) {
    console.log(`\nℹ ${selfHostOnly.length} iOS call(s) to routes ToHuus Cloud answers with 404 "Not available in ToHuus Cloud" (must be hidden in the cloud):`);
    for (const c of selfHostOnly) console.log(`  ${(c.method ?? '?').padEnd(6)} ${show(c.path).padEnd(55)} ${c.file}:${c.line}`);
  }
  if (unmounted.length) console.log(`\nℹ routers defined but not mounted in server/index.ts: ${unmounted.join(', ')}`);
}
process.exit(result.noRoute.length || result.wrongMethod.length || result.shadowed.length || bodies.issues.length ? 1 : 0);
