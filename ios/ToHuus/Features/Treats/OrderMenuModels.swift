import Foundation

// „Bring mir was“ – the menu (web: Menu.tsx) and the products it is built from. Same API as the web:
// server/routes/menu.ts (/menu…), server/routes/core.ts (/products). Notes: docs/ios-native-treats.md.
// (The party models lived here until 18 Oct 2026 – removed with the party mode, see docs/party-modus.md.)

// MARK: - products (GET /api/products) – the stock picker of the menu editor

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
    /// available | family | hidden (a legacy value reads as hidden)
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

/// The ways an item can be seen (server AVAILABILITY). A stored value of the former party mode reads as hidden.
enum MenuAvailability {
    static let all = ["available", "family", "hidden"]

    static func label(_ a: String?, household: String = L("Household")) -> String {
        switch a ?? "available" {
        case "available": return L("Everyone")
        case "family": return household
        default: return L("Hidden")
        }
    }

    static func help(_ a: String?) -> String {
        switch a ?? "available" {
        case "available": return L("Everyone sees it – your household and guests.")
        case "family": return L("Only household members see it, not guests.")
        default: return L("Nobody sees it right now. It stays here for later.")
        }
    }
}

// MARK: - endpoints

extension APIClient {
    // products (the menu editor's stock picker)
    func barProducts() async throws -> [BarProduct] {
        try decode(Lossy<BarProduct>.self, from: JSONCoding.splitDateKind(try await getData("api/products"))).wrappedValue
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
