import Foundation

// Models and API calls for places & categories, QR labels, favourites and the product page extras
// (docs/ios-native-places.md). Same endpoints as the web app: web/src/pages/PlacesSettings.tsx, Labels.tsx,
// Leftovers.tsx (BoxLabels), people/Ratings.tsx (Favourites), Product.tsx, FreshParts.tsx.

/// GET /api/locations?all=1 – one place of the tree (server/lib/places.ts listPlaces)
struct PlaceRow: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var icon: String?
    var kind: String?
    /// ambient | chilled | frozen
    var climate: String?
    var parentId: Int?
    var hint: String?
    var ownerUserId: Int?
    var ownerName: String?
    /// 0/1 from SQLite
    var archived: JSONValue?
    var productCount: Int?
    var depth: Int?
    var path: String?
    var system: Bool?
    var children: Int?

    var isArchived: Bool { archived?.bool ?? false }
    var isSystem: Bool { system == true }
    var label: String { path ?? name }
}

/// GET/PUT /api/home/setup – who lives here and how
struct HomeSetup: Decodable, Sendable {
    var form: String?
    var formChosen: Bool?
    var preset: String?
    var ui: UI?

    struct UI: Decodable, Sendable { var personalPlaces: Bool? }
}

/// POST /api/qr → one printable label
struct QrLabel: Decodable, Sendable, Identifiable, Hashable {
    var kind: String
    var refId: Int
    var code: String
    var url: String
    var title: String
    var sub: String?
    var id: String { code }
}

/// GET /api/labels/meta – sticker sheet layouts and thermal printers
struct LabelsMeta: Decodable, Sendable {
    var hasFreezer: Bool?
    @Lossy var printers: [Printer]
    @Lossy var layouts: [Layout]

    struct Printer: Decodable, Sendable, Hashable { var id: FlexID; var name: String }
    struct Layout: Decodable, Sendable, Hashable, Identifiable {
        var key: String
        var perPage: Int?
        var w: Double?
        var h: Double?
        var id: String { key }
    }
}

/// GET /api/labels/boxes – the fields the label sheet needs (printed / wanted)
struct BoxPick: Decodable, Sendable, Identifiable, Hashable {
    var code: String
    var name: String
    var left: Double?
    var place: String?
    var eatBy: String?
    var labelled: JSONValue?
    var printedAt: String?
    var id: String { code }

    var wantsLabel: Bool { labelled?.bool ?? true }
    var prettyCode: String { code.count == 8 ? "\(code.prefix(4)) \(code.suffix(4))" : code }
}

/// GET /api/people/favourites
struct FavouritesData: Decodable, Sendable {
    @Lossy var family: [FavCard]
    @Lossy var classics: [FavCard]
    @Lossy var people: [FavPerson]

    struct FavCard: Decodable, Sendable, Hashable, Identifiable {
        var recipeId: Int
        var title: String
        var imagePath: String?
        var avg: Double?
        var n: Int?
        var lovedBy: [String]?
        var cooked: Int?
        var id: Int { recipeId }
    }

    struct FavPerson: Decodable, Sendable, Hashable, Identifiable {
        var key: String
        var name: String
        var color: String?
        var kind: String?
        var face: PersonFace?
        var rated: Int?
        @Lossy var top: [FavCard]
        var id: String { key }
    }
}

/// GET /api/people/person/:key – what one person likes
struct PersonTaste: Decodable, Sendable {
    var person: Person
    @Lossy var likes: [Line]
    @Lossy var okay: [Line]
    @Lossy var dislikes: [Line]
    @Lossy var mostCooked: [Line]

    struct Person: Decodable, Sendable {
        var key: String
        var name: String
        var color: String?
        var face: PersonFace?
        var prefs: Prefs?
    }
    struct Prefs: Decodable, Sendable {
        var likes: [String]?
        var dislikes: [String]?
        var allergies: [String]?
    }
    struct Line: Decodable, Sendable, Hashable, Identifiable {
        var recipeId: Int
        var title: String
        var value: Double?
        var meals: Int?
        var id: Int { recipeId }
    }
}

/// GET /api/products/:id – what the product page shows beyond ProductInfo / ProductExtra
struct ProductMore: Decodable, Sendable {
    var kind: String?
    var size: String?
    var isStaple: Bool?
    var orderable: Bool?
    var orderGroup: String?
    var dateKind: String?
    /// 0/1 (products.runs_out)
    var runsOut: JSONValue?
    var codes: [String]?
    var aliases: [Alias]?

    struct Alias: Decodable, Sendable, Hashable { var alias: String }

    var isLeftover: Bool { kind == "leftover" }
    var runsOutOn: Bool { runsOut?.bool ?? false }
}

/// GET /api/fresh/products/:id – shelf life, last check and the run-out estimate (FreshProduct has the batches)
struct FreshMore: Decodable, Sendable {
    var recipeId: Int?
    var daysAfterOpening: Int?
    var defaultDaysAfterOpening: Int?
    var openDays: Int?
    var openDaysEstimated: Bool?
    var freezerDays: Int?
    var defaultFreezerDays: Int?
    var confirmedAt: String?
    var confirmedDays: Int?
    var confirmedBy: String?
    var forecast: Forecast?

    struct Forecast: Decodable, Sendable {
        var daysLeft: Int
        var perWeek: Double?
        /// usage | purchase-cycle
        var method: String?
        var basis: Int?
    }
}

/// GET /api/fresh/waste – what was thrown away this month
struct WasteMonth: Decodable, Sendable {
    var month: String
    var count: Int
    @Lossy var items: [Item]
    var byReason: [String: Int]?
    var tip: String?

    struct Item: Decodable, Sendable, Hashable {
        var productId: Int
        var name: String
        var trackMode: String?
        var qty: Double?
    }
}

extension APIClient {
    // MARK: places

    func placeTree() async throws -> [PlaceRow] {
        try await get("api/locations", query: [URLQueryItem(name: "all", value: "1")], as: Lossy<PlaceRow>.self).wrappedValue
    }

    func createPlace(name: String, parentId: Int?, climate: String?) async throws {
        _ = try await send("POST", "api/locations", json: [
            "name": name,
            "parent_id": parentId.map { $0 as Any } ?? NSNull(),
            "climate": climate.map { $0 as Any } ?? NSNull(),
        ], as: Ignored.self)
    }

    /// PATCH /api/locations/:id – only the keys given (snake_case)
    func patchPlace(_ id: Int, _ body: [String: Any]) async throws {
        _ = try await send("PATCH", "api/locations/\(id)", json: body, as: Ignored.self)
    }

    func deletePlace(_ id: Int) async throws { _ = try await send("DELETE", "api/locations/\(id)", as: Ignored.self) }

    func orderPlaces(_ ids: [Int]) async throws { _ = try await send("PUT", "api/locations/order", json: ["ids": ids], as: Ignored.self) }

    func homeSetup() async throws -> HomeSetup { try await get("api/home/setup") }

    func saveHomeSetup(_ body: [String: Any]) async throws { _ = try await send("PUT", "api/home/setup", json: body, as: Ignored.self) }

    func patchCategory(_ id: Int, _ body: [String: Any]) async throws {
        _ = try await send("PATCH", "api/categories/\(id)", json: body, as: Ignored.self)
    }

    func createCategory(name: String) async throws {
        _ = try await send("POST", "api/categories", json: ["name": name, "icon": "tag"], as: Ignored.self)
    }

    // MARK: labels

    func qrLabels(kind: String, ids: [Int]) async throws -> [QrLabel] {
        try await send("POST", "api/qr", json: ["kind": kind, "ids": ids], as: Lossy<QrLabel>.self).wrappedValue
    }

    func labelsMeta() async throws -> LabelsMeta { try await get("api/labels/meta") }

    func boxPicks() async throws -> [BoxPick] {
        try await get("api/labels/boxes", query: [URLQueryItem(name: "status", value: "active")], as: Lossy<BoxPick>.self).wrappedValue
    }

    private func sheetQuery(_ codes: [String], layout: String, skip: Int) -> [URLQueryItem] {
        [URLQueryItem(name: "codes", value: codes.joined(separator: ",")), URLQueryItem(name: "layout", value: layout),
         URLQueryItem(name: "skip", value: String(skip))]
    }

    /// GET /api/labels/sheet.pdf – A4 sticker sheet; marks the boxes as printed
    func boxSheetPDF(_ codes: [String], layout: String, skip: Int) async throws -> Data {
        try await getData("api/labels/sheet.pdf", query: sheetQuery(codes, layout: layout, skip: skip))
    }

    /// GET /api/labels/sheet.png – preview of the first page (does not mark anything)
    func boxSheetPreview(_ codes: [String], layout: String, skip: Int) async throws -> Data {
        try await getData("api/labels/sheet.png", query: sheetQuery(codes, layout: layout, skip: skip))
    }

    /// POST /api/labels/print → { printer, labels }
    func printBoxLabels(_ codes: [String], size: String) async throws -> JSONValue {
        try await send("POST", "api/labels/print", json: ["codes": codes, "size": size], as: JSONValue.self, timeout: 60)
    }

    /// POST /api/labels/boxes – portion a product into labelled containers (web PutAwayButton)
    func portionProduct(productId: Int, name: String, portions: Double, boxes: Int, place: String) async throws -> [BoxPick] {
        try await send("POST", "api/labels/boxes", json: [
            "product_id": productId, "name": name, "portions": portions, "boxes": boxes, "place": place, "labelled": true,
        ], as: Lossy<BoxPick>.self).wrappedValue
    }

    // MARK: favourites

    func favourites() async throws -> FavouritesData { try await get("api/people/favourites") }

    func personTaste(_ key: String) async throws -> PersonTaste {
        try await get("api/people/person/\(key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key)")
    }

    // MARK: product extras

    func setShelfLife(_ productId: Int, daysAfterOpening: Int?, freezerDays: Int?) async throws {
        _ = try await send("PATCH", "api/fresh/products/\(productId)", json: [
            "days_after_opening": daysAfterOpening.map { $0 as Any } ?? NSNull(),
            "freezer_days": freezerDays.map { $0 as Any } ?? NSNull(),
        ], as: Ignored.self)
    }

    /// POST /api/fresh/products/:id/waste { qty?, reason }
    func wasteProduct(_ productId: Int, qty: Double?, reason: String) async throws {
        var body: [String: Any] = ["reason": reason]
        if let qty { body["qty"] = qty }
        _ = try await send("POST", "api/fresh/products/\(productId)/waste", json: body, as: Ignored.self)
    }

    /// POST /api/fresh/products/:id/freeze|thaw { qty } – the whole product, not one batch
    func freezeOrThaw(_ productId: Int, _ action: String, qty: Double?) async throws -> FreshActionResult {
        var body: [String: Any] = [:]
        if let qty { body["qty"] = qty }
        return try await send("POST", "api/fresh/products/\(productId)/\(action)", json: body)
    }

    func markRunsOut(_ productId: Int, _ on: Bool) async throws {
        _ = try await send("POST", "api/share/staples/\(productId)", json: ["on": on], as: Ignored.self)
    }

    /// GET /api/share/start-mode → { mode: full | staples }
    func stockStartMode() async throws -> String? { try await get("api/share/start-mode", as: JSONValue.self)["mode"]?.string }

    /// GET /api/retail/date-kind?name= → best_before | use_by (what "automatic" means for this name)
    func autoDateKind(_ name: String) async throws -> String? {
        try await get("api/retail/date-kind", query: [URLQueryItem(name: "name", value: name)], as: JSONValue.self)["kind"]?.string
    }

    func deleteProduct(_ id: Int) async throws { _ = try await send("DELETE", "api/products/\(id)", as: Ignored.self) }

    /// POST /api/products/:id/enrich → { ok } – look for a picture again
    func findProductImage(_ id: Int) async throws -> Bool {
        try await send("POST", "api/products/\(id)/enrich", json: [:], as: JSONValue.self)["ok"]?.bool ?? false
    }

    func wasteMonth() async throws -> WasteMonth { try await get("api/fresh/waste") }
}
