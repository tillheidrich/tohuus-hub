import Foundation

/// Swift port of server/lib/shopparse.ts `parseQuickAdd` – used offline to show what will land on the list
/// ("2 Milch, Brot und 3 Dosen Tomaten" → three rows) before the server confirms.
enum QuickAddParser {
    struct Item: Equatable, Sendable {
        var raw: String
        var name: String
        var qty: Double?
        var unit: String?
        var amount: String?
    }

    private static let numberWords: [String: Double] = [
        "ein": 1, "eine": 1, "einen": 1, "einem": 1, "eins": 1, "zwei": 2, "drei": 3, "vier": 4, "fuenf": 5, "fünf": 5, "sechs": 6,
        "sieben": 7, "acht": 8, "neun": 9, "zehn": 10, "elf": 11, "zwoelf": 12, "zwölf": 12, "dutzend": 12, "paar": 2,
        "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "dozen": 12, "couple": 2,
    ]

    private static let containers: Set<String> = [
        "dose", "dosen", "packung", "packungen", "pck", "pkg", "pk", "packerl", "flasche", "flaschen", "fl", "glas", "glaeser", "gläser",
        "becher", "tuete", "tüte", "tueten", "tüten", "beutel", "stueck", "stück", "stk", "st", "kiste", "kisten", "rolle", "rollen",
        "bund", "netz", "netze", "schale", "schalen", "karton", "kartons", "tafel", "tafeln", "tube", "tuben", "laib", "riegel",
        "can", "cans", "tin", "tins", "bottle", "bottles", "pack", "packs", "packet", "packets", "jar", "jars", "box", "boxes",
        "bag", "bags", "piece", "pieces", "pcs", "roll", "rolls", "loaf", "loaves", "bunch", "bunches", "carton", "cartons",
        "tub", "tubs", "bar", "bars", "crate", "crates", "x", "×",
    ]

    private static let measures: Set<String> = [
        "g", "gr", "gramm", "kg", "kilo", "mg", "l", "liter", "litre", "liters", "litres", "ml", "cl", "dl", "lb", "lbs", "oz", "pfund",
    ]

    private static let filler: Set<String> = ["of", "von", "vom"]

    private static let split = try! NSRegularExpression(
        pattern: #"\s*(?:[;\n]|(?<!\d),|,(?!\d)|\s+und\s+|\s+and\s+|\s+&\s+|\s+\+\s+|\s+sowie\s+)\s*"#, options: [.caseInsensitive])
    private static let gluedX = try! NSRegularExpression(pattern: #"^(\d+(?:[.,]\d+)?)\s*([x×])(?=\s|$)"#, options: [.caseInsensitive])
    private static let gluedUnit = try! NSRegularExpression(pattern: #"^(\d+(?:[.,]\d+)?)([a-zäöü]+)\b"#, options: [.caseInsensitive])
    private static let trailing = try! NSRegularExpression(
        pattern: #"^(.*\S)\s+(?:[x×]\s?(\d+)|(\d+)\s?[x×]|\((\d+)\)|(\d+))$"#, options: [.caseInsensitive])
    private static let leadingBullet = try! NSRegularExpression(pattern: #"^[-*•·–]+\s*"#)
    private static let spaces = try! NSRegularExpression(pattern: #"\s+"#)

    static func parseNum(_ s: String) -> Double? {
        if s.range(of: #"^\d+(?:[.,]\d+)?$"#, options: .regularExpression) != nil {
            return Double(s.replacingOccurrences(of: ",", with: "."))
        }
        return numberWords[s.lowercased()]
    }

    private static func fmt(_ n: Double) -> String {
        n.rounded() == n ? String(Int(n)) : String(n).replacingOccurrences(of: ".", with: ",")
    }

    private static func group(_ m: NSTextCheckingResult, _ i: Int, in s: String) -> String? {
        let r = m.range(at: i)
        guard r.location != NSNotFound, let rr = Range(r, in: s) else { return nil }
        return String(s[rr])
    }

    private static func replace(_ re: NSRegularExpression, in s: String, with t: String) -> String {
        re.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: t)
    }

    static func parseFragment(_ raw: String) -> Item? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        s = replace(leadingBullet, in: s, with: "")
        s = replace(spaces, in: s, with: " ")
        if s.isEmpty { return nil }
        var qty: Double? = nil
        var unit: String? = nil
        var amount: String? = nil

        // glued forms: "2x", "3×", "500g", "1,5l"
        s = replace(gluedX, in: s, with: "$1 $2")
        if let m = gluedUnit.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
           let n = group(m, 1, in: s), let u = group(m, 2, in: s),
           measures.contains(u.lowercased()) || containers.contains(u.lowercased()),
           let whole = Range(m.range, in: s) {
            s.replaceSubrange(whole, with: "\(n) \(u)")
        }
        var words = s.split(separator: " ").map(String.init)

        let lead = words.count > 1 ? parseNum(words[0]) : nil
        if let lead {
            words.removeFirst()
            let u = words.first?.lowercased()
            if let u, words.count > 1, measures.contains(u) {
                amount = "\(fmt(lead)) \(words[0])"
                unit = words[0]
                words.removeFirst()
            } else {
                qty = lead
                if let u, words.count > 1, containers.contains(u) {
                    if u != "x" && u != "×" { unit = words[0] }
                    words.removeFirst()
                }
            }
            if words.count > 1, filler.contains(words[0].lowercased()) { words.removeFirst() }
        } else if let m = trailing.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
                  let head = group(m, 1, in: s), !(head.first?.isNumber ?? false) {
            let n = group(m, 2, in: s) ?? group(m, 3, in: s) ?? group(m, 4, in: s) ?? group(m, 5, in: s)
            qty = n.flatMap { Double($0) }
            words = head.split(separator: " ").map(String.init)
        }
        var name = words.joined(separator: " ").trimmingCharacters(in: .whitespaces)
        if name.isEmpty { return nil }
        name = name.prefix(1).uppercased() + name.dropFirst()
        if let q = qty, !q.isFinite || q <= 0 { qty = nil }
        if let q = qty { qty = min(q, 999) }
        return Item(raw: raw.trimmingCharacters(in: .whitespacesAndNewlines), name: name, qty: qty, unit: unit, amount: amount)
    }

    /// Splits a line into fragments (comma, semicolon, newline, "und", "and", "&", "+", "sowie").
    static func fragments(_ text: String) -> [String] {
        var out: [String] = []
        var last = text.startIndex
        for m in split.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let r = Range(m.range, in: text) else { continue }
            out.append(String(text[last..<r.lowerBound]))
            last = r.upperBound
        }
        out.append(String(text[last...]))
        return out
    }

    static func parse(_ text: String) -> [Item] {
        var out: [Item] = []
        for frag in fragments(text) {
            guard let p = parseFragment(frag) else { continue }
            if let i = out.firstIndex(where: { $0.name.lowercased() == p.name.lowercased() && $0.unit == p.unit && $0.amount == nil && p.amount == nil }) {
                out[i].qty = (out[i].qty ?? 1) + (p.qty ?? 1)
                continue
            }
            out.append(p)
        }
        return Array(out.prefix(50))
    }
}
