import Foundation
// Walks a decoded value next to its JSON: reports optional properties that came out nil although the JSON had a
// non-null value under the matching key (silent type mismatch), and records which properties ever matched a key.
enum Audit {
    nonisolated(unsafe) static var silentNil: [String: String] = [:]
    nonisolated(unsafe) static var seen: [String: Int] = [:]      // "Type.prop" → times the JSON had the key
    nonisolated(unsafe) static var total: [String: Int] = [:]     // "Type.prop" → times the object was audited
    nonisolated(unsafe) static var context = ""
    nonisolated(unsafe) static var collisions: [String: String] = [:]
    /// reviewed: ProductExtra.dateKind reads `date_kind_setting` (JSONCoding.splitDateKind), vsLastMonth is nil when
    /// the server sends pct: null (nothing to compare up to this day)
    static let expectedNil: Set<String> = ["ProductExtra.dateKind", "MoneyOverview.vsLastMonth"]

    static func camel(_ k: String) -> String {
        guard k.contains("_") else { return k }
        var out = ""
        var upper = false
        var leading = true
        for ch in k {
            if ch == "_" { if leading { out.append(ch) } else { upper = true }; continue }
            leading = false
            if upper { out += String(ch).uppercased(); upper = false } else { out.append(ch) }
        }
        return out
    }

    static func run(_ value: Any, _ data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return }
        walk(value, json, path: "\(type(of: value))")
    }

    static func unwrap(_ v: Any) -> Any? {
        let m = Mirror(reflecting: v)
        if m.displayStyle == .optional { return m.children.first.map { unwrap($0.value) } ?? nil }
        return v
    }

    static func walk(_ value: Any, _ json: Any, path: String) {
        guard let v = unwrap(value) else { return }
        let m = Mirror(reflecting: v)
        let tname = String(describing: type(of: v))
        if tname.hasPrefix("Lossy<"), let w = m.children.first { walk(w.value, json, path: path); return }
        if m.displayStyle == .collection, let arr = json as? [Any] {
            // Lossy drops cannot be lined up; only audit when counts match
            let items = Array(m.children)
            if items.count == arr.count { for (i, c) in items.enumerated() { walk(c.value, arr[i], path: path + "[]") } }
            return
        }
        guard m.displayStyle == .struct || m.displayStyle == .class, let obj = json as? [String: Any] else { return }
        if tname == "JSONValue" || tname == "FlexID" { return }
        var byCamel: [String: (String, Any)] = [:]
        for (k, val) in obj {
            let ck = camel(k)
            if let other = byCamel[ck], other.0 != k { collisions["\(tname): \(other.0) / \(k)"] = context }
            if byCamel[ck] == nil || k == ck { byCamel[ck] = (k, val) }
        }
        for c in m.children {
            guard var label = c.label else { continue }
            if label.hasPrefix("_") { label.removeFirst() }
            let key = "\(tname).\(label)"
            total[key, default: 0] += 1
            guard let (rawKey, jv) = byCamel[label] else { continue }
            seen[key, default: 0] += 1
            let isNull = jv is NSNull
            if !isNull, unwrap(c.value) == nil, !expectedNil.contains(key) {
                silentNil[key] = "\(context): \(path).\(label) – JSON \"\(rawKey)\" = \(String(describing: jv).prefix(80))"
            } else if !isNull {
                walk(c.value, jv, path: path + "." + label)
            }
        }
    }

    static func dumpSeenTypes() {
        let types = Set(total.keys.map { String($0.split(separator: ".").first ?? "") })
        try? types.sorted().joined(separator: "\n").write(toFile: ProcessInfo.processInfo.environment["SEEN"] ?? "/dev/null", atomically: true, encoding: .utf8)
    }

    static func report() {
        dumpSeenTypes()
        print("\n== silent nils (JSON had a value, Swift property is nil) ==")
        for (_, v) in silentNil.sorted(by: { $0.key < $1.key }) { print("  " + v) }
        print("\n== key collisions after snake→camel (decoder keeps one of them) ==")
        for (k, v) in collisions.sorted(by: { $0.key < $1.key }) { print("  \(k)   [\(v)]") }
        print("\n== properties never present in any JSON audited ==")
        for (k, n) in total.sorted(by: { $0.key < $1.key }) where seen[k] == nil && n > 0 { print("  \(k) (\(n)x)") }
    }
}
