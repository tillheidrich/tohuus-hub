import Foundation

// Wish lists / Merkliste (13 Oct 2026) – server/routes/wishes.ts, docs/wishes.md.
// Decoded with convertFromSnakeCase. Reservations, "bought" and the giver never arrive for the person a list is for
// (server/lib/wish-policy.ts) – the app only follows `canReserve` / `forMe`.

/// GET /api/wishes/lists
struct WishList: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var note: String?
    var ownerId: Int?
    var owner: String?
    var forUserId: Int?
    var forName: String?
    /// household | private | people
    var visibility: String
    var shareWith: [Int]?
    var archived: Bool?
    var mine: Bool?
    var forMe: Bool?
    var canReserve: Bool?
    var count: Int?
    var reserved: Int?
    var bought: Int?
    var photos: [String]?

    var isOwner: Bool { mine == true || ownerId == nil }
    var reservable: Bool { canReserve == true }
}

struct WishLink: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var label: String?
    var url: String
    var price: Double?
    var title: String?
    var site: String?
    var imagePath: String?
    var preview: String?

    var display: String { label ?? site ?? URL(string: url)?.host()?.replacingOccurrences(of: "www.", with: "") ?? url }
}

struct Wish: Decodable, Sendable, Identifiable, Hashable {
    struct Giver: Decodable, Sendable, Hashable { var userId: Int?; var name: String }
    struct StatusBy: Decodable, Sendable, Hashable { var userId: Int?; var name: String?; var mine: Bool? }

    var id: Int
    var listId: Int
    var title: String
    var note: String?
    var photoPath: String?
    var price: Double?
    var priceFromLinks: Bool?
    var priority: Int
    @Lossy var links: [WishLink]
    var giver: Giver?
    /// open | reserved | bought
    var status: String
    var statusBy: StatusBy?
    var onShoppingList: Bool?
    var archived: Bool?
    var createdAt: String?
    var listName: String?

    static func == (a: Wish, b: Wish) -> Bool { a.id == b.id && a.status == b.status && a.title == b.title }
    func hash(into h: inout Hasher) { h.combine(id) }
}

/// GET /api/wishes/lists/:id
struct WishListDetail: Decodable, Sendable {
    var list: WishList
    @Lossy var items: [Wish]
}

/// POST /api/wishes/lists/:id/share
struct WishShareText: Decodable, Sendable {
    var subject: String
    var text: String
    var mailto: String
    var count: Int
}

/// POST /api/wishes/preview
struct WishLinkPreview: Decodable, Sendable {
    var title: String?
    var site: String?
    var price: Double?
}

/// Draft of a link in the edit sheet.
struct WishLinkDraft: Identifiable, Hashable {
    var id = UUID()
    var serverId: Int?
    var label = ""
    var url = ""
    var price = ""
}
