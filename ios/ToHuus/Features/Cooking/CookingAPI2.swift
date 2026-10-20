import Foundation

// Cooking parity 2 (14 Oct 2026): blank recipe, cook mode, recipe tools (photos, AI import, export), Cookidoo sync,
// containers in the plan, printing, idea deck, ToHuus recipe detail. Same endpoints as the web app:
// server/routes/recipes.ts, recipes2.ts, cloud-recipes.ts, cook2.ts, labels.ts, print.ts.

// MARK: - models

/// A row of GET /api/recipes with everything the recipe cards show (Recipe in Home.swift is the slim one).
struct RecipeCard: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var title: String
    var description: String?
    var imagePath: String?
    var servings: Double?
    var timeMin: Double?
    var thermomix: JSONValue?
    var favorite: JSONValue?
    var tags: [String]?
    var sourceType: String?
    var cookCount: Int?
    var lastCooked: String?

    var isFavorite: Bool { favorite?.bool ?? false }
    var isThermomix: Bool { thermomix?.bool ?? false }
    static func == (a: RecipeCard, b: RecipeCard) -> Bool { a.id == b.id && a.title == b.title && a.imagePath == b.imagePath && a.favorite == b.favorite }
    func hash(into h: inout Hasher) { h.combine(id) }
}

/// GET /api/recipes/suggest – one card of the idea deck
struct RecipeSuggestion: Decodable, Sendable, Identifiable {
    var recipe: RecipeCard
    var have: Int?
    var need: Int?
    var reasons: [String]?
    var missing: [String]?
    var id: Int { recipe.id }
}

/// GET /api/cloud-recipes/:id
struct CatalogRecipeFull: Decodable, Sendable {
    var id: Int
    var title: String
    var description: String?
    var image: String?
    var imageKind: String?
    var imageCredit: String?
    var servings: Int?
    var timeMin: Int?
    var allergens: [String]?
    var aiAssisted: Bool?
    var reviewState: String?
    var license: String?
    var sourceAuthors: String?
    var savedId: Int?
    @Lossy var ingredients: [Line]
    @Lossy var steps: [Line]

    struct Line: Decodable, Sendable, Hashable {
        var text: String
        init(from decoder: Decoder) throws {
            if let s = try? decoder.singleValueContainer().decode(String.self) { text = s; return }
            let c = try decoder.container(keyedBy: AnyKey.self)
            text = c.first(String.self, "text") ?? ""
        }
    }
}

/// GET /api/recipes/import/images
struct RecipePhotoStatus: Decodable, Sendable {
    var pending: Int?
    var total: Int?
    var loaded: Int?
    var waiting: Int?
    var failedTotal: Int?
    @Lossy var reasons: [Reason]

    struct Reason: Decodable, Sendable, Hashable {
        var reason: String
        var n: Int
    }
}

/// GET /api/recipes/import/images/missing
struct MissingRecipePhoto: Decodable, Sendable, Identifiable {
    var id: Int
    var title: String
    var urls: [String]
}

/// GET /api/cook2/cookidoo/status
struct CookidooStatus: Decodable, Sendable {
    var push: Push?
    /// Home Assistant address + token set → "Cookidoo abgleichen" works
    var pull: Bool?
    var calendar: String?

    struct Push: Decodable, Sendable {
        var at: String?
        var by: String?
        var events: Int?
        var added: Int?
        var updated: Int?
        var removed: Int?
    }
}

/// POST /api/plan/cookidoo-sync
struct CookidooSyncResult: Decodable, Sendable {
    var events: Int?
    var added: Int?
    var updated: Int?
    var removed: Int?
    var error: String?
}

/// GET /api/print/info → printers (self-hosted receipt printers)
struct PrintInfoLite: Decodable, Sendable {
    @Lossy var printers: [Printer]
    struct Printer: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
    }
}

/// GET /api/recipes/import/ai-template, read without key conversion (the example is shown as written)
struct AIImportTemplate: Sendable {
    var prompts: [String: String]
    var example: String
}

// MARK: - endpoints

extension APIClient {
    func recipeCards() async throws -> [RecipeCard] { try await get("api/recipes", as: Lossy<RecipeCard>.self).wrappedValue }

    /// POST /api/recipes – a new recipe (also the blank one) → its id
    func createRecipe(_ body: [String: Any]) async throws -> Int {
        let r = try await send("POST", "api/recipes", json: body, as: JSONValue.self)
        guard let id = r["id"]?.int else { throw APIError.server(status: 500, message: "") }
        return id
    }

    /// GET /api/recipes/suggest?limit=20&thermomix=1|0
    func recipeSuggestions(thermomix: Bool?, limit: Int = 20) async throws -> [RecipeSuggestion] {
        var q = [URLQueryItem(name: "limit", value: String(limit))]
        if let thermomix { q.append(URLQueryItem(name: "thermomix", value: thermomix ? "1" : "0")) }
        return try await get("api/recipes/suggest", query: q, as: Lossy<RecipeSuggestion>.self).wrappedValue
    }

    /// POST /api/recipes/:id/shopping { only } – only these missing lines, each with the recipe line as note
    func recipeLinesToList(_ id: Int, only: [String]) async throws -> Int {
        try await send("POST", "api/recipes/\(id)/shopping", json: ["only": only], as: JSONValue.self)["added"]?.int ?? 0
    }

    func catalogRecipe(_ id: Int) async throws -> CatalogRecipeFull { try await get("api/cloud-recipes/\(id)") }

    // recipe photos (Settings › Areas & places › Recipes & imports on the web)
    func recipePhotoStatus() async throws -> RecipePhotoStatus { try await get("api/recipes/import/images") }
    func retryRecipePhotos() async throws -> Int {
        try await send("POST", "api/recipes/import/images/retry", json: [:], as: JSONValue.self)["queued"]?.int ?? 0
    }
    func missingRecipePhotos() async throws -> [MissingRecipePhoto] {
        try await get("api/recipes/import/images/missing", as: Lossy<MissingRecipePhoto>.self).wrappedValue
    }
    /// POST /api/recipes/import/images/:id – a photo this phone loaded; only fills a missing one
    func uploadMissingRecipePhoto(_ id: Int, jpeg: Data) async throws {
        var mp = Multipart()
        mp.addFile("image", filename: "recipe-\(id).jpg", mimeType: "image/jpeg", data: jpeg)
        _ = try await upload("api/recipes/import/images/\(id)", multipart: mp, as: Ignored.self, timeout: 90)
    }

    // AI import ("Import with any AI")
    func aiImportTemplate() async throws -> AIImportTemplate {
        let data = try await getData("api/recipes/import/ai-template")
        let o = (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let prompts = (o["prompts"] as? [String: String]) ?? [:]
        var example = ""
        if let ex = o["example"], JSONSerialization.isValidJSONObject(ex),
           let d = try? JSONSerialization.data(withJSONObject: ex, options: [.prettyPrinted, .sortedKeys]) {
            example = String(decoding: d, as: UTF8.self)
        }
        return AIImportTemplate(prompts: prompts, example: example)
    }
    /// POST /api/recipes/import/paste { text } → the same preview as a file
    func pasteRecipeImport(_ text: String) async throws -> StagedImport {
        try await send("POST", "api/recipes/import/paste", json: ["text": text], as: StagedImport.self, timeout: 90)
    }
    /// GET /api/recipes/export.json – all recipes as one file
    func recipesExportJSON() async throws -> Data { try await getData("api/recipes/export.json") }

    // Cookidoo week (self-hosted with Home Assistant)
    func cookidooStatus() async throws -> CookidooStatus { try await get("api/cook2/cookidoo/status") }
    func cookidooSync() async throws -> CookidooSyncResult {
        try await send("POST", "api/plan/cookidoo-sync", json: [:], as: CookidooSyncResult.self, timeout: 60)
    }

    /// POST /api/plan2/entries → the new entry's id (for "Undo" on the planning board)
    func addPlanEntry(day: String, slot: String = "abend", recipeId: Int?, title: String?) async throws -> Int? {
        var body: [String: Any] = ["day": day, "slot": slot]
        if let recipeId { body["recipe_id"] = recipeId }
        if let title { body["title"] = String(title.prefix(120)) }
        return try await send("POST", "api/plan2/entries", json: body, as: JSONValue.self)["id"]?.int
    }

    // containers in the plan (area: labels)
    /// POST /api/labels/boxes/:code/plan { day, slot }
    func planBox(_ code: String, day: String, slot: String) async throws {
        _ = try await send("POST", "api/labels/boxes/\(code.uppercased())/plan", json: ["day": day, "slot": slot], as: Ignored.self)
    }
    /// POST /api/labels/boxes with plan_id – leftovers of a planned meal
    func putAwayPlanned(planId: Int?, recipeId: Int?, name: String?, portions: Double, boxes: Int?, place: String, eatBy: String?, labelled: Bool = true) async throws -> [LeftoverBox] {
        var body: [String: Any] = ["portions": portions, "place": place, "labelled": labelled]
        if let name, !name.isEmpty { body["name"] = String(name.prefix(120)) }
        if let boxes { body["boxes"] = boxes }
        if let planId { body["plan_id"] = planId }
        if let recipeId { body["recipe_id"] = recipeId }
        if let eatBy { body["eat_by"] = eatBy }
        return try await send("POST", "api/labels/boxes", json: body, as: Lossy<LeftoverBox>.self).wrappedValue
    }

    // receipt printers (self-hosted)
    func printInfoLite() async throws -> PrintInfoLite { try await get("api/print/info") }
    /// POST /api/print/print { type: recipe|week, id?, day?, printer_id? }
    func printTicket(type: String, id: Int? = nil, day: String? = nil, printerId: Int? = nil) async throws {
        var body: [String: Any] = ["type": type]
        if let id { body["id"] = id }
        if let day { body["day"] = day }
        if let printerId { body["printer_id"] = printerId }
        _ = try await send("POST", "api/print/print", json: body, as: Ignored.self, timeout: 60)
    }
}
