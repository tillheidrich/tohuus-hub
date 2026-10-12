import Foundation

// Recipe sources (1.0): open recipe database (TheMealDB via the server) and recipe packages / app exports.
// Server shapes: server/routes/recipes2.ts, server/lib/open-recipes.ts, server/lib/recipes2.ts (previewOf, Job).

/// GET /api/recipes/open/search?q= → { source, results: [OpenHit] }
struct OpenRecipeSearch: Decodable, Sendable {
    var source: String?
    @Lossy var results: [OpenRecipeHit]
}

struct OpenRecipeHit: Decodable, Sendable, Identifiable, Hashable {
    var id: String
    var title: String
    var image: String?
    var category: String?
    var area: String?
    var ingredients: Int?

    /// TheMealDB serves a small thumbnail under "<image>/preview" (the web list uses it too).
    var thumb: String? { image.map { $0 + "/preview" } }
}

/// GET /api/recipes/open/themealdb/:id → the recipe in the import shape, translated (ingredients) – not saved yet.
struct OpenRecipePreview: Decodable, Sendable {
    var title: String
    var description: String?
    var imageUrl: String?
    var servings: Double?
    var timeMin: Double?
    var tags: [String]?
    @Lossy var ingredients: [OpenRecipeLine]
    @Lossy var steps: [OpenRecipeLine]
}

struct OpenRecipeLine: Decodable, Sendable, Hashable {
    var text: String
    /// English original of a translated ingredient line
    var orig: String?
}

/// POST /api/recipes/import/detect (file) → staged preview
struct StagedImport: Decodable, Sendable, Identifiable {
    var session: String
    var format: String?
    var formatLabel: String?
    var count: Int
    var updates: Int?
    @Lossy var recipes: [StagedRecipe]
    @Lossy var errors: [StagedError]
    var warnings: [String]?
    var id: String { session }
}

struct StagedRecipe: Decodable, Sendable, Identifiable, Hashable {
    var index: Int
    var title: String
    /// absolute URL or "/api/recipes/import/session/<id>/image/<n>" (photo inside the file)
    var image: String?
    var ingredients: Int?
    var steps: Int?
    var translated: Bool?
    var existingId: Int?
    var similarId: Int?
    var devices: [String]?
    var id: Int { index }
}

struct StagedError: Decodable, Sendable, Hashable {
    var index: Int?
    var title: String?
    var error: String
}

/// GET /api/recipes/import/jobs/:id
struct ImportJobState: Decodable, Sendable {
    var total: Int
    var done: Int
    var finished: Bool
    var created: Int?
    var updated: Int?
    var images: Int?
    var failed: Int?
    var error: String?
    var imagesPending: Int?
    var ids: [Int]?
    @Lossy var errors: [StagedError]
}

/// GET /api/recipes/package/template
struct RecipePackageTemplate: Decodable, Sendable {
    var prompts: [String: String]
}
