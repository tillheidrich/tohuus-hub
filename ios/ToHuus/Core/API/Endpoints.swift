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

    func signUp(email: String, password: String, name: String, householdName: String, form: String, device: String) async throws -> AppAuthResponse {
        let lang = Locale.current.language.languageCode?.identifier == "de" ? "de" : "en"
        let region = Locale.current.region?.identifier ?? "DE"
        return try await send("POST", "api/cloud/signup", json: [
            "email": email, "password": password, "name": name, "householdName": householdName, "form": form,
            "lang": lang, "region": region, "client": "ios", "device": device,
        ])
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

    func shopList(storeId: Int? = nil, shopMode: Bool = false) async throws -> Data {
        var q: [URLQueryItem] = []
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

    func clearChecked() async throws { _ = try await send("POST", "api/shopping/clear-checked", as: Ignored.self) }

    // MARK: pantry

    func products() async throws -> [ProductInfo] { try await get("api/products", as: Lossy<ProductInfo>.self).wrappedValue }
    func product(_ id: Int) async throws -> ProductInfo { try await get("api/products/\(id)") }
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

    func chat(_ message: String, conversationId: String?) async throws -> ChatResponse {
        var body: [String: Any] = ["message": message]
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

    func applyImport(_ id: Int) async throws { _ = try await send("POST", "api/imports/\(id)/apply", as: Ignored.self) }
}

/// Body of POST /api/shop/sync
struct SyncBody: Encodable, Sendable {
    let ops: [PendingOp]
}
