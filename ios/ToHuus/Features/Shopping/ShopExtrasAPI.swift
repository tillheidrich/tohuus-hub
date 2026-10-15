import Foundation

// Shopping parity (14 Oct 2026): the endpoints the web list uses that the app did not call yet.
// Same routes as web/src/shop/{forms,bridges,offers,fill}.tsx and web/src/pages/Share.tsx (start mode).

/// GET /api/list/lunchbox → { enabled, items, weekday (0 = Sunday), pausedUntil, lastWeek, due: { items, week } | null }
struct Lunchbox: Decodable, Sendable, Equatable {
    var enabled: Bool?
    var items: [String]?
    var weekday: Int?
    var pausedUntil: String?
    var due: Due?

    struct Due: Decodable, Sendable, Equatable {
        var items: [String]?
        var week: String?
    }
}

/// GET /api/care/:listId/check → { list: { id, name, note }, items: [{ text, times, onList }] }
struct CareCheck: Decodable, Sendable {
    var list: Info?
    @Lossy var items: [Item]

    struct Info: Decodable, Sendable {
        var id: Int?
        var name: String?
        var note: String?
    }

    struct Item: Decodable, Sendable, Hashable, Identifiable {
        var text: String
        var times: Int?
        var onList: Bool?
        var id: String { text }
    }
}

/// GET /api/care/:listId/spent → { month, total, lines }
struct CareSpent: Decodable, Sendable {
    var total: Double?
    var lines: Int?
}

/// GET /api/wg/balance?month=YYYY-MM → who paid what for the shared household, and who gives whom how much.
struct WgBalance: Decodable, Sendable {
    var month: String?
    @Lossy var people: [Person]
    var shared: Double?
    var withoutPayer: Double?
    @Lossy var settle: [Settle]

    struct Person: Decodable, Sendable, Identifiable {
        var userId: Int
        var name: String
        var paid: Double?
        var share: Double?
        var balance: Double?
        var id: Int { userId }
    }

    struct Settle: Decodable, Sendable, Hashable {
        var from: String
        var to: String
        var amount: Double
    }
}

/// POST /api/list/import with dry_run → { format, items: [{ name, qty, note }], skippedChecked }
struct ListImportPreview: Decodable, Sendable {
    var format: String?
    @Lossy var items: [Row]
    var skippedChecked: Int?
    /// without dry_run
    var added: Int?
    var already: Int?

    struct Row: Decodable, Sendable, Hashable {
        var name: String
        var qty: Double?
        var note: String?
    }
}

/// GET /api/share/start-mode → { mode: full | staples, staples, products }
struct StartModeInfo: Decodable, Sendable {
    var mode: String?
    var staples: Int?
    var products: Int?
    var isStaples: Bool { mode == "staples" }
}

/// GET /api/share/staples – the "what runs out at your place?" picker
struct StaplesPicker: Decodable, Sendable {
    var mode: String?
    @Lossy var groups: [Group]
    @Lossy var own: [Product]
    @Lossy var suggestions: [Product]
    var count: Int?

    struct Group: Decodable, Sendable, Identifiable {
        var key: String
        var label: String
        @Lossy var items: [Item]
        var id: String { key }
    }

    struct Item: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var name: String
        var productId: Int?
        var on: Bool?
        var id: String { key }
    }

    struct Product: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var brand: String?
        var imagePath: String?
        var times: Int?
    }
}

extension APIClient {
    // MARK: lunchbox (families)

    func lunchbox() async throws -> Lunchbox { try await get("api/list/lunchbox") }
    /// PUT /api/list/lunchbox – only the fields given; `pausedUntil: .some(nil)` resumes
    func setLunchbox(enabled: Bool? = nil, items: [String]? = nil, weekday: Int? = nil, pausedUntil: String?? = nil) async throws {
        var body: [String: Any] = [:]
        if let enabled { body["enabled"] = enabled }
        if let items { body["items"] = items }
        if let weekday { body["weekday"] = weekday }
        if let pausedUntil { body["pausedUntil"] = pausedUntil.map { $0 as Any } ?? NSNull() }
        _ = try await send("PUT", "api/list/lunchbox", json: body, as: Ignored.self)
    }
    /// POST /api/list/lunchbox/add → { added }
    func addLunchbox() async throws -> Int {
        try await send("POST", "api/list/lunchbox/add", as: JSONValue.self)["added"]?.int ?? 0
    }

    // MARK: care lists ("Mitversorgen")

    func careCheck(listId: Int) async throws -> CareCheck { try await get("api/care/\(listId)/check") }
    func careSpent(listId: Int) async throws -> CareSpent { try await get("api/care/\(listId)/spent") }
    /// POST /api/care/:listId/missing { names } → { added }
    func careMissing(listId: Int, names: [String]) async throws -> Int {
        try await send("POST", "api/care/\(listId)/missing", json: ["names": names], as: JSONValue.self)["added"]?.int ?? 0
    }

    // MARK: WG

    func wgBalance(month: String? = nil) async throws -> WgBalance {
        try await get("api/wg/balance", query: month.map { [URLQueryItem(name: "month", value: $0)] } ?? [])
    }
    /// POST /api/list/items/:id/owner { owner_user_id } – a row for one person, or shared (nil)
    func setItemOwner(_ id: Int, userId: Int?) async throws {
        _ = try await send("POST", "api/list/items/\(id)/owner", json: ["owner_user_id": userId.map { $0 as Any } ?? NSNull()], as: Ignored.self)
    }

    // MARK: import from another list app

    /// POST /api/list/import (multipart): `text` or `file`, `list_id`, `dry_run` 1|0
    func importList(text: String?, file: (data: Data, name: String)?, listId: Int, dryRun: Bool) async throws -> ListImportPreview {
        var mp = Multipart()
        if let file {
            let lower = file.name.lowercased()
            let mime = lower.hasSuffix(".json") ? "application/json" : lower.hasSuffix(".csv") ? "text/csv" : "text/plain"
            mp.addFile("file", filename: file.name, mimeType: mime, data: file.data)
        } else {
            mp.addField("text", text ?? "")
        }
        mp.addField("list_id", String(listId))
        mp.addField("dry_run", dryRun ? "1" : "0")
        return try await upload("api/list/import", multipart: mp, as: ListImportPreview.self, timeout: 60)
    }

    // MARK: lists

    /// POST /api/list/lists { name, kind, visibility?, share_with? } → the new list's id
    func createShopList(name: String, kind: String, visibility: String?, shareWith: [Int]) async throws -> String? {
        var body: [String: Any] = ["name": name, "kind": kind]
        if let visibility {
            body["visibility"] = visibility
            body["share_with"] = shareWith
        }
        return try await send("POST", "api/list/lists", json: body, as: JSONValue.self)["id"]?.string
    }

    /// POST /api/list/items/:id/place – before/after a neighbour, into an aisle (remembered) or onto a list
    func placeItem(_ id: Int, neighborId: Int? = nil, after: Bool? = nil, section: String? = nil, listId: Int? = nil) async throws {
        var body: [String: Any] = [:]
        if let neighborId { body["neighbor_id"] = neighborId }
        if let after { body["after"] = after }
        if let section { body["section"] = section }
        if let listId { body["list_id"] = listId }
        _ = try await send("POST", "api/list/items/\(id)/place", json: body, as: Ignored.self)
    }

    // MARK: offers from a link or pasted text

    /// POST /api/offers/scan with `url` (a flyer picture or PDF) or `text` ("Lidl bis 18.10. Kaffee 9,99 €")
    func scanOffers(url: String? = nil, text: String? = nil) async throws -> [Offer] {
        var mp = Multipart()
        if let url { mp.addField("url", url) }
        if let text { mp.addField("text", text) }
        let r = try await upload("api/offers/scan", multipart: mp, as: JSONValue.self, timeout: 120)
        let data = try JSONEncoder().encode(r["offers"] ?? .array([]))
        return (try? JSONCoding.decoder().decode(Lossy<Offer>.self, from: data).wrappedValue) ?? []
    }

    // MARK: start mode "only what runs out"

    func startMode() async throws -> StartModeInfo { try await get("api/share/start-mode") }
    func setStartMode(_ mode: String) async throws -> StartModeInfo {
        try await send("PUT", "api/share/start-mode", json: ["mode": mode])
    }
    func staplesPicker() async throws -> StaplesPicker { try await get("api/share/staples") }
    /// PUT /api/share/staples { keys, product_ids, mode? } → { count, created, mode, … }
    func saveStaples(keys: [String], productIds: [Int], mode: String?) async throws -> Int {
        var body: [String: Any] = ["keys": keys, "product_ids": productIds]
        if let mode { body["mode"] = mode }
        return try await send("PUT", "api/share/staples", json: body, as: JSONValue.self)["count"]?.int ?? 0
    }
    /// POST /api/share/staples/:productId { on } – "runs out regularly" on one product
    func setRunsOut(_ productId: Int, on: Bool) async throws {
        _ = try await send("POST", "api/share/staples/\(productId)", json: ["on": on], as: Ignored.self)
    }
}
