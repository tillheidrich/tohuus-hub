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
    /// several lists (`GET /api/shop/list?list=<id>`, 0 = main): all lists and the one shown
    @Lossy var lists: [ListRef]
    var listId: FlexID?
    /// expected total from the latest receipt prices
    var estimate: Estimate?
    var serverTime: String?

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
    }

    /// Expected total: the server's estimate, else the last receipt prices the rows carry.
    var expected: Estimate? {
        if let estimate, (estimate.total ?? 0) > 0 { return estimate }
        let items = openItems
        let priced = items.compactMap { i in i.lastBought?.price.map { $0 * (i.qty ?? 1) } }
        guard !priced.isEmpty else { return nil }
        return Estimate(total: priced.reduce(0, +), priced: priced.count, unpriced: items.count - priced.count)
    }

    /// the list shown, from `lists`
    var currentList: ListRef? {
        let id = listId?.value ?? "0"
        return lists.first { $0.id.value == id }
    }

    var openItems: [ShopItem] { sections.flatMap(\.items) }
    var openCount: Int { openItems.count }
}

/// `GET /api/list/lists` – id 0 = the main list; kind main|store|gifts|care|other
struct ListRef: Codable, Sendable, Identifiable, Hashable {
    var id: FlexID
    var name: String
    var kind: String?
    var note: String?
    var open: Int?
    /// private lists (13 Oct 2026): household | private | people
    var visibility: String?
    var owner: String?
    var shareWith: [Int]?
    var mine: Bool?
    var isMain: Bool { id.value == "0" || kind == "main" }
    var isPrivate: Bool { (visibility ?? "household") != "household" }
}

/// `GET /api/shop/trips` – someone is out shopping (trips start by themselves from ticks in a shop).
struct Trip: Codable, Sendable, Identifiable, Hashable {
    var id: Int
    var user: Person
    var store: StoreRef?
    var startedAt: String?
    var lastAt: String?
    var mine: Bool?
    @Lossy var basket: [Row]
    @Lossy var addOns: [AddOn]

    struct Person: Codable, Sendable, Hashable {
        var id: Int?
        var name: String
        var color: String?
    }

    struct Row: Codable, Sendable, Hashable, Identifiable {
        var id: Int
        var text: String
        var qty: Double?
    }

    /// "Bringst du noch … mit?" – a list row on that trip; `id` is the `request_id` for addon-accept/-decline
    struct AddOn: Codable, Sendable, Hashable, Identifiable {
        var id: Int
        var text: String
        var from: String?
        var done: Bool?
    }

    static func == (a: Trip, b: Trip) -> Bool { a.id == b.id && a.lastAt == b.lastAt && a.addOns == b.addOns }
    func hash(into h: inout Hasher) { h.combine(id) }

    var isMine: Bool { mine == true }
    var openAddOns: [AddOn] { addOns.filter { $0.done != true } }
}

/// `GET /api/list/estimate` / `estimate` in the list: latest receipt price × qty, unpriced rows counted, never guessed.
struct Estimate: Codable, Sendable, Hashable {
    var total: Double?
    var priced: Int?
    var unpriced: Int?
    var unpricedNames: [String]?
    var since: String?
    var currency: String?

    init(total: Double?, priced: Int?, unpriced: Int?) {
        self.total = total
        self.priced = priced
        self.unpriced = unpriced
    }
}

/// `last_bought` on a list row (from receipts)
struct LastBought: Codable, Sendable, Hashable {
    var name: String?
    var size: String?
    var imagePath: String?
    var shop: String?
    var day: String?
    var price: Double?
}

struct StoreRef: Codable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var order: [String]?
    var trips: Int?
    /// coordinates a person entered (for the store-arrival hint on the phone)
    var lat: Double?
    var lon: Double?
    var radiusM: Double?
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
    /// substitute rule: exact ("genau dieses") | ok ("Ersatz ok") | ask ("vorher fragen")
    var substitute: String?
    /// photo of the wanted product (signed image path)
    var photoPath: String?
    var lastBought: LastBought?
    var listId: Int?
    /// "Spinat 3× weggeworfen – lieber 250 g?", "am günstigsten bei Aldi: 1,99 €"
    var sizeHint: String?
    var priceHint: String?
    /// discreet / private entry (area: share) – see ShareInfo
    var share: ShareInfo?
    /// WG: the row is for one person ("für Mika"), nil = shared (POST /api/list/items/:id/owner)
    var owner: ShopRowOwner?
    /// counts toward the weekly extras allowance (server: lib/extras.ts)
    var extra: Bool?

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

/// `owner` on a list row (WG): the row is for one person ("für Mika"); nil = shared
struct ShopRowOwner: Codable, Sendable, Hashable {
    var id: Int?
    var name: String?
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
