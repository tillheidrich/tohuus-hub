import Foundation

// "Gäste & Party" (web: Bar.tsx, Party.tsx, Menu.tsx) – models and endpoints. Same API as the web:
// server/routes/guest.ts (/orders), server/routes/party.ts (/party/current, /parties…, /party-templates),
// server/routes/menu.ts (/menu…), server/routes/core.ts (/products). Notes: docs/ios-native-treats.md.

// MARK: - the board (GET /api/orders)

/// One order on the host board: from home ("Bring mir was"), from a guest link or from the party.
struct BarOrder: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var guestName: String?
    /// new | accepted | done | declined
    var status: String
    var note: String?
    var createdAt: String?
    var updatedAt: String?
    var userId: Int?
    var forUserId: Int?
    var forName: String?
    var byName: String?
    var reason: String?
    var partyId: Int?
    var guestLinkId: Int?
    var linkName: String?
    var clientId: String?
    @Lossy var lines: [TreatOrder.Line]

    static func == (a: BarOrder, b: BarOrder) -> Bool {
        a.id == b.id && a.status == b.status && a.byName == b.byName && a.updatedAt == b.updatedAt
    }
    func hash(into h: inout Hasher) { h.combine(id) }

    var isOpen: Bool { status == "new" || status == "accepted" }
    /// guests and the party are served; at home someone brings it
    var isServed: Bool { partyId != nil || guestLinkId != nil }

    /// "Party", the link's name or "at home"
    var origin: String {
        if partyId != nil { return L("Party") }
        if let n = linkName, !n.isEmpty { return n }
        return L("at home")
    }

    var badge: String {
        switch status {
        case "new": return L("new")
        case "accepted": return L("in progress")
        case "done": return isServed ? L("served") : L("brought")
        default: return L("not now")
        }
    }

    /// "Not right now – …", "Brought by Sam", "Sam is on it"
    var byLine: String? {
        if status == "declined" {
            return reason.map { LF("Not right now – %@", TreatReasons.label($0)) } ?? (byName != nil ? L("Not right now") : nil)
        }
        guard let by = byName, !by.isEmpty else { return nil }
        return status == "done" ? LF("Brought by %@", by) : LF("%@ is on it", by)
    }
}

// MARK: - party (GET /api/party/current, server/lib/party.ts partyView)

struct PartyInfo: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    /// live | ended
    var status: String
    var startedAt: String?
    var endsAt: String?
    var idleMin: Int?
    var autoEndAt: String?
    /// time | idle
    var autoEndReason: String?
    var endedAt: String?
    var showNames: Bool?
    var guestUrl: String?
    var boardUrl: String?
    var boardPath: String?
    var pairUrl: String?
    var pairCode: String?
    var openOrders: Int?
    var newOrders: Int?
    var ordersTotal: Int?
    @Lossy var menu: [MenuEntry]

    struct MenuEntry: Decodable, Sendable, Hashable {
        var productId: Int
        var name: String
        var imagePath: String?
        var maxPerGuest: Int?
        var left: Double?
        var bar: Bool?
    }

    static func == (a: PartyInfo, b: PartyInfo) -> Bool {
        a.id == b.id && a.status == b.status && a.openOrders == b.openOrders && a.pairCode == b.pairCode
            && a.showNames == b.showNames && a.autoEndAt == b.autoEndAt && a.menu.count == b.menu.count && a.name == b.name
    }
    func hash(into h: inout Hasher) { h.combine(id) }

    /// "until 23:30" or "ends at 23:30 unless someone orders"
    var endsText: String {
        guard let d = ServerDate.parse(autoEndAt) else { return "" }
        let time = d.formatted(date: .omitted, time: .shortened)
        return autoEndReason == "idle" ? LF("ends at %@ unless someone orders", time) : LF("until %@", time)
    }
}

/// GET /api/parties – the last parties (for "Recap")
struct RecentParty: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var status: String
    var startedAt: String?
    var endedAt: String?
    var orders: Int?
}

/// GET /api/party-templates – "Like last time"
struct PartyTemplate: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    @Lossy var items: [PartyMenuPick]
    var settings: Settings?

    struct Settings: Decodable, Sendable, Hashable {
        var showNames: Bool?
        var idleMin: Int?
    }

    static func == (a: PartyTemplate, b: PartyTemplate) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

/// One thing on the party menu, optionally with a maximum per guest
struct PartyMenuPick: Decodable, Sendable, Hashable, Identifiable {
    var productId: Int
    var maxPerGuest: Int?
    var id: Int { productId }

    var json: [String: Any] { ["product_id": productId, "max_per_guest": maxPerGuest ?? NSNull()] }
}

/// GET /api/parties/:id/recap
struct PartyRecap: Decodable, Sendable {
    var party: Head
    var totals: Totals
    @Lossy var items: [Item]
    @Lossy var ranOut: [StockLine]
    @Lossy var runningLow: [StockLine]

    struct Head: Decodable, Sendable { var id: Int; var name: String }
    struct Totals: Decodable, Sendable {
        var orders: Int?
        var declined: Int?
        var open: Int?
        var guests: Int?
        var items: Int?
    }
    struct Item: Decodable, Sendable, Hashable {
        var productId: Int?
        var name: String
        var qty: Int
    }
    struct StockLine: Decodable, Sendable, Hashable, Identifiable {
        var productId: Int
        var name: String
        var imagePath: String?
        var status: String?
        var total: Double?
        var onList: Bool?
        var id: Int { productId }
    }
}

struct AddedCount: Decodable, Sendable { var added: Int? }

// MARK: - products (GET /api/products) – the bar toggles and the party menu picker

struct BarProduct: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var brand: String?
    var imagePath: String?
    var unit: String?
    /// count | level | none
    var trackMode: String?
    var total: Double?
    var status: String?
    var orderable: Bool?
    var orderGroup: String?

    static func == (a: BarProduct, b: BarProduct) -> Bool { a.id == b.id && a.orderable == b.orderable && a.total == b.total && a.name == b.name }
    func hash(into h: inout Hasher) { h.combine(id) }

    var isOrderable: Bool { orderable ?? false }
    var inStock: Bool { trackMode == "none" || (total ?? 0) > 0 }
    var amountText: String { MenuQty.text(total, unit: unit, trackMode: trackMode) }

    /// web Bar.tsx defaultGroup
    var defaultGroup: String {
        let n = name.lowercased()
        if n.range(of: "eis|ice", options: .regularExpression) != nil { return L("Ice cream") }
        if n.range(of: "cola|mate|wasser|water|saft|juice|bier|beer|wein|wine|kaffee|coffee|tee|tea", options: .regularExpression) != nil { return L("Drinks") }
        return L("Snacks")
    }
}

/// "always available", "3 Stück in stock", "all gone"
enum MenuQty {
    static func number(_ v: Double) -> String { v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v) }

    static func text(_ total: Double?, unit: String?, trackMode: String?) -> String {
        if trackMode == "none" { return L("always available") }
        let t = total ?? 0
        if t <= 0 { return L("all gone") }
        if trackMode == "level" {
            switch Int(t.rounded()) {
            case 1: return LF("%@ in stock", L("low"))
            case 2: return LF("%@ in stock", L("half"))
            default: return LF("%@ in stock", L("full"))
            }
        }
        return LF("%@ in stock", [number(t), unit].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " "))
    }
}

// MARK: - the menu editor (GET /api/menu, server/lib/menu.ts menuView)

struct MenuData: Decodable, Sendable {
    @Lossy var groups: [MenuGroup]
    var partyLive: Bool?
    var count: Int?
}

struct MenuGroup: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var sort: Int?
    @Lossy var items: [MenuEditItem]

    static func == (a: MenuGroup, b: MenuGroup) -> Bool { a.id == b.id && a.name == b.name && a.items == b.items }
    func hash(into h: inout Hasher) { h.combine(id) }
}

struct MenuEditItem: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var brand: String?
    var size: String?
    var imagePath: String?
    var imageCredit: String?
    var unit: String?
    var groupId: Int?
    var description: String?
    /// available | party | family | hidden
    var availability: String?
    /// mark | hide
    var whenOut: String?
    var askNote: Bool?
    var noteHint: String?
    @Lossy var options: [MenuOption]
    /// stock | menu
    var source: String?
    var trackMode: String?
    var total: Double?
    var status: String?
    @Lossy var ingredients: [MenuIngredient]
    /// ok | few | out | maybe
    var state: String?
    var hint: String?

    static func == (a: MenuEditItem, b: MenuEditItem) -> Bool {
        a.id == b.id && a.name == b.name && a.availability == b.availability && a.imagePath == b.imagePath
            && a.hint == b.hint && a.groupId == b.groupId && a.total == b.total && a.description == b.description
            && a.askNote == b.askNote && a.options.count == b.options.count && a.ingredients.count == b.ingredients.count
    }
    func hash(into h: inout Hasher) { h.combine(id) }

    var fromStock: Bool { source == "stock" }
}

struct MenuIngredient: Decodable, Sendable, Hashable {
    var productId: Int
    var amount: Double
    var name: String
    var unit: String?
    var trackMode: String?
}

/// GET /api/menu/suggestions?q=
struct MenuSuggestion: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var brand: String?
    var imagePath: String?
    var unit: String?
    var trackMode: String?
    var total: Double?
}

/// GET /api/menu/templates
struct MenuTemplateInfo: Decodable, Sendable, Identifiable, Hashable {
    var key: String
    var title: String
    var lead: String?
    var group: String?
    var items: [String]?
    var applied: Bool?
    var id: String { key }
}

/// POST /api/menu/templates/:key
struct MenuTemplateResult: Decodable, Sendable {
    var groupId: Int?
    var added: [Int]?
    var stockHint: [String]?
}

/// The ways an item can be seen (server AVAILABILITY)
enum MenuAvailability {
    static let all = ["available", "party", "family", "hidden"]

    static func label(_ a: String?, household: String = L("Household")) -> String {
        switch a ?? "available" {
        case "party": return L("Parties")
        case "family": return household
        case "hidden": return L("Hidden")
        default: return L("Everyone")
        }
    }

    static func help(_ a: String?) -> String {
        switch a ?? "available" {
        case "party": return L("Only while a party is on – handy for the sparkling wine.")
        case "family": return L("Only household members see it, not guests.")
        case "hidden": return L("Nobody sees it right now. It stays here for later.")
        default: return L("Everyone sees it – your household, guests and parties.")
        }
    }
}

// MARK: - endpoints

extension APIClient {
    // board
    func barOrders() async throws -> [BarOrder] { try await get("api/orders", as: Lossy<BarOrder>.self).wrappedValue }

    // party
    /// GET /api/party/current → the live party or null
    func currentParty() async throws -> PartyInfo? {
        let data = try await getData("api/party/current")
        let s = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty || s == "null" { return nil }
        return try decode(PartyInfo.self, from: data)
    }
    func recentParties() async throws -> [RecentParty] { try await get("api/parties", as: Lossy<RecentParty>.self).wrappedValue }

    /// POST /api/parties { name, hours, idle_min, items, show_names, template_id }
    func startParty(name: String, hours: Double, idleMin: Int, items: [PartyMenuPick], showNames: Bool, templateId: Int?) async throws -> PartyInfo {
        try await send("POST", "api/parties", json: [
            "name": name, "hours": hours, "idle_min": idleMin, "items": items.map(\.json),
            "show_names": showNames, "template_id": templateId ?? NSNull(),
        ])
    }
    func updateParty(_ id: Int, showNames: Bool) async throws -> PartyInfo {
        try await send("PATCH", "api/parties/\(id)", json: ["show_names": showNames])
    }
    func setPartyMenu(_ id: Int, items: [PartyMenuPick]) async throws -> PartyInfo {
        try await send("PUT", "api/parties/\(id)/menu", json: ["items": items.map(\.json)])
    }
    func extendParty(_ id: Int, minutes: Int = 60) async throws -> PartyInfo {
        try await send("POST", "api/parties/\(id)/extend", json: ["minutes": minutes])
    }
    func endParty(_ id: Int) async throws -> PartyInfo { try await send("POST", "api/parties/\(id)/end", json: [:]) }
    func newPairCode(_ id: Int) async throws -> PartyInfo { try await send("POST", "api/parties/\(id)/pair-code", json: [:]) }
    func partyRecap(_ id: Int) async throws -> PartyRecap { try await get("api/parties/\(id)/recap") }
    func partyRecapToShopping(_ id: Int, productIds: [Int]) async throws -> Int {
        try await send("POST", "api/parties/\(id)/shopping", json: ["product_ids": productIds], as: AddedCount.self).added ?? 0
    }
    func partyTemplates() async throws -> [PartyTemplate] { try await get("api/party-templates", as: Lossy<PartyTemplate>.self).wrappedValue }
    func savePartyTemplate(partyId: Int, name: String) async throws {
        _ = try await send("POST", "api/party-templates", json: ["party_id": partyId, "name": name], as: Ignored.self)
    }
    func deletePartyTemplate(_ id: Int) async throws { _ = try await send("DELETE", "api/party-templates/\(id)", as: Ignored.self) }

    // products on the bar
    func barProducts() async throws -> [BarProduct] { try await get("api/products", as: Lossy<BarProduct>.self).wrappedValue }
    /// PATCH /api/products/:id { orderable, order_group } – the bar menu switch (web Bar.tsx Menu)
    func setOrderable(_ id: Int, on: Bool, group: String) async throws {
        _ = try await send("PATCH", "api/products/\(id)", json: ["orderable": on, "order_group": group], as: Ignored.self)
    }

    // the menu editor
    func menuData() async throws -> MenuData { try await get("api/menu") }
    func menuSuggestions(_ q: String) async throws -> [MenuSuggestion] {
        try await get("api/menu/suggestions", query: [URLQueryItem(name: "q", value: q)], as: Lossy<MenuSuggestion>.self).wrappedValue
    }
    func menuTemplates() async throws -> [MenuTemplateInfo] { try await get("api/menu/templates", as: Lossy<MenuTemplateInfo>.self).wrappedValue }
    func applyMenuTemplate(_ key: String) async throws -> MenuTemplateResult { try await send("POST", "api/menu/templates/\(key)", json: [:]) }
    func createMenuGroup(_ name: String) async throws { _ = try await send("POST", "api/menu/groups", json: ["name": name], as: Ignored.self) }
    func orderMenuGroups(_ ids: [Int]) async throws { _ = try await send("PUT", "api/menu/groups/order", json: ["ids": ids], as: Ignored.self) }
    func renameMenuGroup(_ id: Int, name: String) async throws { _ = try await send("PATCH", "api/menu/groups/\(id)", json: ["name": name], as: Ignored.self) }
    /// DELETE /api/menu/groups/:id – items move to `moveTo`, or leave the menu with `removeItems` (body form of the web's query)
    func deleteMenuGroup(_ id: Int, moveTo: Int?, removeItems: Bool) async throws {
        _ = try await send("DELETE", "api/menu/groups/\(id)", json: ["move_to": moveTo ?? NSNull(), "remove_items": removeItems], as: Ignored.self)
    }
    func orderMenuItems(group: Int, ids: [Int]) async throws { _ = try await send("PUT", "api/menu/groups/\(group)/items", json: ["ids": ids], as: Ignored.self) }
    func addMenuItem(_ body: [String: Any]) async throws { _ = try await send("POST", "api/menu/items", json: body, as: Ignored.self) }
    func patchMenuItem(_ id: Int, _ body: [String: Any]) async throws { _ = try await send("PATCH", "api/menu/items/\(id)", json: body, as: Ignored.self) }
    func removeMenuItem(_ id: Int) async throws { _ = try await send("DELETE", "api/menu/items/\(id)", as: Ignored.self) }
}
