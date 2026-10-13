import Foundation

/// ToHuus-Rezepte (cloud only): GET /api/cloud-recipes – docs/cloud.md › ToHuus-Rezepte.
struct CatalogCard: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var title: String
    var description: String?
    var image: String?
    /// "none" (placeholder with the dish name), "photo", "ai" (shows the "KI-Bild" badge)
    var imageKind: String?
    var tags: [String]?
    var servings: Int?
    var timeMin: Int?
    var allergens: [String]?
    var aiAssisted: Bool?
    /// "reviewed" | "cooked"
    var reviewState: String?
    /// part of Plus
    var plus: Bool?
    /// a Plus recipe and this household has no Plus: the card only, no saving
    var locked: Bool?
}

struct CatalogList: Decodable, Sendable {
    var newThisWeek: [CatalogCard]
    var recent: [CatalogCard]
    /// catalogue id (as string key) → recipe id in this household
    var saved: [String: Int]
}

struct CatalogSaveResult: Decodable, Sendable {
    var id: Int
    var created: Bool
}
