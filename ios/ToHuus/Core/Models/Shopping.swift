import Foundation

/// GET /api/shop/list – the list in the store's walking order.
struct ShopList: Decodable, Sendable {
    var store: StoreRef?
    @Lossy var stores: [StoreRef]
    var order: [String]?
    @Lossy var sections: [ShopSection]
    @Lossy var basket: [ShopItem]
    @Lossy var done: [ShopItem]
    var open: Int?

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
    }

    var openItems: [ShopItem] { sections.flatMap(\.items) }
    var openCount: Int { openItems.count }
}

struct StoreRef: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var order: [String]?
    var trips: Int?
}

struct ShopSection: Decodable, Sendable, Identifiable {
    var key: String
    @Lossy var items: [ShopItem]
    var id: String { key }

    init(key: String, items: [ShopItem]) {
        self.key = key
        _items = Lossy(wrappedValue: items)
    }
}

struct ShopItem: Decodable, Sendable, Identifiable, Equatable {
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
    /// the origin line, already formatted by the server ("Lea · heute 14:05", "merkt sich: alle ~9 Tage")
    var origin: String?
    /// queued locally, not yet on the server
    var pending: Bool?

    struct Claim: Decodable, Sendable, Equatable {
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
