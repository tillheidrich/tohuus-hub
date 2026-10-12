import Foundation

/// GET /api/today – one aggregate for the "Heute" screen.
struct TodayPayload: Decodable, Sendable {
    var greeting: String?
    var household: JSONValue?
    @Lossy var rhythm: [RhythmItem]
    var list: TodayList?
    @Lossy var stillHave: [StillHaveItem]
    var cookToday: CookToday?
    var money: TodayMoney?
    @Lossy var notices: [Notice]

    var householdName: String? { household?.string ?? household?["name"]?.string }

    struct TodayList: Decodable, Sendable {
        var open: Int?
        @Lossy var recent: [RecentChange]
    }

    struct RecentChange: Decodable, Sendable, Identifiable {
        var id: FlexID?
        var text: String?
        var name: String?
        var qty: Double?
        var checked: Bool?
        var origin: String?
        var at: String?
        var stableId: String { id?.value ?? "\(title)-\(at ?? "")" }
        var title: String {
            let n = text ?? name ?? ""
            guard let q = qty, q != 1 else { return n }
            return (q.rounded() == q ? "\(Int(q))× " : "\(q)× ") + n
        }
    }

    struct CookToday: Decodable, Sendable {
        /// planned | ready | almost
        var kind: String?
        var recipeId: Int?
        var planId: Int?
        var title: String?
        var image: String?
        var timeMin: Double?
        @Lossy var missing: [NameItem]
        var probablyHave: [String]?
        var usesExpiring: [String]?
        var why: [String]?
    }

    struct TodayMoney: Decodable, Sendable {
        var currency: String?
        var week: Double?
        var month: Double?
        /// { amount, spent, left, state } (a plain number is accepted too)
        var budget: JSONValue?

        var budgetAmount: Double? { budget?.double ?? budget?["amount"]?.double }
        var budgetLeft: Double? { budget?["left"]?.double }
        var budgetState: String? { budget?["state"]?.string }
    }
}

/// Purchase rhythm (GET /api/rhythm, and the "due" part of /api/today).
struct RhythmItem: Decodable, Sendable, Identifiable, Hashable {
    var productId: Int
    var name: String
    var image: String?
    var everyDays: Double?
    var spread: Double?
    var lastBought: String?
    var dueOn: String?
    /// negative = overdue
    var dueInDays: Int?
    var confidence: String?
    var origin: String?
    var suggested: Bool?
    var onList: Bool?
    var muted: Bool?
    var count: Int?
    /// "alle ~5 Tage · zuletzt Mittwoch" – already in the household language
    var label: String?

    var id: Int { productId }

    var detail: String {
        if let label, !label.isEmpty { return label }
        var parts: [String] = []
        if let d = everyDays, d > 0 { parts.append(LF("about every %d days", Int(d.rounded()))) }
        if let last = ServerDate.relative(lastBought) { parts.append(LF("last bought %@", last)) }
        switch origin {
        case "receipts": parts.append(L("from your receipts"))
        case "ticks": parts.append(L("from your ticks"))
        case "both": parts.append(L("from receipts and ticks"))
        default: break
        }
        return parts.joined(separator: " · ")
    }
}

/// "Das habt ihr noch" – things at home that should be used soon.
struct StillHaveItem: Decodable, Sendable, Identifiable, Hashable {
    var name: String
    var productId: Int?
    var date: String?
    var qty: Double?
    var place: String?
    /// expiring | leftover | probably
    var kind: String?
    var daysLeft: Int?
    /// "noch 1 Tag", "bald essen", "gekauft am Dienstag" – in the household language
    var label: String?
    var image: String?
    var id: String { "\(productId ?? 0)-\(name)" }

    init(from decoder: Decoder) throws {
        if let s = try? decoder.singleValueContainer().decode(String.self) {
            name = s
            return
        }
        let c = try decoder.container(keyedBy: AnyKey.self)
        guard let n = c.first(String.self, "name", "text", "title") else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no name"))
        }
        name = n
        productId = c.first(Int.self, "productId", "id")
        date = c.first(String.self, "useBy", "date", "expires", "expiresOn", "bestBefore", "nextExpiry", "until")
        qty = c.first(Double.self, "qty", "total", "amount")
        place = c.first(String.self, "place", "location", "where")
        kind = c.first(String.self, "kind")
        daysLeft = c.first(Int.self, "daysLeft")
        label = c.first(String.self, "label")
        image = c.first(String.self, "image", "imagePath")
    }
}

/// Notices on the Heute screen (strings or { text, kind }).
struct Notice: Decodable, Sendable, Identifiable, Hashable {
    var text: String
    var kind: String?
    var id: String { text }

    init(from decoder: Decoder) throws {
        if let s = try? decoder.singleValueContainer().decode(String.self) {
            text = s
            return
        }
        let c = try decoder.container(keyedBy: AnyKey.self)
        guard let t = c.first(String.self, "text", "message", "title", "summary") else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no text"))
        }
        text = t
        kind = c.first(String.self, "kind", "type", "level")
    }
}

// MARK: - Products & stock

struct ProductInfo: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var brand: String?
    var size: String?
    var categoryId: Int?
    var unit: String?
    var trackMode: String?
    var defaultLocationId: Int?
    var minQty: Double?
    var imagePath: String?
    var spot: String?
    var notes: String?
    @Lossy var stock: [StockEntry]
    var total: Double?
    var status: String?
    var nextExpiry: String?
    var dateKind: String?
    var perWeek: Double?
    @Lossy var history: [Movement]

    static func == (a: ProductInfo, b: ProductInfo) -> Bool { a.id == b.id && a.total == b.total && a.status == b.status && a.name == b.name }
    func hash(into h: inout Hasher) { h.combine(id) }

    var isLevel: Bool { trackMode == "level" }
    var isTracked: Bool { trackMode != "none" && status != "untracked" }

    /// "2 Stück", "halb voll", …
    var amountLabel: String {
        let t = total ?? 0
        if isLevel {
            switch Int(t.rounded()) {
            case ...0: return L("empty")
            case 1: return L("low")
            case 2: return L("half")
            default: return L("full")
            }
        }
        if !isTracked { return L("not counted") }
        let n = t.rounded() == t ? String(Int(t)) : String(format: "%.1f", t)
        return [n, unit].compactMap { $0 }.joined(separator: " ")
    }

    var statusLabel: String? {
        switch status {
        case "low": return L("running low")
        case "empty": return L("out")
        case "expiring": return L("use soon")
        case "expired": return dateKind == "use_by" ? L("don't eat anymore") : L("check it")
        default: return nil
        }
    }

    struct StockEntry: Decodable, Sendable, Hashable, Identifiable {
        var id: Int
        var locationId: Int?
        var qty: Double?
        var bestBefore: String?
        var openedAt: String?
    }

    struct Movement: Decodable, Sendable, Hashable, Identifiable {
        var id: Int
        var delta: Double?
        var reason: String?
        var actor: String?
        var createdAt: String?
    }
}

struct Place: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var icon: String?
    var kind: String?
    var productCount: Int?
    var depth: Int?
    var path: String?
    var system: Bool?
}

/// GET /api/lookup/barcode/:code
struct BarcodeLookup: Decodable, Sendable {
    var local: ProductInfo?
    var remote: JSONValue?

    var remoteName: String? { remote?.first("name", "productName", "title")?.string }
    var remoteBrand: String? { remote?.first("brand", "brands")?.string }
    var remoteImage: String? { remote?.first("imageUrl", "image")?.string }
}

struct StockAdjustResult: Decodable, Sendable {
    var ok: Bool?
}

// MARK: - Recipes, cooking, plan

struct Recipe: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var title: String
    var description: String?
    var imagePath: String?
    var servings: Double?
    var timeMin: Double?
    var favorite: JSONValue?
    var sourceUrl: String?
    @Lossy var steps: [Step]
    @Lossy var ingredients: [Ingredient]

    static func == (a: Recipe, b: Recipe) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    struct Step: Decodable, Sendable, Hashable {
        var text: String
        init(from decoder: Decoder) throws {
            if let s = try? decoder.singleValueContainer().decode(String.self) { text = s; return }
            let c = try decoder.container(keyedBy: AnyKey.self)
            text = c.first(String.self, "text") ?? ""
        }
    }

    struct Ingredient: Decodable, Sendable, Hashable, Identifiable {
        var id: Int?
        var text: String
        var qty: Double?
        var unit: String?
        var productId: Int?
        var optional: JSONValue?
        var pantry: JSONValue?
        var stableId: String { "\(id ?? 0)-\(text)" }
    }
}

/// GET /api/recipes/:id/match – per ingredient: is it at home?
struct IngredientMatch: Decodable, Sendable, Identifiable {
    var ingredientId: Int?
    var text: String
    var pantry: JSONValue?
    var product: MatchedProduct?
    var id: String { "\(ingredientId ?? 0)-\(text)" }

    struct MatchedProduct: Decodable, Sendable {
        var id: Int
        var name: String?
        var total: Double?
        var trackMode: String?
    }

    var atHome: Bool {
        if pantry?.bool == true { return true }
        guard let p = product else { return false }
        if p.trackMode == "none" { return true }
        return (p.total ?? 0) > 0
    }
}

/// A cook idea, decoded from /api/cook/ideas or from a /api/recipes/suggest suggestion.
struct CookIdea: Decodable, Sendable, Identifiable, Hashable {
    var recipeId: Int
    var title: String
    var image: String?
    var missing: [NameItem]
    var have: Int?
    var need: Int?
    var timeMin: Double?
    var reasons: [String]
    var probablyHave: [String] = []
    var id: Int { recipeId }

    init(recipeId: Int, title: String, image: String? = nil, missing: [NameItem] = [], have: Int? = nil, need: Int? = nil,
         timeMin: Double? = nil, reasons: [String] = []) {
        self.recipeId = recipeId
        self.title = title
        self.image = image
        self.missing = missing
        self.have = have
        self.need = need
        self.timeMin = timeMin
        self.reasons = reasons
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        let nested = try? c.nestedContainer(keyedBy: AnyKey.self, forKey: AnyKey("recipe"))
        guard let rid = c.first(Int.self, "recipeId", "id") ?? nested?.first(Int.self, "id"),
              let t = c.first(String.self, "title", "name") ?? nested?.first(String.self, "title")
        else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no recipe")) }
        recipeId = rid
        title = t
        image = c.first(String.self, "image", "imagePath", "imageUrl") ?? nested?.first(String.self, "imagePath", "image")
        missing = (try? c.decode(Lossy<NameItem>.self, forKey: AnyKey("missing")).wrappedValue) ?? []
        if missing.isEmpty, let items = c.first([NameItem].self, "missingItems") { missing = items }
        have = c.first(Int.self, "have")
        need = c.first(Int.self, "need")
        timeMin = c.first(Double.self, "timeMin") ?? nested?.first(Double.self, "timeMin")
        reasons = c.first([String].self, "why", "reasons") ?? []
        probablyHave = c.first([String].self, "probablyHave") ?? []
    }

    static func == (a: CookIdea, b: CookIdea) -> Bool { a.recipeId == b.recipeId }
    func hash(into h: inout Hasher) { h.combine(recipeId) }
}

/// GET /api/cook/ideas → { ready, almost, probablyAtHome } (an array or { ideas } is accepted too)
struct CookIdeasResponse: Decodable, Sendable {
    var ideas: [CookIdea]
    var probablyAtHome: [String] = []
    init(ideas: [CookIdea]) { self.ideas = ideas }
    init(from decoder: Decoder) throws {
        if (try? decoder.unkeyedContainer()) != nil {
            ideas = (try? Lossy<CookIdea>(from: decoder).wrappedValue) ?? []
            return
        }
        let c = try decoder.container(keyedBy: AnyKey.self)
        probablyAtHome = c.first([String].self, "probablyAtHome") ?? []
        if c.contains(AnyKey("ready")) || c.contains(AnyKey("almost")) {
            let ready = (try? c.decode(Lossy<CookIdea>.self, forKey: AnyKey("ready")).wrappedValue) ?? []
            let almost = (try? c.decode(Lossy<CookIdea>.self, forKey: AnyKey("almost")).wrappedValue) ?? []
            ideas = ready + almost
            return
        }
        for key in ["ideas", "items", "recipes"] {
            if let v = try? c.decode(Lossy<CookIdea>.self, forKey: AnyKey(key)), !v.wrappedValue.isEmpty {
                ideas = v.wrappedValue
                return
            }
        }
        ideas = []
    }
}

struct PlanResponse: Decodable, Sendable {
    var days: [String]
    @Lossy var entries: [PlanEntry]
}

struct PlanEntry: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var day: String
    var slot: String?
    var recipeId: Int?
    var title: String
    var note: String?
    var cooked: JSONValue?
    var imagePath: String?

    var isCooked: Bool { cooked?.bool ?? false }
}

struct RecipeShoppingResult: Decodable, Sendable {
    var added: Int?
    var missing: [String]?
}

// MARK: - Money

/// GET /api/money/overview?month=YYYY-MM – parsed leniently (arrays of objects or name → amount maps).
struct MoneyOverview: Decodable, Sendable {
    var month: String?
    var total: Double?
    var budget: Double?
    var byCategory: [Amount] = []
    var byShop: [Amount] = []
    var byWeek: [Amount] = []
    var vsLastMonth: Double?
    var lastMonthTotal: Double?
    var priceChanges: [PriceChange] = []
    var hints: [Notice] = []
    var currency: String?
    var budgetLeft: Double?
    var budgetState: String?
    var historyLimited = false

    struct Amount: Sendable, Identifiable, Hashable {
        var label: String
        var value: Double
        var id: String { label }
    }

    struct PriceChange: Decodable, Sendable, Identifiable, Hashable {
        var name: String
        var before: Double?
        var after: Double?
        var pct: Double?
        var shop: String?
        var id: String { name + (shop ?? "") }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            guard let n = c.first(String.self, "name", "product", "text", "title") else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no name"))
            }
            name = n
            before = c.first(Double.self, "before", "from", "old", "was", "previous", "prev")
            after = c.first(Double.self, "after", "to", "now", "new", "current", "price")
            pct = c.first(Double.self, "pct", "percent", "changePct", "change", "deltaPct")
            shop = c.first(String.self, "shop", "store") ?? c.first([String].self, "shops")?.joined(separator: ", ")
            if pct == nil, let b = before, let a = after, b > 0 { pct = (a - b) / b * 100 }
        }
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        month = c.first(String.self, "month")
        total = c.first(Double.self, "total", "spent", "sum")
        budget = c.first(Double.self, "budget")
        if budget == nil, let b = c.first(JSONValue.self, "budget") {
            budget = b.first("amount", "limit", "value")?.double
            budgetLeft = b["left"]?.double
            budgetState = b["state"]?.string
        }
        historyLimited = c.first(Bool.self, "historyLimited") ?? false
        currency = c.first(String.self, "currency")
        byCategory = Self.amounts(c.first(JSONValue.self, "byCategory", "categories"))
        byShop = Self.amounts(c.first(JSONValue.self, "byShop", "shops", "byStore", "stores"))
        byWeek = Self.amounts(c.first(JSONValue.self, "byWeek", "weeks", "weekly"))
        if let v = c.first(JSONValue.self, "vsLastMonth") {
            if let d = v.double, v.object == nil { vsLastMonth = d }
            else {
                vsLastMonth = v.first("pct", "percent", "diffPct", "changePct")?.double
                lastMonthTotal = v.first("total", "last", "previous", "lastMonth")?.double
                if vsLastMonth == nil, let last = lastMonthTotal, last > 0, let t = total { vsLastMonth = (t - last) / last * 100 }
            }
        }
        priceChanges = (try? c.decode(Lossy<PriceChange>.self, forKey: AnyKey("priceChanges")).wrappedValue) ?? []
        hints = (try? c.decode(Lossy<Notice>.self, forKey: AnyKey("hints")).wrappedValue) ?? []
    }

    static func amounts(_ v: JSONValue?) -> [Amount] {
        guard let v else { return [] }
        if let arr = v.array {
            return arr.compactMap { e in
                guard let label = e.first("label", "name", "category", "shop", "store", "week", "key", "from", "start")?.string else { return nil }
                guard let value = e.first("total", "amount", "sum", "value", "spent")?.double else { return nil }
                return Amount(label: label, value: value)
            }
        }
        if let obj = v.object {
            return obj.compactMap { k, val in val.double.map { Amount(label: k, value: $0) } }.sorted { $0.value > $1.value }
        }
        return []
    }
}

// MARK: - Assistant & imports

struct ChatResponse: Decodable, Sendable {
    var conversationId: FlexID?
    var reply: String?
    @Lossy var actions: [AssistantAction]
    /// voice: what was understood
    var text: String?
    var transcript: String?
    /// ai | basic
    var mode: String?
    /// assistant messages left this month (nil = unlimited)
    var remaining: Int?
    /// Plus fair use: answered, but shorter
    var throttled: Bool?
}

struct AssistantAction: Decodable, Sendable, Identifiable, Hashable {
    var kind: String?
    var summary: String?
    /// undo token (32 hex), valid 24 hours for the person who caused the action
    var undo: String?
    var id: String { (kind ?? "") + (summary ?? "") }
}

struct ImportUploadResponse: Decodable, Sendable {
    @Lossy var results: [ImportResult]
    init(results: [ImportResult]) { _results = Lossy(wrappedValue: results) }
}

struct ImportResult: Decodable, Sendable, Identifiable, Hashable {
    var file: String?
    var id: Int?
    var error: String?
    var title: String?
    var duplicate: Bool?
    var lines: JSONValue?

    var stableId: String { "\(id ?? 0)-\(file ?? "")-\(error ?? "")" }
}

struct OkResponse: Decodable, Sendable {
    var ok: Bool?
}

/// Any payload we don't need to read.
struct Ignored: Decodable, Sendable {
    init(from decoder: Decoder) throws {}
    init() {}
}
