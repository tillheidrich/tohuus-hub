import Foundation

/// ToHuus-Rezepte (ToHuus Cloud): the curated catalogue – read, and save a copy into the household's recipes.
extension APIClient {
    func catalogRecipes() async throws -> CatalogList { try await get("api/cloud-recipes") }

    func saveCatalogRecipe(_ id: Int) async throws -> CatalogSaveResult {
        try await send("POST", "api/cloud-recipes/\(id)/save", json: [:])
    }
}
