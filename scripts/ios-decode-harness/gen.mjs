// Generates src/main.swift (run in the build folder): calls every read-only APIClient function without arguments, then
// the scenarios file given as argument (scripts/ios-decode-harness/scenarios.swift).
import fs from 'node:fs';
const src = fs.readdirSync('src').filter((f) => f !== 'main.swift').map((f) => fs.readFileSync('src/' + f, 'utf8')).join('\n');
const fns = [];
const re = /^\s*(?:@MainActor\s+)?func\s+(\w+)\(([^)]*)\)\s*async\s+throws\s*->\s*([^{]+)\{/gm;
let m;
while ((m = re.exec(src))) {
  // body
  let depth = 0, k = src.indexOf('{', m.index + m[0].length - 1), start = k;
  for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) break; }
  const body = src.slice(start, k);
  fns.push({ name: m[1], params: m[2].trim(), ret: m[3].trim(), body });
}
const MUTATE = /\b(send|upload|sendRaw|ixRawSend|ixUpload|postRaw)\(/;
const READ = /\b(get|getData|ixRaw|rawJSON)\(/;
const noArgs = (p) => !p || p.split(',').every((x) => x.includes('='));
const skip = new Set(['instance', 'recipesExportJSON', 'exportList']);
const calls = fns.filter((f) => READ.test(f.body) && !MUTATE.test(f.body) && noArgs(f.params) && !skip.has(f.name));
const extra = process.argv[2] && fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], 'utf8') : '';
let out = `import Foundation
import FoundationNetworking
let base = URL(string: ProcessInfo.processInfo.environment["BASE"]!)!
let api = APIClient(baseURL: base, token: ProcessInfo.processInfo.environment["TOKEN"], householdId: ProcessInfo.processInfo.environment["HH"])
nonisolated(unsafe) var failures = 0
func check(_ name: String, _ work: () async throws -> Any) async {
    Audit.context = name
    do { let v = try await work(); print("ok   \\(name)\\(summary(v))") }
    catch APIError.decoding(let msg) { failures += 1; print("FAIL \\(name): \\(msg.prefix(700))") }
    catch { print("err  \\(name): \\(error)") }
}
func summary(_ v: Any) -> String { if let a = v as? [Any] { return " [\\(a.count)]" }; return "" }
`;
for (const f of calls) out += `await check("${f.name}") { try await api.${f.name}()${f.ret.endsWith('?') ? ' as Any' : ''} }\n`;
out += extra + '\nprint("decode failures: \\(failures)")\nAudit.report()\n';
fs.writeFileSync('src/main.swift', out);
console.log(`${calls.length} read calls generated (of ${fns.length} functions)`);
