import Foundation

// Models for the 0.3 parity work in Einkauf & Vorrat (package A). Shapes from server/routes/*.ts; the decoder converts
// snake_case keys to camelCase.

// MARK: - shopping: privacy, claims, members

/// `share` on a list row: discreet / private entry (server/lib/share-core.ts, web pages/Share.tsx ShareInfo)
struct ShareInfo: Codable, Sendable, Equatable, Hashable {
    /// private | discreet
    var visibility: String
    var mine: Bool?
    var owner: String?
    var revealed: Bool?
    var shareWith: [Int]?
    var reveal: Bool?
    var placeholder: String?

    var isPrivate: Bool { visibility == "private" }
    var isMine: Bool { mine == true }

    /// the sub-line the web shows under such a row
    var subline: String {
        if isMine {
            if isPrivate { return (shareWith ?? []).isEmpty ? L("Only you") : LF("Only you and %d more", (shareWith ?? []).count) }
            return LF("Others see “%@”", placeholder ?? "")
        }
        if revealed == true { return L("Shown to you because you're shopping") }
        if isPrivate { return owner.map { LF("Shared with you by %@", $0) } ?? L("Private") }
        return L("Discreet")
    }

    var icon: String { isPrivate ? "lock.fill" : "eye.slash.fill" }
}

/// Who sees a new or existing row: all | discreet | private
enum RowVisibility: String, CaseIterable, Identifiable, Sendable {
    case all, discreet, `private`
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return L("Everyone")
        case .discreet: return L("Discreet")
        case .private: return L("Only me")
        }
    }
    var icon: String {
        switch self {
        case .all: return "person.2"
        case .discreet: return "eye.slash"
        case .private: return "lock"
        }
    }
    var explanation: String {
        switch self {
        case .all: return L("Everyone in the household sees it.")
        case .discreet: return L("Everyone sees a neutral placeholder like “Drugstore item”. Only you see the real name.")
        case .private: return L("Only you see it. It never shows up in Home Assistant, displays or printed lists.")
        }
    }
}

/// GET /api/shop/members
struct Member: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var color: String?
    /// member | guest – guests can never be picked for private lists
    var kind: String?
}

/// The parts of GET /api/me this area needs: who I am and whether "who takes care of it" is shown (home.ui.claims).
struct MeLite: Decodable, Sendable {
    var actor: JSONValue?
    var home: JSONValue?
    var userId: Int? { actor?["userId"]?.int }
    var isMember: Bool { actor?["kind"]?.string == "user" }
    /// living alone hides "who takes care of it" (web household.ts); default on
    var claimsOn: Bool { home?["ui"]?["claims"]?.bool ?? true }
}

/// GET /api/buy-at/suggestions
struct BuyAtSuggestions: Decodable, Sendable {
    var own: [String]?
    var common: [String]?
    var used: [String]?

    /// chosen first, then own stores, used, common – without duplicates (case-insensitive)
    func options(chosen: [String]) -> [String] {
        var out: [String] = []
        for s in chosen + (own ?? []) + (used ?? []) + (common ?? []) where !out.contains(where: { $0.caseInsensitiveCompare(s) == .orderedSame }) {
            out.append(s)
        }
        return out
    }
}

// MARK: - shopping: forecast, paste

/// GET /api/fresh/forecast?within=N – estimates only, never changes stock
struct ForecastResponse: Decodable, Sendable {
    var note: String?
    var withinDays: Int?
    @Lossy var items: [ForecastItem]
}

struct ForecastItem: Decodable, Sendable, Identifiable, Hashable {
    var productId: Int
    var name: String
    var brand: String?
    var imagePath: String?
    var qty: Double?
    var unit: String?
    var daysLeft: Double?
    var perWeek: Double?
    var confidence: String?
    var runOutOn: String?
    var onShoppingList: Bool?
    var id: Int { productId }

    var line: String {
        let d = Int((daysLeft ?? 0).rounded())
        let when = d <= 0 ? L("probably empty now") : d == 1 ? L("probably empty tomorrow") : LF("probably empty in %d days", d)
        return confidence == "low" ? when + " · " + L("rough estimate") : when
    }
}

/// POST /api/share/parse → { text, urls, items }
struct SharePreview: Decodable, Sendable {
    var text: String?
    @Lossy var items: [Line]

    struct Line: Decodable, Sendable, Hashable {
        var name: String
        var qty: Double?
        var unit: String?
        var amount: String?
        var product: Linked?
        var confident: Bool?
        var onList: Bool?

        struct Linked: Decodable, Sendable, Hashable {
            var id: Int
            var name: String
            var brand: String?
        }

        var label: String {
            let q: String? = amount ?? qty.map { q in
                let n = q.rounded() == q ? String(Int(q)) : String(q).replacingOccurrences(of: ".", with: ",")
                return unit.map { "\(n) \($0)" } ?? "\(n)×"
            }
            return [q, name].compactMap { $0 }.joined(separator: " ")
        }
    }
}

// MARK: - pantry

/// GET /api/categories
struct ProductCategory: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var icon: String?
    var defaultLocationId: Int?
    var trackMode: String?
}

/// What the product page needs beyond ProductInfo (same GET /api/products/:id body).
struct ProductExtra: Decodable, Sendable {
    var buyAt: JSONValue?
    var kind: String?
    var isStaple: Bool?
    /// the product's own setting (`date_kind`, nil = automatic) – see JSONCoding.splitDateKind
    var dateKind: String?
    /// "Open Food Facts · 4000… · CC BY-SA" when the picture came from there
    var imageCredit: String?

    private enum CodingKeys: String, CodingKey { case buyAt, kind, isStaple, dateKind = "dateKindSetting", imageCredit }

    /// products.buy_at arrives as raw JSON text (web BuyAt.tsx parseBuyAt)
    var stores: [String] {
        if let arr = buyAt?.array { return arr.compactMap(\.string).filter { !$0.isEmpty } }
        guard let s = buyAt?.string, let d = s.data(using: .utf8),
              let v = try? JSONDecoder().decode([String].self, from: d) else { return [] }
        return v.filter { !$0.isEmpty }
    }
}

/// GET /api/fresh/products/:id – batches with opened / frozen state
struct FreshProduct: Decodable, Sendable {
    var productId: Int?
    var kind: String?
    var freezerDays: Int?
    var defaultFreezerDays: Int?
    var hasFreezer: Bool?
    @Lossy var entries: [Entry]
    var canOpen: Bool?
    var canFreeze: Bool?
    var canThaw: Bool?

    struct Entry: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var locationId: Int?
        var qty: Double?
        var bestBefore: String?
        /// estimated from the usual shelf life, not the printed date
        var bbEstimated: Bool?
        var openedAt: String?
        var openedDay: String?
        var frozenAt: String?
        var inFreezer: Bool?
        var useBy: String?
        var useByEstimated: Bool?
    }
}

/// POST /api/fresh/products/:id/open|freeze|thaw answers – dates to show in the toast
struct FreshActionResult: Decodable, Sendable {
    var useBy: String?
    var bestBefore: String?
    var eatBy: String?
    /// the use-by is a rule of thumb (usual days after opening), not a known date
    var estimated: Bool?

    var openedToast: String {
        guard let d = useBy.flatMap({ ServerDate.shortDay($0) }) else { return L("Marked as opened") }
        return estimated == true ? LF("Opened – keeps about until %@", d) : LF("Opened – use by %@", d)
    }
}

/// GET /api/fresh/check – places with what's there and when they were last checked
struct CheckPlace: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var icon: String?
    var items: Int?
    var stale: Int?
    var lastCheck: String?
    var daysSinceCheck: Int?
}

/// GET /api/fresh/check/:locationId
struct CheckStack: Decodable, Sendable {
    var location: CheckPlace
    @Lossy var items: [CheckItem]
}

struct CheckItem: Decodable, Sendable, Identifiable, Hashable {
    var productId: Int
    var name: String
    var brand: String?
    var imagePath: String?
    var unit: String?
    var trackMode: String?
    var kind: String?
    var qty: Double?
    var useBy: String?
    var opened: Bool?
    var confirmedAt: String?
    var daysSinceSeen: Int?
    var id: Int { productId }
    var isLevel: Bool { trackMode == "level" }

    var qtyLabel: String {
        let q = qty ?? 0
        if isLevel {
            switch Int(q.rounded()) {
            case ...0: return L("empty")
            case 1: return L("low")
            case 2: return L("half")
            default: return L("full")
            }
        }
        let n = q.rounded() == q ? String(Int(q)) : String(format: "%.1f", q)
        return [n, unit].compactMap { $0 }.joined(separator: " ")
    }
}

/// GET /api/find?q= – "Wo ist was?"
struct FoundThing: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var brand: String?
    var imagePath: String?
    var spot: String?
    var notes: String?
    var inStock: Bool?
    @Lossy var places: [FoundPlace]

    static func == (a: FoundThing, b: FoundThing) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    struct FoundPlace: Decodable, Sendable, Hashable, Identifiable {
        var id: Int
        var name: String
        var icon: String?
        var hint: String?
    }
}

/// GET /api/fresh/today – the eat-first list with the place of the first batch
struct FreshToday: Decodable, Sendable {
    @Lossy var eatFirst: [EatFirst]

    struct EatFirst: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var kind: String?
        var qty: Double?
        var unit: String?
        var useBy: String?
        var daysLeft: Int?
        var opened: Bool?
        var locationId: Int?
    }
}

/// A labelled container (GET /api/labels/boxes, /api/labels/boxes/:code)
struct LeftoverBox: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var code: String
    var name: String
    var imagePath: String?
    var portions: Double?
    var left: Double?
    /// fridge | freezer
    var place: String?
    var location: String?
    var madeOn: String?
    var eatBy: String?
    var daysLeft: Int?
    /// ok | soon | due | … (server/lib/labels.ts boxState)
    var state: String?
    /// active | eaten | tossed
    var status: String?
    var canUndo: Bool?

    var isActive: Bool { (status ?? "active") == "active" }
    var inFreezer: Bool { place == "freezer" }
    /// "K7PM 3QXA"
    var prettyCode: String { code.count == 8 ? "\(code.prefix(4)) \(code.suffix(4))" : code }

    var portionsLabel: String {
        let l = left ?? 0
        let n = l.rounded() == l ? String(Int(l)) : String(format: "%.1f", l)
        return l == 1 ? L("1 portion") : LF("%@ portions", n)
    }

    static func == (a: LeftoverBox, b: LeftoverBox) -> Bool { a.id == b.id && a.left == b.left && a.status == b.status && a.place == b.place }
    func hash(into h: inout Hasher) { h.combine(id) }
}

/// POST /api/labels/boxes/:code/action → { message, box }
struct BoxActionResult: Decodable, Sendable {
    var message: String?
    var box: LeftoverBox?
}

/// Codes on ToHuus labels: 8 characters from an alphabet without look-alikes (server/lib/labels.ts BOX_CODE_RE),
/// usually inside a URL ".../q/<code>".
enum LabelCode {
    static func extract(_ raw: String) -> String {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let r = s.range(of: "/q/") {
            let tail = s[r.upperBound...]
            return String(tail.prefix { $0 != "?" && $0 != "/" && $0 != "#" })
        }
        return s
    }

    static func isBox(_ code: String) -> Bool {
        let allowed = Set("23456789ABCDEFGHJKMNPQRSTUVWXYZ")
        let up = code.uppercased()
        return up.count == 8 && up.allSatisfy { allowed.contains($0) }
    }
}

// MARK: - product images

/// GET /api/lookup/search – one Open Food Facts / Open Products Facts product (server/lib/off.ts OffProduct)
struct OffHit: Decodable, Sendable, Identifiable, Hashable {
    var code: String
    var name: String
    var brand: String?
    var quantity: String?
    var image: String?
    var imageSmall: String?
    /// the server's own similarity (about 0…1.2); below 0.4 it is mostly something else
    var score: Double?
    var id: String { code }
    var fits: Bool { (score ?? 1) >= 0.4 && (imageSmall ?? image) != nil }
}
