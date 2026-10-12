import Foundation

/// GET /api/shop/list – the list in the store's walking order.
struct ShopList: Codable, Sendable {
    var store: StoreRef?
    @Lossy var stores: [StoreRef]
    var order: [String]?
    @Lossy var sections: [ShopSection]
    @Lossy var basket: [ShopItem]
    @Lossy var done: [ShopItem]
    var open: Int?
    /// several lists (e.g. "Drogerie", "Für Oma"): all lists and the one shown – missing on servers with one list
    @Lossy var lists: [ListRef]
    var list: ListRef?
    /// who is out shopping right now ("Sam kauft gerade ein") and the add-on requests for that trip
    @Lossy var shoppers: [Shopper]
    @Lossy var requests: [AddonRequest]
    /// expected total from known prices
    var estimate: Estimate?

    static let empty = ShopList()

    init(store: StoreRef? = nil, stores: [StoreRef] = [], order: [String]? = nil, sections: [ShopSection] = [], basket: [ShopItem] = [],
         done: [ShopItem] = [], open: Int? = nil) {
        self.store = store
        self.order = order
        self.open = open
        _stores = Lossy(wrappedValue: stores)
        _sections = Lossy(wrappedValue: sections)
        _basket = Lossy(wrappedValue: basket)
        _done = Lossy(wrappedValue: done)
        _lists = Lossy(wrappedValue: [])
        _shoppers = Lossy(wrappedValue: [])
        _requests = Lossy(wrappedValue: [])
    }

    /// Expected total: the server's estimate, else the sum of the prices the rows carry.
    var expected: Estimate? {
        if let estimate, estimate.total != nil { return estimate }
        let items = openItems + basket
        let priced = items.compactMap { i in i.price.map { $0 * (i.qty ?? 1) } }
        guard !priced.isEmpty else { return nil }
        return Estimate(total: priced.reduce(0, +), known: priced.count, count: items.count, currency: nil)
    }

    var openItems: [ShopItem] { sections.flatMap(\.items) }
    var openCount: Int { openItems.count }
}

struct ListRef: Codable, Sendable, Identifiable, Hashable {
    var id: FlexID
    var name: String
    var open: Int?
}

/// A member who is out shopping (live shopping together).
struct Shopper: Codable, Sendable, Identifiable, Hashable {
    var userId: Int?
    var name: String
    var store: String?
    var storeId: Int?
    var since: String?
    var me: Bool?
    var id: String { userId.map(String.init) ?? name }
}

/// "Bringst du noch … mit?" – a wish for someone's current trip.
struct AddonRequest: Codable, Sendable, Identifiable, Hashable {
    var id: Int
    var text: String
    var by: String?
    var to: String?
    /// open | accepted | declined
    var status: String?
    var at: String?
    var isOpen: Bool { status == nil || status == "open" }
}

struct Estimate: Codable, Sendable, Hashable {
    var total: Double?
    /// rows with a known price / all rows
    var known: Int?
    var count: Int?
    var currency: String?
}

struct StoreRef: Codable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var order: [String]?
    var trips: Int?
}

struct ShopSection: Codable, Sendable, Identifiable {
    var key: String
    @Lossy var items: [ShopItem]
    var id: String { key }

    init(key: String, items: [ShopItem]) {
        self.key = key
        _items = Lossy(wrappedValue: items)
    }
}

struct ShopItem: Codable, Sendable, Identifiable, Equatable {
    var id: Int
    var productId: Int?
    var text: String
    var qty: Double?
    var note: String?
    var source: String?
    var addedBy: String?
    var checkedAt: String?
    var checkedBy: String?
    var inBasket: JSONValue?
    var createdAt: String?
    var productName: String?
    var brand: String?
    var imagePath: String?
    var unit: String?
    var inStock: Double?
    var section: String?
    var claim: Claim?
    var buyAt: [String]?
    /// the origin line, already formatted by the server ("Mira · heute 14:05", "merkt sich: alle ~9 Tage")
    var origin: String?
    /// queued locally, not yet on the server
    var pending: Bool?
    /// substitute rule: any | ask | none (and an optional note "lieber Hafermilch")
    var substitute: String?
    var substituteNote: String?
    /// photo of the wanted product (signed image path)
    var photo: String?
    /// last known price per unit (for the expected total)
    var price: Double?

    struct Claim: Codable, Sendable, Equatable {
        var userId: Int?
        var name: String?
        var color: String?
    }

    var isChecked: Bool { checkedAt != nil }
    var isInBasket: Bool { inBasket?.bool ?? false }

    /// "2× Milch" style quantity prefix
    var qtyLabel: String? {
        guard let q = qty, q != 1 else { return nil }
        let n = q.rounded() == q ? String(Int(q)) : String(q).replacingOccurrences(of: ".", with: ",")
        return "\(n)×"
    }

    /// The origin line under each row (product rule: every row shows where it came from).
    var originLine: String {
        if let origin, !origin.isEmpty {
            return pending == true ? origin + " · " + L("not sent yet") : origin
        }
        var parts: [String] = []
        switch source ?? "manual" {
        case "manual": parts.append(addedBy.map { LF("added by %@", $0) } ?? L("added by hand"))
        case "recipe": parts.append(note.map { LF("for “%@”", $0) } ?? L("for a recipe"))
        case "plan", "menu": parts.append(L("from the week plan"))
        case "used-up": parts.append(addedBy.map { LF("used up · %@", $0) } ?? L("used up"))
        case "rhythm", "suggest", "auto", "memory", "merkt": parts.append(L("ToHuus remembers"))
        case "assistant": parts.append(L("via the assistant"))
        case "ha", "integration": parts.append(L("from Home Assistant"))
        case "receipt", "import": parts.append(L("from a receipt"))
        case "care": parts.append(L("from care"))
        case "party": parts.append(L("for the party"))
        case "away": parts.append(L("before the trip"))
        case "leftover": parts.append(L("leftovers"))
        case "vote", "idea", "favorite": parts.append(addedBy.map { LF("wish from %@", $0) } ?? L("a wish"))
        default: parts.append(addedBy ?? (source ?? ""))
        }
        if source == "recipe", let by = addedBy { parts.append(by) }
        if let rel = ServerDate.relative(createdAt) { parts.append(rel) }
        if pending == true { parts.append(L("not sent yet")) }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

enum ShopSectionKey {
    /// the server's aisle keys (server/lib/shopparse.ts SECTIONS)
    static let all = ["produce", "bakery", "chilled", "frozen", "pantry", "snacks", "drinks", "drugstore", "household", "other"]
    static func label(_ key: String) -> String {
        switch key {
        case "produce": return L("Fruit & vegetables")
        case "bakery": return L("Bread & bakery")
        case "chilled": return L("Chilled")
        case "frozen": return L("Frozen")
        case "pantry": return L("Pantry & tins")
        case "snacks": return L("Sweets & snacks")
        case "drinks": return L("Drinks")
        case "drugstore": return L("Drugstore")
        case "household": return L("Household")
        case "elsewhere": return L("Buy elsewhere")
        default: return L("Other")
        }
    }

    static func icon(_ key: String) -> String {
        switch key {
        case "produce": return "carrot"
        case "bakery": return "birthday.cake"
        case "chilled": return "refrigerator"
        case "frozen": return "snowflake"
        case "pantry": return "takeoutbag.and.cup.and.straw"
        case "snacks": return "popcorn"
        case "drinks": return "waterbottle"
        case "drugstore": return "drop"
        case "household": return "house"
        case "elsewhere": return "mappin.and.ellipse"
        default: return "basket"
        }
    }
}

/// POST /api/shop/parse
struct QuickAddPreview: Decodable, Sendable, Hashable {
    var raw: String?
    var name: String
    var qty: Double?
    var unit: String?
    var amount: String?
    var confident: Bool?
    var onList: Bool?
}

/// POST /api/shop/sync
struct SyncResponse: Decodable, Sendable {
    @Lossy var results: [SyncResult]
    struct SyncResult: Decodable, Sendable {
        var opId: String
        var ok: Bool
        var error: String?
    }
}
