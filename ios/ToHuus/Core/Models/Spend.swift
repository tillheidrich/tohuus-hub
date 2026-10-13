import Foundation

// Money in detail ("Geld"): periods, drill-down, budgets, own expenses, left out, price history.
// server/routes/spend2.ts + server/lib/spend2.ts; price history: server/routes/home.ts /spending/prices/:id.

/// GET /api/spend/stats?period=week|month|year|all&date=YYYY-MM-DD[&tag=]
struct SpendStats: Decodable, Sendable {
    var period: String
    var from: String
    var to: String
    var anchor: String?
    var today: String?
    var ongoing: Bool?
    var currency: String?
    /// 0 = Sunday, 1 = Monday (household region)
    var weekStart: Int?
    var total: Double
    var goods: Double?
    var deposit: Double?
    var discounts: Double?
    var receipts: Int?
    var manual: Manual?
    var excluded: Excluded?
    @Lossy var byCategory: [Named]
    @Lossy var byStore: [Store]
    @Lossy var top: [Top]
    /// day | month | year – size of the timeline bars
    var unit: String?
    @Lossy var timeline: [Bucket]
    /// the last 12 periods of the same kind (navigation chart)
    @Lossy var trend: [Bucket]
    var compare: Compare?
    @Lossy var budgets: [BudgetState]
    var waste: Waste?
    var hasData: Bool?

    struct Manual: Decodable, Sendable { var count: Int?; var total: Double? }
    struct Excluded: Decodable, Sendable {
        var total: Double?
        var count: Int?
        @Lossy var byReason: [Named]
    }
    struct Named: Decodable, Sendable, Identifiable, Hashable {
        var name: String
        var total: Double
        var count: Int?
        var id: String { name }
    }
    struct Store: Decodable, Sendable, Identifiable, Hashable {
        var name: String
        var total: Double
        var baskets: Int?
        var avgBasket: Double?
        var id: String { name }
    }
    struct Top: Decodable, Sendable, Identifiable, Hashable {
        var productId: Int?
        var name: String
        var total: Double
        var qty: Double?
        var id: String { "\(productId ?? -1)-\(name)" }
    }
    struct Bucket: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var from: String
        var to: String
        var total: Double
        var excluded: Double?
        var id: String { key }
    }
    struct Compare: Decodable, Sendable {
        var previous: Previous?
        var lastYear: Previous?
        struct Previous: Decodable, Sendable {
            var from: String
            var to: String
            var total: Double
            var toDate: Double?
        }
    }
    struct Waste: Decodable, Sendable { var value: Double?; var count: Int? }
}

/// One budget with its state for the current period (stats.budgets, GET /api/spend/budgets `status`)
struct BudgetState: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var category: String?
    var label: String
    var period: String
    var notify: Bool?
    var from: String?
    var to: String?
    var spent: Double
    var amount: Double
    var pct: Double?
    var remaining: Double?
    var forecast: Double?
    var daysLeft: Int?
    var ongoing: Bool?
    /// ok | near | over
    var state: String?
}

/// GET /api/spend/budgets → { budgets: [row], status }
struct BudgetsResponse: Decodable, Sendable {
    @Lossy var budgets: [BudgetRow]
    struct BudgetRow: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        /// '' = all spending
        var category: String
        var period: String
        var amount: Double
        var notify: FlexID?
        var notifies: Bool { notify.map { $0.value != "0" && $0.value != "false" } ?? true }
    }
}

/// GET /api/spend/meta
struct SpendMeta: Decodable, Sendable {
    var categories: [String] = []
    var tags: [String] = []
    var stores: [String] = []
    var today: String?
    var currency: String?
    /// q-money: categories for own entries (renamable), members (no permanent guests), the viewer, household setting
    var moneyCategories: [String]?
    var members: [MoneyMember]?
    var me: Int?
    var assignedOut: Bool?
}

/// One spending entry: a receipt line or an own expense (server/lib/spend2.ts `Entry`).
struct SpendEntry: Decodable, Sendable, Identifiable, Hashable {
    var key: String
    /// line | expense
    var kind: String
    var id: Int
    var receiptId: Int?
    var day: String
    var store: String
    var name: String
    var productId: Int?
    var category: String
    var categoryOriginal: String?
    var categoryChanged: Bool?
    var qty: Double?
    var unit: String?
    var price: Double
    var deposit: Bool?
    var tags: [String] = []
    var note: String?
    var excluded: Exclusion?
    /// q-money: a receipt line for one person, personal entries, who paid, attachment, line items, "your part"
    var forUserId: Int?
    var forName: String?
    var personal: Personal?
    var paidBy: Int?
    var hasAttachment = false
    var items: [ExpenseItem] = []
    var part = false

    struct Exclusion: Decodable, Sendable, Hashable {
        var id: Int
        var scope: String
        var reason: String?
    }

    var isExpense: Bool { kind == "expense" }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        key = try c.decode(String.self, forKey: AnyKey("key"))
        kind = c.first(String.self, "kind") ?? "line"
        id = try c.decode(Int.self, forKey: AnyKey("id"))
        receiptId = c.first(Int.self, "receiptId")
        day = c.first(String.self, "day") ?? ""
        store = c.first(String.self, "store") ?? ""
        name = c.first(String.self, "name") ?? ""
        productId = c.first(Int.self, "productId")
        category = c.first(String.self, "category") ?? ""
        categoryOriginal = c.first(String.self, "categoryOriginal")
        categoryChanged = c.first(Bool.self, "categoryChanged")
        qty = c.first(Double.self, "qty")
        unit = c.first(String.self, "unit")
        price = c.first(Double.self, "price") ?? 0
        deposit = c.first(Bool.self, "deposit")
        tags = c.first([String].self, "tags") ?? []
        note = c.first(String.self, "note")
        excluded = c.first(Exclusion.self, "excluded")
        forUserId = c.first(Int.self, "forUserId")
        forName = c.first(String.self, "forName")
        personal = c.first(Personal.self, "personal")
        paidBy = c.first(Int.self, "paidBy")
        hasAttachment = c.first(JSONValue.self, "attachment").map { !$0.isNull } ?? false
        items = c.first([ExpenseItem].self, "items") ?? []
        part = c.first(Bool.self, "part") ?? false
    }
}

/// GET /api/spend/entries → { from, to, entries, truncated }
struct SpendEntries: Decodable, Sendable {
    var from: String?
    var to: String?
    @Lossy var entries: [SpendEntry]
    var truncated: Bool?
}

/// GET /api/spend/receipts/:id
struct SpendReceipt: Decodable, Sendable {
    var id: Int
    var title: String?
    var store: String?
    var day: String?
    var total: Double?
    var counted: Double?
    var excludedTotal: Double?
    var discounts: Double?
    var tags: [String] = []
    var exclusion: SpendEntry.Exclusion?
    @Lossy var entries: [SpendEntry]
    var paidBy: Int?
    var actor: String?
    var personal: Personal?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = try c.decode(Int.self, forKey: AnyKey("id"))
        title = c.first(String.self, "title")
        store = c.first(String.self, "store")
        day = c.first(String.self, "day")
        total = c.first(Double.self, "total")
        counted = c.first(Double.self, "counted")
        excludedTotal = c.first(Double.self, "excludedTotal")
        discounts = c.first(Double.self, "discounts")
        tags = c.first([String].self, "tags") ?? []
        exclusion = c.first(SpendEntry.Exclusion.self, "exclusion")
        paidBy = c.first(Int.self, "paidBy")
        actor = c.first(String.self, "actor")
        personal = c.first(Personal.self, "personal")
        _entries = (try? c.decode(Lossy<SpendEntry>.self, forKey: AnyKey("entries"))) ?? Lossy(wrappedValue: [])
    }
}

/// GET /api/spend/exclusions – what is left out, with a readable label and how much it keeps out
struct SpendExclusion: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    /// line | receipt | product | category | store | expense
    var scope: String
    var ref: FlexID?
    var label: String?
    var reason: String?
    var total: Double?
    var count: Int?

    static func scopeName(_ s: String) -> String {
        switch s {
        case "line": return L("Item")
        case "receipt": return L("Receipt")
        case "product": return L("Product")
        case "category": return L("Category")
        case "store": return L("Store")
        default: return L("Own expense")
        }
    }
}

/// GET /api/spending/prices/:productId
struct PriceHistory: Decodable, Sendable {
    var product: Product?
    var currency: String?
    @Lossy var points: [Point]
    var change: Change?
    var spentTotal: Double?

    struct Product: Decodable, Sendable { var id: Int; var name: String; var brand: String?; var imagePath: String? }
    struct Point: Decodable, Sendable, Hashable, Identifiable {
        var date: String
        var unitPrice: Double
        var shop: String?
        var id: String { date + (shop ?? "") + String(unitPrice) }
    }
    struct Change: Decodable, Sendable {
        var from: Double
        var to: Double
        var fromDate: String?
        var toDate: String?
        var pct: Double
        /// up | down | same
        var direction: String
    }
}

/// GET /api/spending/products – products with price data (price history picker)
struct PricedProduct: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var brand: String?
    var imagePath: String?
    var purchases: Int?
}
