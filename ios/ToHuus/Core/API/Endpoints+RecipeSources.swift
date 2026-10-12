import Foundation

/// Recipe sources (1.0): open recipe database, recipe packages and app exports, recipe photos.
/// Shapes: server/routes/recipes2.ts, server/routes/recipes.ts (POST /recipes/:id/image).
extension APIClient {
    /// GET /api/recipes/open/search?q= – empty q gives one random recipe
    func openRecipes(_ q: String) async throws -> [OpenRecipeHit] {
        let r: OpenRecipeSearch = try await get("api/recipes/open/search", query: [URLQueryItem(name: "q", value: q)])
        return r.results
    }
    func openRecipe(_ id: String) async throws -> OpenRecipePreview { try await get("api/recipes/open/themealdb/\(id)") }
    /// POST /api/recipes/open/import { id } → { id, created }
    func importOpenRecipe(_ id: String) async throws -> (id: Int, created: Bool) {
        let r = try await send("POST", "api/recipes/open/import", json: ["id": id], as: JSONValue.self, timeout: 60)
        guard let rid = r["id"]?.int else { throw APIError.server(status: 500, message: "") }
        return (rid, r["created"]?.bool ?? true)
    }

    /// POST /api/recipes/import/detect (multipart "file") → preview; package zip, JSON, Paprika, Mealie, CSV …
    func detectRecipeFile(_ data: Data, filename: String) async throws -> StagedImport {
        var mp = Multipart()
        let mime = filename.lowercased().hasSuffix(".json") ? "application/json" : filename.lowercased().hasSuffix(".csv") ? "text/csv" : "application/zip"
        mp.addFile("file", filename: filename, mimeType: mime, data: data)
        return try await upload("api/recipes/import/detect", multipart: mp, as: StagedImport.self, timeout: 180)
    }
    /// POST /api/recipes/import/commit { session, include? } → { job, total }
    func commitImport(session: String, include: [Int]?) async throws -> String {
        var body: [String: Any] = ["session": session]
        if let include { body["include"] = include }
        let r = try await send("POST", "api/recipes/import/commit", json: body, as: JSONValue.self)
        guard let job = r["job"]?.string else { throw APIError.server(status: 500, message: "") }
        return job
    }
    func importJob(_ id: String) async throws -> ImportJobState { try await get("api/recipes/import/jobs/\(id)") }
    func recipePackageTemplate() async throws -> RecipePackageTemplate { try await get("api/recipes/package/template") }
    /// GET /api/recipes/package.zip – all recipes with photos (images=0 without)
    func recipePackage(images: Bool = true) async throws -> Data {
        try await getData("api/recipes/package.zip", query: images ? [] : [URLQueryItem(name: "images", value: "0")])
    }

    /// POST /api/recipes/:id/image (multipart "image") → { image_path }
    func uploadRecipePhoto(_ id: Int, jpeg: Data) async throws {
        var mp = Multipart()
        mp.addFile("image", filename: "recipe-\(id).jpg", mimeType: "image/jpeg", data: jpeg)
        _ = try await upload("api/recipes/\(id)/image", multipart: mp, as: Ignored.self, timeout: 120)
    }
}
