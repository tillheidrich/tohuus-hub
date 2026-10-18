import Foundation

/// Typed endpoints (see docs/plan-2026-10-12.md "API contract" and server/routes/*.ts).
extension APIClient {
    // MARK: instance & auth

    func instance() async throws -> InstanceInfo {
        do { return try await get("api/instance") } catch APIError.notFound { return .legacySelfHost }
    }

    func signIn(login: String, password: String, code: String?, device: String) async throws -> AppAuthResponse {
        var body: [String: Any] = ["password": password, "device": device]
        body[login.contains("@") ? "email" : "name"] = login
        if let code, !code.isEmpty { body["code"] = code }
        return try await send("POST", "api/auth/app", json: body)
    }

    func signUp(email: String, password: String, name: String, householdName: String, form: String, device: String,
                betaCode: String? = nil, stores: [String]? = nil) async throws -> AppAuthResponse {
        let lang = Locale.current.language.languageCode?.identifier == "de" ? "de" : "en"
        let region = Locale.current.region?.identifier ?? "DE"
        var body: [String: Any] = [
            "email": email, "password": password, "name": name, "householdName": householdName, "form": form,
            "lang": lang, "region": region, "client": "ios", "device": device,
        ]
        if let betaCode, !betaCode.isEmpty { body["betaCode"] = betaCode }
        if let stores { body["stores"] = stores }
        return try await send("POST", "api/cloud/signup", json: body)
    }

    /// A second app token for another device of the same member (the watch). Self-hosted servers allow it with the app
    /// token; ToHuus Cloud may answer 401 (then the watch uses the iPhone's token).
    func mintDeviceToken(device: String, household: String?) async throws -> AppAuthResponse {
        var body: [String: Any] = ["device": device]
        if let household { body["household"] = household }
        return try await send("POST", "api/auth/app", json: body)
    }

    func me() async throws -> MeResponse { try await get("api/me") }
    func cloudMe() async throws -> CloudMe { try await get("api/cloud/me") }
    func devices() async throws -> [AppDevice] { try await get("api/auth/app/devices", as: Lossy<AppDevice>.self).wrappedValue }
    func revokeDevice(_ id: String) async throws { _ = try await send("DELETE", "api/auth/app/devices/\(id)", as: Ignored.self) }
    /// DELETE /api/cloud/account, confirmed with the password (accounts without a password get an e-mail link first: 400 with needEmailConfirm).
    func deleteCloudAccount(password: String) async throws {
        _ = try await send("DELETE", "api/cloud/account", json: ["password": password], as: Ignored.self)
    }

    /// Optional server helper: a one-time link that signs the web view in (see SettingsView). nil when unsupported.
    func webSignInLink(next: String = "/") async -> URL? {
        guard let r = try? await send("POST", "api/auth/app/web-link", json: ["next": next], as: JSONValue.self),
              let s = r.first("url", "link")?.string else { return nil }
        if s.hasPrefix("http") { return URL(string: s) }
        return try? url(s)
    }

    // MARK: billing

    func billingStatus() async throws -> BillingStatus { try await get("api/billing/status") }
    func postAppleTransaction(_ jws: String) async throws -> BillingStatus {
        try await send("POST", "api/billing/apple/transaction", json: ["signedTransaction": jws])
    }

    // MARK: today & rhythm

    func today() async throws -> TodayPayload { try await get("api/today") }
    func rhythm() async throws -> [RhythmItem] { try await get("api/rhythm", as: Lossy<RhythmItem>.self).wrappedValue }
    func acceptRhythm(_ productId: Int) async throws { _ = try await send("POST", "api/rhythm/\(productId)/accept", as: Ignored.self) }
    func dismissRhythm(_ productId: Int) async throws { _ = try await send("POST", "api/rhythm/\(productId)/dismiss", as: Ignored.self) }

    // MARK: shopping

    func shopList(storeId: Int? = nil, shopMode: Bool = false, listId: String? = nil) async throws -> Data {
        var q: [URLQueryItem] = []
        if let listId, listId != "0" { q.append(URLQueryItem(name: "list", value: listId)) }
        if let storeId { q.append(URLQueryItem(name: "store", value: String(storeId))) }
        if shopMode { q.append(URLQueryItem(name: "mode", value: "store")) }
        return try await getData("api/shop/list", query: q)
    }

    func parseQuickAdd(_ text: String) async throws -> [QuickAddPreview] {
        try await send("POST", "api/shop/parse", json: ["text": text], as: Lossy<QuickAddPreview>.self).wrappedValue
    }

    func sync(_ ops: [PendingOp]) async throws -> SyncResponse {
        try await send("POST", "api/shop/sync", body: SyncBody(ops: ops))
    }

    func checkout(storeId: Int?, toStock: Bool) async throws {
        var body: [String: Any] = ["to_stock": toStock]
        if let storeId { body["store_id"] = storeId }
        _ = try await send("POST", "api/shop/checkout", json: body, as: Ignored.self)
    }

    // MARK: shopping list 2 (docs/shopping-list.md)

    /// GET /api/shop/trips – who is out shopping, their basket and the "Bringst du noch …?" rows
    func trips() async throws -> [Trip] { try await get("api/shop/trips", as: Lossy<Trip>.self).wrappedValue }
    /// POST /api/shop/trips/:id/add { text } – a wish for that trip (the shopper gets `trip.addon`)
    func addToTrip(_ tripId: Int, text: String) async throws {
        _ = try await send("POST", "api/shop/trips/\(tripId)/add", json: ["text": text], as: Ignored.self)
    }
    /// "Mein Einkauf bleibt privat"
    func tripPrivacy() async throws -> Bool { try await get("api/shop/trips/privacy", as: JSONValue.self)["private"]?.bool ?? false }
    func setTripPrivacy(_ on: Bool) async throws { _ = try await send("PUT", "api/shop/trips/privacy", json: ["private": on], as: Ignored.self) }
    /// answer a wish on my trip: push action addon-accept / addon-decline with the row id as request_id
    func answerAddon(_ rowId: Int, accept: Bool) async throws {
        _ = try await send("POST", "api/push/action", json: NotifyKit.actionBody(accept ? "addon-accept" : "addon-decline", data: ["request_id": String(rowId)]),
                           as: Ignored.self)
    }

    /// POST /api/list/finish { store_id?, to_stock } – "Einkauf fertig"; older servers: /api/shop/checkout
    func finishShopping(storeId: Int?, toStock: Bool) async throws {
        var body: [String: Any] = ["to_stock": toStock]
        if let storeId { body["store_id"] = storeId }
        do {
            _ = try await send("POST", "api/list/finish", json: body, as: Ignored.self)
        } catch APIError.notFound {
            try await checkout(storeId: storeId, toStock: toStock)
        }
    }

    /// GET /api/list/recent – "Zuletzt erledigt"
    func recentDone(days: Int = 7) async throws -> [ShopItem] {
        try await get("api/list/recent", query: [URLQueryItem(name: "days", value: String(days))], as: Lossy<ShopItem>.self).wrappedValue
    }
    /// POST /api/list/items/:id/restore → { restored: unticked|copied|open }
    func restoreItem(_ id: Int) async throws -> String? {
        try await send("POST", "api/list/items/\(id)/restore", as: JSONValue.self)["restored"]?.string
    }

    /// GET /api/list/lists → [{ id, name, kind, note, open }] (id 0 = main)
    func shopLists() async throws -> [ListRef] { try await get("api/list/lists", as: Lossy<ListRef>.self).wrappedValue }
    func createShopList(name: String, kind: String = "other") async throws {
        _ = try await send("POST", "api/list/lists", json: ["name": name, "kind": kind], as: Ignored.self)
    }
    func moveItemToList(_ id: Int, listId: Int) async throws {
        _ = try await send("POST", "api/list/items/\(id)/move", json: ["list_id": listId], as: Ignored.self)
    }

    /// PATCH /api/list/items/:id { note, substitute: exact|ok|ask|null }
    func updateItem(_ id: Int, note: String?, substitute: String?) async throws {
        _ = try await send("PATCH", "api/list/items/\(id)",
                           json: ["note": note.map { $0 as Any } ?? NSNull(), "substitute": substitute.map { $0 as Any } ?? NSNull()], as: Ignored.self)
    }

    /// POST /api/list/items/:id/photo (multipart `image`) → { photo_path }
    func uploadItemPhoto(_ id: Int, jpeg: Data) async throws {
        var mp = Multipart()
        mp.addFile("image", filename: "item.jpg", mimeType: "image/jpeg", data: jpeg)
        _ = try await upload("api/list/items/\(id)/photo", multipart: mp, as: Ignored.self)
    }
    func deleteItemPhoto(_ id: Int) async throws { _ = try await send("DELETE", "api/list/items/\(id)/photo", as: Ignored.self) }

    /// GET /api/list/guard?text= → hints before adding ("laut Bon vorgestern gekauft", "im Vorrat 2")
    func guardHints(text: String) async throws -> [GuardHint] {
        try await get("api/list/guard", query: [URLQueryItem(name: "text", value: text)], as: GuardResponse.self).hints
    }
    /// GET /api/list/usuals – "Unsere Üblichen"
    func usuals() async throws -> [Usual] { try await get("api/list/usuals", as: Lossy<Usual>.self).wrappedValue }
    /// GET/PUT /api/list/prefs { density: compact|normal|large, fontScale: 0.9–1.4 }
    func listPrefs() async throws -> JSONValue { try await get("api/list/prefs") }
    func setListPrefs(density: String, fontScale: Double) async throws {
        _ = try await send("PUT", "api/list/prefs", json: ["density": density, "fontScale": (fontScale * 100).rounded() / 100], as: Ignored.self)
    }

    /// POST /api/shop/items/:id/section { section } – drag & drop between aisles
    func moveItem(_ id: Int, section: String) async throws {
        _ = try await send("POST", "api/shop/items/\(id)/section", json: ["section": section], as: Ignored.self)
    }

    // MARK: offers & prices

    func offers() async throws -> [Offer] { try await get("api/offers", as: Lossy<Offer>.self).wrappedValue }
    /// POST /api/offers/scan (multipart `image`, a flyer photo) → { via, offers }
    func scanOffers(jpeg: Data) async throws -> [Offer] {
        var mp = Multipart()
        mp.addFile("image", filename: "flyer.jpg", mimeType: "image/jpeg", data: jpeg)
        let r = try await upload("api/offers/scan", multipart: mp, as: JSONValue.self, timeout: 120)
        let data = try JSONEncoder().encode(r["offers"] ?? .array([]))
        return (try? JSONCoding.decoder().decode(Lossy<Offer>.self, from: data).wrappedValue) ?? []
    }
    func addOffer(_ id: Int) async throws { _ = try await send("POST", "api/offers/\(id)/add", as: Ignored.self) }
    func deleteOffer(_ id: Int) async throws { _ = try await send("DELETE", "api/offers/\(id)", as: Ignored.self) }
    func cheapest() async throws -> [CheapestProduct] {
        try await get("api/prices/cheapest", query: [URLQueryItem(name: "limit", value: "12")], as: Lossy<CheapestProduct>.self).wrappedValue
    }
    func prices(product id: Int) async throws -> [ShopPrice] { try await get("api/prices/product/\(id)", as: Lossy<ShopPrice>.self).wrappedValue }

    func clearChecked() async throws { _ = try await send("POST", "api/shopping/clear-checked", as: Ignored.self) }

    // MARK: pantry

    func products() async throws -> [ProductInfo] {
        try decode(Lossy<ProductInfo>.self, from: JSONCoding.splitDateKind(try await getData("api/products"))).wrappedValue
    }
    func product(_ id: Int) async throws -> ProductInfo { try decode(ProductInfo.self, from: JSONCoding.splitDateKind(try await getData("api/products/\(id)"))) }
    func places() async throws -> [Place] { try await get("api/locations", as: Lossy<Place>.self).wrappedValue }
    func usedUp(_ productId: Int) async throws { _ = try await send("POST", "api/stock/used-up", json: ["product_id": productId], as: Ignored.self) }

    func adjustStock(productId: Int, delta: Double? = nil, set: Double? = nil, locationId: Int? = nil) async throws {
        var body: [String: Any] = ["product_id": productId, "reason": "manual"]
        if let delta { body["delta"] = delta }
        if let set { body["set"] = set }
        if let locationId { body["location_id"] = locationId }
        _ = try await send("POST", "api/stock/adjust", json: body, as: Ignored.self)
    }

    func lookupBarcode(_ code: String) async throws -> BarcodeLookup {
        let safe = code.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? code
        return try await get("api/lookup/barcode/\(safe)")
    }

    func createProduct(name: String, brand: String?, code: String?, imageURL: String?, initialQty: Double?) async throws -> Int? {
        var body: [String: Any] = ["name": name]
        if let brand { body["brand"] = brand }
        if let code { body["code"] = code }
        if let imageURL { body["image_url"] = imageURL }
        if let initialQty { body["initial_qty"] = initialQty }
        let r = try await send("POST", "api/products", json: body, as: JSONValue.self)
        return r["id"]?.int
    }

    // MARK: cooking

    func cookIdeas() async throws -> [CookIdea] {
        do {
            return try await get("api/cook/ideas", query: [URLQueryItem(name: "limit", value: "12")], as: CookIdeasResponse.self).ideas
        } catch APIError.notFound {
            // older servers: the existing suggestion endpoint has the same information
            return try await get("api/recipes/suggest", query: [URLQueryItem(name: "limit", value: "20")], as: Lossy<CookIdea>.self).wrappedValue
        }
    }

    func recipes() async throws -> [Recipe] { try await get("api/recipes", as: Lossy<Recipe>.self).wrappedValue }
    func recipe(_ id: Int) async throws -> Recipe { try await get("api/recipes/\(id)") }
    func recipeMatch(_ id: Int) async throws -> [IngredientMatch] {
        try await get("api/recipes/\(id)/match", as: Lossy<IngredientMatch>.self).wrappedValue
    }
    func missingToList(_ recipeId: Int) async throws -> RecipeShoppingResult { try await send("POST", "api/recipes/\(recipeId)/shopping") }
    func cooked(_ recipeId: Int) async throws { _ = try await send("POST", "api/recipes/\(recipeId)/cooked", json: [:], as: Ignored.self) }

    func plan(from: String, days: Int = 7) async throws -> PlanResponse {
        try await get("api/plan", query: [URLQueryItem(name: "from", value: from), URLQueryItem(name: "days", value: String(days))])
    }
    func addPlan(day: String, recipeId: Int?, title: String?) async throws {
        var body: [String: Any] = ["day": day, "slot": "abend"]
        if let recipeId { body["recipe_id"] = recipeId }
        if let title { body["title"] = title }
        _ = try await send("POST", "api/plan", json: body, as: Ignored.self)
    }
    func movePlan(_ id: Int, day: String) async throws { _ = try await send("PATCH", "api/plan/\(id)", json: ["day": day], as: Ignored.self) }
    func setPlanCooked(_ id: Int, _ cooked: Bool) async throws { _ = try await send("PATCH", "api/plan/\(id)", json: ["cooked": cooked], as: Ignored.self) }
    func deletePlan(_ id: Int) async throws { _ = try await send("DELETE", "api/plan/\(id)", as: Ignored.self) }
    func planToList(from: String, days: Int = 7) async throws { _ = try await send("POST", "api/plan/shopping", json: ["from": from, "days": days], as: Ignored.self) }

    // MARK: money

    func moneyOverview(month: String) async throws -> MoneyOverview {
        try await get("api/money/overview", query: [URLQueryItem(name: "month", value: month)])
    }

    // MARK: assistant

    /// `basic: true` asks for the built-in reader only (AI switched off for this member; servers that don't know the
    /// field ignore it and decide by their own switches).
    func chat(_ message: String, conversationId: String?, basic: Bool = false, context: String? = nil) async throws -> ChatResponse {
        var body: [String: Any] = ["message": message]
        if let context { body["context"] = context }
        if basic { body["mode"] = "basic" }
        if let conversationId { body["conversationId"] = conversationId }
        return try await send("POST", "api/assistant/chat", json: body, timeout: 90)
    }

    func voice(_ audio: Data, conversationId: String?) async throws -> ChatResponse {
        var mp = Multipart()
        mp.addFile("audio", filename: "voice.m4a", mimeType: "audio/m4a", data: audio)
        if let conversationId { mp.addField("conversationId", conversationId) }
        return try await upload("api/assistant/voice", multipart: mp, timeout: 120)
    }

    func undo(_ token: String) async throws {
        let safe = token.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? token
        _ = try await send("POST", "api/assistant/undo/\(safe)", as: Ignored.self)
    }

    // MARK: receipts

    func uploadReceipt(files: [(name: String, mime: String, data: Data)]) async throws -> ImportUploadResponse {
        var mp = Multipart()
        for f in files { mp.addFile("files", filename: f.name, mimeType: f.mime, data: f.data) }
        mp.addField("mode", "auto")
        return try await upload("api/imports/upload", multipart: mp, timeout: 180)
    }

    /// POST /api/imports/lines { lines, source: 'ocr-device', mode } – text Apple Vision read on the iPhone.
    /// receipt → an import in review; list → suggested items.
    func importLines(_ lines: [String], mode: String) async throws -> LinesImport {
        try await send("POST", "api/imports/lines", json: ["lines": lines, "source": "ocr-device", "mode": mode])
    }

    func applyImport(_ id: Int) async throws { _ = try await send("POST", "api/imports/\(id)/apply", as: Ignored.self) }
}

// MARK: push & notification settings

extension APIClient {
    /// POST /api/push/apns { token, environment: 'sandbox'|'production', device }
    func registerAPNs(token: String, environment: String, device: String) async throws {
        _ = try await send("POST", "api/push/apns", json: ["token": token, "environment": environment, "device": device], as: Ignored.self)
    }

    /// DELETE /api/push/apns/:id (the token itself works as id) – on sign-out.
    func unregisterAPNs(token: String) async throws {
        _ = try await send("DELETE", "api/push/apns/\(token)", as: Ignored.self)
    }

    /// DELETE /api/auth/app/devices/current – on sign-out the server forgets this app token, so a copy of it (device
    /// backup, a sold iPad) is worthless. Best effort with a short timeout and without the 401 handler (which would
    /// sign out again): offline, the token simply runs out 180 days after its last use.
    func revokeOwnToken() async {
        guard var req = try? request("DELETE", "api/auth/app/devices/current", timeout: 5) else { return }
        req.setValue(nil, forHTTPHeaderField: "X-Household")
        _ = try? await URLSession.shared.data(for: req)
    }

    /// Plain decoding (no snake-case conversion): event keys such as "auth.new_device" must stay as they are.
    private func rawJSON(_ path: String) async throws -> JSONValue {
        let data = try await getData(path)
        do { return try JSONDecoder().decode(JSONValue.self, from: data) } catch { throw APIError.decoding(String(describing: error)) }
    }

    /// GET /api/notify/prefs, or the household matrix from /api/settings on older servers.
    func notifyPrefs() async throws -> NotifyPrefs {
        do {
            let data = try await getData("api/notify/prefs")
            do { return try JSONDecoder().decode(NotifyPrefs.self, from: data) } catch { throw APIError.decoding(String(describing: error)) }
        } catch APIError.notFound {
            guard let p = NotifyPrefs.fromSettings(try await rawJSON("api/settings")) else { throw APIError.notFound }
            return p
        }
    }

    /// Saves one switch: personal prefs when the server has them, else the push column of the household matrix (admins).
    func setNotifyPref(_ key: String, on: Bool, prefs: NotifyPrefs) async throws {
        if !prefs.household {
            // PUT /api/notify/prefs { events: { key: { apns } } } – `apns` is the iPhone channel
            _ = try await send("PUT", "api/notify/prefs", json: ["events": [key: ["apns": on]]], as: Ignored.self)
            return
        }
        var row = prefs.raw[key]?.object ?? [:]
        row["push"] = .bool(on)
        for k in ["ha", "webhook", "ntfy", "email"] where row[k] == nil { row[k] = .bool(false) }
        let obj = try JSONSerialization.jsonObject(with: try JSONEncoder().encode(JSONValue.object(row)))
        _ = try await send("PATCH", "api/settings", json: ["notify": ["events": [key: obj]]], as: Ignored.self)
    }

    /// PUT /api/notify/prefs { quiet: { from, to } | null }
    func setQuietHours(_ q: NotifyPrefs.QuietHours) async throws {
        let quiet: Any = q.enabled ? ["from": q.from, "to": q.to] : NSNull()
        _ = try await send("PUT", "api/notify/prefs", json: ["quiet": quiet], as: Ignored.self)
    }

    /// "Nur wenn ich zu Hause bin": POST /api/notify/presence { home, source: 'app' }
    func setPresence(home: Bool) async throws {
        _ = try await send("POST", "api/notify/presence", json: ["home": home, "source": "app"], as: Ignored.self)
    }
    /// POST /api/push/apns/test → { sent } – a test notification to this person's devices
    func sendTestPush() async throws -> Int {
        let r = try await send("POST", "api/push/apns/test", json: [String: String](), as: JSONValue.self)
        return r["sent"]?.int ?? 0
    }

    /// PUT /api/notify/prefs { mailOff } – all optional mails for this person off/on
    func setMailOff(_ off: Bool) async throws { _ = try await send("PUT", "api/notify/prefs", json: ["mailOff": off], as: Ignored.self) }
    func setHomeOnly(_ keys: [String]) async throws { _ = try await send("PUT", "api/notify/prefs", json: ["homeOnly": keys], as: Ignored.self) }
}

/// Body of POST /api/shop/sync
struct SyncBody: Encodable, Sendable {
    let ops: [PendingOp]
}
