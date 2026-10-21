import Foundation

// Wish lists / Merkliste (13 Oct 2026, wish-list app features 20 Oct 2026) – server/routes/wishes.ts, docs/wishes.md.
// Decoded with convertFromSnakeCase. Reservations, "bought", the giver and reminders of others never arrive for the
// person a list is for, nor for the owner of a surprise list (server/lib/wish-policy.ts) – the app only follows
// `canReserve` / `forMe`.

/// GET /api/wishes/lists
struct WishList: Decodable, Sendable, Identifiable, Hashable {
    struct GuestLink: Decodable, Sendable, Hashable { var url: String; var createdAt: String? }

    var id: Int
    var name: String
    var note: String?
    var ownerId: Int?
    var owner: String?
    var forUserId: Int?
    var forName: String?
    /// birthday | christmas | wedding | baby | easter | other
    var occasion: String?
    /// YYYY-MM-DD
    var eventDate: String?
    var daysUntil: Int?
    /// household | private | people
    var visibility: String
    var shareWith: [Int]?
    var editors: [Int]?
    var surprise: Bool?
    var archived: Bool?
    var mine: Bool?
    /// owner | editor | member
    var role: String?
    var forMe: Bool?
    var canReserve: Bool?
    /// may delete any wish here (owner, co-editor, admin on a household list) – server rule, 21 Oct 2026
    var canEdit: Bool?
    /// may delete the whole list
    var canDelete: Bool?
    var count: Int?
    var reserved: Int?
    var bought: Int?
    var open: Int?
    var people: Int?
    var link: GuestLink?
    var photos: [String]?
    var icons: [String]?

    var isOwner: Bool { mine == true || ownerId == nil }
    /// delete the whole list (older servers: the owner)
    var mayDelete: Bool { canDelete ?? isOwner }
    /// owner or co-editor: may share the guest link
    var runs: Bool { role == "owner" || role == "editor" || ownerId == nil }
    var reservable: Bool { canReserve == true }
    var taken: Int { (reserved ?? 0) + (bought ?? 0) }
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
    struct StatusBy: Decodable, Sendable, Hashable { var userId: Int?; var name: String?; var mine: Bool?; var guest: Bool? }
    struct Reminder: Decodable, Sendable, Hashable { var remindOn: String; var sent: Bool? }

    var id: Int
    var listId: Int
    var title: String
    var note: String?
    var photoPath: String?
    /// placeholder symbol key (server/lib/wish-icons.ts) → SF Symbol (WishSymbol)
    var icon: String?
    var price: Double?
    var priceFromLinks: Bool?
    var quantity: Int?
    var priority: Int
    @Lossy var links: [WishLink]
    var giver: Giver?
    /// open | reserved | bought
    var status: String
    var statusBy: StatusBy?
    var reminder: Reminder?
    var onShoppingList: Bool?
    /// may take this wish off the list (swipe to delete)
    var canDelete: Bool?
    var archived: Bool?
    var createdBy: String?
    var createdAt: String?
    var listName: String?

    var qty: Int { max(1, quantity ?? 1) }
    var mineReserved: Bool { statusBy?.mine == true }

    static func == (a: Wish, b: Wish) -> Bool { a.id == b.id && a.status == b.status && a.title == b.title && a.reminder == b.reminder && a.photoPath == b.photoPath }
    func hash(into h: inout Hasher) { h.combine(id) }
}

/// GET /api/wishes/lists/:id
struct WishListDetail: Decodable, Sendable {
    var list: WishList
    @Lossy var items: [Wish]
}

/// One entry of "Du schenkst" (GET /api/wishes/giving): the wish plus where it belongs.
struct GiftItem: Decodable, Sendable, Identifiable, Hashable {
    struct ListInfo: Decodable, Sendable, Hashable {
        var id: Int
        var name: String
        var forName: String?
        var occasion: String?
        var eventDate: String?
        var daysUntil: Int?
    }
    var wish: Wish
    var list: ListInfo
    var suggestRemindOn: String?
    var id: Int { wish.id }

    private enum K: String, CodingKey { case list, suggestRemindOn }
    init(from decoder: Decoder) throws {
        wish = try Wish(from: decoder)
        let c = try decoder.container(keyedBy: K.self)
        list = try c.decode(ListInfo.self, forKey: .list)
        suggestRemindOn = try c.decodeIfPresent(String.self, forKey: .suggestRemindOn)
    }
}

/// GET /api/wishes/giving
struct Giving: Decodable, Sendable {
    @Lossy var todo: [GiftItem]
    @Lossy var bought: [GiftItem]
    var count: Int
    var sum: Double
    var todoSum: Double?
    var boughtSum: Double?
}

/// POST /api/wishes/lists/:id/share
struct WishShareText: Decodable, Sendable {
    var subject: String
    var text: String
    var mailto: String
    var count: Int
    var format: String?
    var link: String?
}

/// POST /api/wishes/ai/photo
struct WishAIResult: Decodable, Sendable {
    var title: String
    var note: String?
    var price: Double?
    var icon: String?
}

/// Draft of a link in the edit sheet. `title`/`site` come from LinkPresentation on the device – never from the server.
struct WishLinkDraft: Identifiable, Hashable {
    var id = UUID()
    var serverId: Int?
    var label = ""
    var url = ""
    var price = ""
    var title: String?
    var site: String?
}
