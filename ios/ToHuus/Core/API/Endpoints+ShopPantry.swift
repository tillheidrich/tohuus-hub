import Foundation

/// Einkauf & Vorrat, 0.3 parity (docs/ios-0.2.md "0.3 parity – Einkauf & Vorrat"). Shapes: server/routes/shop.ts,
/// share.ts, list2.ts, buyat.ts, core.ts, fresh.ts, labels.ts, home.ts.
extension APIClient {
    // MARK: me & members

    func meLite() async throws -> MeLite { try await get("api/me") }
    /// GET /api/shop/members → [{ id, name, color }]
    func members() async throws -> [Member] { try await get("api/shop/members", as: Lossy<Member>.self).wrappedValue }

    // MARK: claims ("Ich hol's")

    /// POST /api/claims { kind: 'shopping', id, on, user_id? } – user_id nil = me
    func claimItem(_ id: Int, on: Bool, userId: Int? = nil) async throws {
        var body: [String: Any] = ["kind": "shopping", "id": id, "on": on]
        if let userId { body["user_id"] = userId }
        _ = try await send("POST", "api/claims", json: body, as: Ignored.self)
    }

    // MARK: rows

    /// PATCH /api/list/items/:id – only the fields given (text stays as typed; qty nil → 1)
    func patchItem(_ id: Int, text: String? = nil, qty: Double?? = nil, note: String?? = nil, substitute: String?? = nil) async throws {
        var body: [String: Any] = [:]
        if let text { body["text"] = text }
        if let qty { body["qty"] = qty.map { $0 as Any } ?? NSNull() }
        if let note { body["note"] = note.map { $0 as Any } ?? NSNull() }
        if let substitute { body["substitute"] = substitute.map { $0 as Any } ?? NSNull() }
        guard !body.isEmpty else { return }
        _ = try await send("PATCH", "api/list/items/\(id)", json: body, as: Ignored.self)
    }

    /// POST /api/share/items { text, visibility: private|discreet } – the real name never enters the shared list
    func addHidden(text: String, visibility: RowVisibility) async throws -> Int {
        let r = try await send("POST", "api/share/items", json: ["text": text, "visibility": visibility.rawValue], as: JSONValue.self)
        return r["added"]?.array?.count ?? 0
    }

    /// PATCH /api/share/items/:id { visibility, share_with, reveal, placeholder }
    func setItemPrivacy(_ id: Int, visibility: RowVisibility, shareWith: [Int], reveal: Bool, placeholder: String?) async throws {
        _ = try await send("PATCH", "api/share/items/\(id)", json: [
            "visibility": visibility.rawValue, "share_with": shareWith, "reveal": reveal,
            "placeholder": placeholder.map { $0 as Any } ?? NSNull(),
        ], as: Ignored.self)
    }

    /// PUT /api/shop/items/:id/buy-at { buy_at } – with a product it is saved on the product
    func setItemBuyAt(_ id: Int, stores: [String]) async throws {
        _ = try await send("PUT", "api/shop/items/\(id)/buy-at", json: ["buy_at": stores], as: Ignored.self)
    }
    func setProductBuyAt(_ id: Int, stores: [String]) async throws {
        _ = try await send("PUT", "api/products/\(id)/buy-at", json: ["buy_at": stores], as: Ignored.self)
    }
    func buyAtSuggestions() async throws -> BuyAtSuggestions { try await get("api/buy-at/suggestions") }

    /// POST /api/shop/quick-add { items: [{ name, qty, unit, amount, product_id }], list_id }
    func quickAdd(_ lines: [SharePreview.Line], listId: Int?) async throws {
        let items: [[String: Any]] = lines.map { l in
            var d: [String: Any] = ["name": l.name]
            if let q = l.qty { d["qty"] = q }
            if let u = l.unit { d["unit"] = u }
            if let a = l.amount { d["amount"] = a }
            if let p = l.product, l.confident == true { d["product_id"] = p.id }
            return d
        }
        var body: [String: Any] = ["items": items]
        if let listId, listId > 0 { body["list_id"] = listId }
        _ = try await send("POST", "api/shop/quick-add", json: body, as: Ignored.self)
    }

    // MARK: lists & stores

    func updateShopList(_ id: Int, name: String, note: String?) async throws {
        _ = try await send("PATCH", "api/list/lists/\(id)", json: ["name": name, "note": note.map { $0 as Any } ?? NSNull()], as: Ignored.self)
    }
    func deleteShopList(_ id: Int) async throws { _ = try await send("DELETE", "api/list/lists/\(id)", as: Ignored.self) }

    func stores() async throws -> [StoreRef] { try await get("api/shop/stores", as: Lossy<StoreRef>.self).wrappedValue }
    func createStore(name: String) async throws { _ = try await send("POST", "api/shop/stores", json: ["name": name], as: Ignored.self) }
    func renameStore(_ id: Int, name: String) async throws { _ = try await send("PATCH", "api/shop/stores/\(id)", json: ["name": name], as: Ignored.self) }
    func setStoreOrder(_ id: Int, order: [String]) async throws { _ = try await send("PATCH", "api/shop/stores/\(id)", json: ["order": order], as: Ignored.self) }
    func deleteStore(_ id: Int) async throws { _ = try await send("DELETE", "api/shop/stores/\(id)", as: Ignored.self) }

    // MARK: forecast, paste, export

    func forecast(within days: Int = 7) async throws -> ForecastResponse {
        try await get("api/fresh/forecast", query: [URLQueryItem(name: "within", value: String(days))])
    }
    /// POST /api/share/parse { text } → lines with product matches
    func parseShared(_ text: String) async throws -> SharePreview { try await send("POST", "api/share/parse", json: ["text": text]) }
    /// GET /api/shopping/export.txt – "- 2× Milch" lines; private rows left out, discreet ones as placeholder
    func exportList() async throws -> String { String(decoding: try await getData("api/shopping/export.txt"), as: UTF8.self) }

    // MARK: products

    func categories() async throws -> [ProductCategory] { try await get("api/categories", as: Lossy<ProductCategory>.self).wrappedValue }

    /// GET /api/products/:id once, decoded as ProductInfo and the extra fields
    func productFull(_ id: Int) async throws -> (ProductInfo, ProductExtra) {
        let data = try await getData("api/products/\(id)")
        return (try decode(ProductInfo.self, from: data), (try? decode(ProductExtra.self, from: data)) ?? ProductExtra())
    }

    /// PATCH /api/products/:id – only the keys given (snake_case, as the server expects), as a JSON object body
    func patchProduct(_ id: Int, body: Data) async throws {
        var req = try request("PATCH", "api/products/\(id)")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        _ = try await perform(req, body: body)
    }

    /// POST /api/products/:id/image (multipart `image`)
    func uploadProductImage(_ id: Int, jpeg: Data) async throws {
        var mp = Multipart()
        mp.addFile("image", filename: "product.jpg", mimeType: "image/jpeg", data: jpeg)
        _ = try await upload("api/products/\(id)/image", multipart: mp, as: Ignored.self)
    }

    /// POST /api/stock/adjust with a place and a best-before date ("+ mit Datum / Ort")
    func addBatch(productId: Int, qty: Double, locationId: Int?, bestBefore: String?) async throws {
        var body: [String: Any] = ["product_id": productId, "delta": qty, "reason": "manual"]
        if let locationId { body["location_id"] = locationId }
        if let bestBefore { body["best_before"] = bestBefore }
        _ = try await send("POST", "api/stock/adjust", json: body, as: Ignored.self)
    }

    /// PATCH /api/stock/:id { best_before?, location_id? } – one batch
    func patchBatch(_ id: Int, bestBefore: String?? = nil, locationId: Int? = nil) async throws {
        var body: [String: Any] = [:]
        if let bestBefore { body["best_before"] = bestBefore.map { $0 as Any } ?? NSNull() }
        if let locationId { body["location_id"] = locationId }
        _ = try await send("PATCH", "api/stock/\(id)", json: body, as: Ignored.self)
    }

    func freshProduct(_ id: Int) async throws -> FreshProduct { try await get("api/fresh/products/\(id)") }

    /// POST /api/fresh/products/:id/open|freeze|thaw { entry_id?, qty? }
    func freshAction(_ productId: Int, _ action: String, entryId: Int?, qty: Double? = nil) async throws -> FreshActionResult {
        var body: [String: Any] = [:]
        if let entryId { body["entry_id"] = entryId }
        if let qty { body["qty"] = qty }
        return try await send("POST", "api/fresh/products/\(productId)/\(action)", json: body)
    }

    // MARK: quick check, find, eat soon

    func checkPlaces() async throws -> [CheckPlace] { try await get("api/fresh/check", as: Lossy<CheckPlace>.self).wrappedValue }
    func checkStack(_ locationId: Int) async throws -> CheckStack { try await get("api/fresh/check/\(locationId)") }
    /// POST /api/fresh/check/:locationId { product_id, action: ok|set|empty|gone, qty?, reason? }
    func checkAnswer(locationId: Int, productId: Int, action: String, qty: Double? = nil, reason: String? = nil) async throws {
        var body: [String: Any] = ["product_id": productId, "action": action]
        if let qty { body["qty"] = qty }
        if let reason { body["reason"] = reason }
        _ = try await send("POST", "api/fresh/check/\(locationId)", json: body, as: Ignored.self)
    }

    func find(_ q: String) async throws -> [FoundThing] {
        try await get("api/find", query: [URLQueryItem(name: "q", value: q)], as: Lossy<FoundThing>.self).wrappedValue
    }

    func freshToday() async throws -> FreshToday { try await get("api/fresh/today") }

    /// POST /api/plan { day, title, note } – "Einplanen" for something that should be eaten soon
    func planToEat(day: String, title: String, recipeId: Int? = nil) async throws {
        var body: [String: Any] = ["day": day, "title": String(title.prefix(120)), "slot": "abend"]
        if let recipeId { body["recipe_id"] = recipeId }
        _ = try await send("POST", "api/plan", json: body, as: Ignored.self)
    }

    // MARK: leftovers & labels

    func boxes(status: String = "active") async throws -> [LeftoverBox] {
        try await get("api/labels/boxes", query: [URLQueryItem(name: "status", value: status)], as: Lossy<LeftoverBox>.self).wrappedValue
    }

    /// POST /api/labels/boxes – put leftovers away (books stock, one row per container) → the new boxes
    func putAwayLeftovers(name: String, portions: Double, boxes: Int, place: String, eatBy: String?, recipeId: Int? = nil) async throws -> [LeftoverBox] {
        var body: [String: Any] = ["name": name, "portions": portions, "boxes": boxes, "place": place, "labelled": true]
        if let eatBy { body["eat_by"] = eatBy }
        if let recipeId { body["recipe_id"] = recipeId }
        return try await send("POST", "api/labels/boxes", json: body, as: Lossy<LeftoverBox>.self).wrappedValue
    }

    func box(_ code: String) async throws -> LeftoverBox { try await get("api/labels/boxes/\(code.uppercased())") }
    /// POST /api/labels/boxes/:code/action { action: take|eaten|thawed|tossed }
    func boxAction(_ code: String, _ action: String) async throws -> BoxActionResult {
        try await send("POST", "api/labels/boxes/\(code.uppercased())/action", json: ["action": action])
    }
    func undoBox(_ code: String) async throws -> LeftoverBox { try await send("POST", "api/labels/boxes/\(code.uppercased())/undo") }
    /// POST /api/labels/boxes/:code/plan { day, slot }
    func planBox(_ code: String, day: String) async throws {
        _ = try await send("POST", "api/labels/boxes/\(code.uppercased())/plan", json: ["day": day, "slot": "abend"], as: Ignored.self)
    }

    /// GET /api/qr/:code – a product or place label (other QR codes on ToHuus labels)
    func resolveQR(_ code: String) async throws -> JSONValue {
        let safe = code.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? code
        return try await get("api/qr/\(safe)")
    }

    // MARK: product images (web Product.tsx ImageSheet)

    /// GET /api/lookup/search?q= → Open Food Facts / Open Products Facts hits (name, brand, image, imageSmall)
    func searchOFF(_ q: String) async throws -> [OffHit] {
        try await get("api/lookup/search", query: [URLQueryItem(name: "q", value: q)], as: Lossy<OffHit>.self).wrappedValue
    }

    /// POST /api/products/:id/image with `url` (+ `code`) – the server fetches the picture and keeps the OFF credit
    func setProductImage(_ id: Int, url: String, code: String?) async throws {
        var mp = Multipart()
        mp.addField("url", url)
        if let code, !code.isEmpty { mp.addField("code", code) }
        _ = try await upload("api/products/\(id)/image", multipart: mp, as: Ignored.self)
    }

    /// POST /api/products (new product by hand or from a scan); `image_url` from Open Food Facts, else the server
    /// looks for a picture itself. Returns the new id.
    func createProductFull(_ body: [String: Any]) async throws -> Int? {
        let r: JSONValue = try await send("POST", "api/products", json: body)
        return r["id"]?.int
    }
}
