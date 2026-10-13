import Foundation

// Geld wave 2 (q-money): own entries with photo/PDF and line items, personal entries, money lists.
// Server: server/routes/spend2.ts, server/routes/money-lists.ts – docs/money.md. Decoded with convertFromSnakeCase.

struct MoneyMember: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
}

/// Personal entry or receipt: only this person (and who marked it) sees it.
struct Personal: Decodable, Sendable, Hashable {
    var forUserId: Int
    var forName: String?
    var byUserId: Int?
}

/// One line item of an own expense; `forUserId` = belongs to that person.
struct ExpenseItem: Codable, Sendable, Hashable {
    var name: String
    var qty: Double?
    var price: Double
    var forUserId: Int?
    var forName: String?
}

/// GET /api/spend/expenses/:id
struct ExpenseDetail: Decodable, Sendable {
    var id: Int
    var day: String
    var amount: Double
    var store: String?
    var category: String?
    var note: String?
    var privateFor: Int?
    var paidBy: Int?
    var attachment: Attachment?
    var items: [ExpenseItem] = []
    var tags: [String] = []

    struct Attachment: Decodable, Sendable, Hashable { var type: String }
}

/// POST /api/spend/files → token for the expense + what could be read
struct SpendFileUpload: Decodable, Sendable {
    var token: String
    var type: String
    var draft: Draft?

    struct Draft: Decodable, Sendable {
        var day: String?
        var amount: Double?
        var store: String?
        var items: [ExpenseItem] = []
        var via: String?
        var note: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            day = c.first(String.self, "day")
            amount = c.first(Double.self, "amount")
            store = c.first(String.self, "store")
            items = c.first([ExpenseItem].self, "items") ?? []
            via = c.first(String.self, "via")
            note = c.first(String.self, "note")
        }
    }
}

// MARK: - money lists

/// GET /api/money/lists
struct MoneyListSummary: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var title: String
    var mode: String
    var visibility: String
    var mine: Bool?
    var total: Double
    var people: Int
    var perPerson: Double?
    var openTransfers: Int?
    var settled: Bool?
}

/// GET /api/money/lists/:id (every write answers the same shape)
struct MoneyList: Decodable, Sendable, Identifiable {
    var id: Int
    var title: String
    var note: String?
    /// equal | items
    var mode: String
    /// household | private
    var visibility: String
    var shareWith: [Int] = []
    var mine: Bool?
    var settledAt: String?
    var people: [Person] = []
    var items: [Item] = []
    var payments: [Payment] = []
    var split: Split
    var shareText: String

    struct Person: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var userId: Int?
        var name: String
    }
    struct Item: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var amount: Double
        var qty: Double?
        var paidBy: Int?
        var forPerson: Int?
    }
    struct Payment: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var from: Int
        var to: Int
        var amount: Double
    }
    struct Split: Decodable, Sendable {
        var total: Double
        var unpaid: Double
        var perPerson: Double?
        var people: [SplitPerson] = []
        var transfers: [Transfer] = []
        var settled: Bool
    }
    struct SplitPerson: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var paid: Double
        var share: Double
        var balance: Double
    }
    struct Transfer: Decodable, Sendable, Hashable, Identifiable {
        var from: Int
        var fromName: String
        var to: Int
        var toName: String
        var amount: Double
        var id: String { "\(from)-\(to)" }
    }
}

/// GET /api/money/sources
struct MoneySources: Decodable, Sendable {
    var lists: [ShoppingSource] = []
    var trips: [TripSource] = []
    var receipts: [ReceiptSource] = []

    struct ShoppingSource: Decodable, Sendable, Identifiable, Hashable { var id: Int; var name: String; var items: Int }
    struct TripSource: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var user: MoneyMember
        var store: String?
        var startedAt: String
    }
    struct ReceiptSource: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var store: String
        var total: Double?
        var day: String
    }
}

/// A person on a money list (PUT …/people, POST /api/money/lists `people`): a member, or just a name.
struct MoneyPersonInput: Sendable, Hashable {
    var id: Int?
    var userId: Int?
    var name: String?

    var json: [String: Any] {
        var b: [String: Any] = [:]
        if let id { b["id"] = id }
        if let userId { b["user_id"] = userId }
        if let name { b["name"] = name }
        return b
    }
}

/// What a money list is made from (POST /api/money/lists `from`).
enum MoneySource: Hashable, Sendable {
    case shopping(listId: Int)
    case trip(Int)
    case receipt(Int)
    case entries([String])

    var json: [String: Any] {
        switch self {
        case .shopping(let id): return ["kind": "shopping", "list_id": id]
        case .trip(let id): return ["kind": "trip", "trip_id": id]
        case .receipt(let id): return ["kind": "receipt", "import_id": id]
        case .entries(let keys): return ["kind": "entries", "keys": keys]
        }
    }
}
