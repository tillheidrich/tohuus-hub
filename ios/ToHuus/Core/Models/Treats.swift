import Foundation

// "Für mich" (treats) and guest links – server/routes/guest.ts, server/lib/orders.ts, server/lib/menu.ts.

/// GET /api/bar/menu – the order menu plus everything in the house (household members), with tile tags
/// sweet | drink | snack | fridge ("fridge" only from real stock in a place of kind fridge).
struct TreatItem: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var brand: String?
    var imagePath: String?
    var group: String?
    @Lossy var options: [MenuOption]
    var available: Bool?
    var hint: String?
    var description: String?
    var tags: [String]?

    var isAvailable: Bool { available ?? true }

    static func == (a: TreatItem, b: TreatItem) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

/// A choice group of a menu item ("Milch": Hafer, Kuh) – server/lib/menu.ts normalizeOptions
struct MenuOption: Decodable, Sendable, Hashable {
    var group: String
    var choices: [String]
    var multi: Bool?
    var required: Bool?
    var `default`: [String]?
}

/// GET /api/bar/helpers – who can bring something (household members, not permanent guests)
struct TreatHelper: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var color: String?
}

/// A wish (order) – GET /api/bar/my-orders, GET /api/bar/requests
struct TreatOrder: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var guestName: String?
    /// new | accepted | done | declined
    var status: String
    var note: String?
    var createdAt: String?
    var updatedAt: String?
    var userId: Int?
    var forUserId: Int?
    var forName: String?
    var byName: String?
    var reason: String?
    var thankedAt: String?
    /// home | guest (a wish through the shared guest link)
    var kind: String?
    @Lossy var lines: [Line]

    struct Line: Decodable, Sendable, Hashable {
        var name: String
        var qty: Int
        var options: [String]?
        var note: String?
    }

    /// "2× Vanilleeis (Löffel), 1× Tee" – or the free-text wish
    var itemsText: String {
        if !lines.isEmpty {
            return lines.map { l in
                let o = (l.options ?? []).isEmpty ? "" : " (\((l.options ?? []).joined(separator: ", ")))"
                return "\(l.qty)× \(l.name)\(o)"
            }.joined(separator: ", ")
        }
        return note.map { "„\($0)“" } ?? ""
    }

    static func == (a: TreatOrder, b: TreatOrder) -> Bool {
        a.id == b.id && a.status == b.status && a.thankedAt == b.thankedAt && a.byName == b.byName
    }
    func hash(into h: inout Hasher) { h.combine(id) }

    /// the warm status line (server/lib/orders.ts statusLine)
    var statusLine: String {
        let k = kind ?? "home"
        if status == "declined" {
            return reason.map { LF("Not right now – %@", TreatReasons.label($0)) } ?? L("Not right now")
        }
        if status == "accepted" { return byName.map { LF("Coming right up – %@ is bringing it", $0) } ?? L("Coming right up") }
        if status == "done" { return k == "guest" ? L("On its way to you") : byName.map { LF("Brought by %@", $0) } ?? L("Brought") }
        return k == "guest" ? L("Received") : L("Sent – waiting for an “I’ll bring it”")
    }
}

/// "Can't right now" reasons – the server's English source (DECLINE_REASONS), shown translated.
enum TreatReasons {
    static let all = ["In a few minutes", "It’s all gone", "I’m not home", "My hands are full"]
    static func label(_ r: String) -> String {
        switch r {
        case "In a few minutes": return L("In a few minutes")
        case "It’s all gone": return L("It’s all gone")
        case "I’m not home": return L("I’m not home")
        case "My hands are full": return L("My hands are full")
        default: return r
        }
    }
}

/// POST /api/bar/orders → { id }
struct CreatedID: Decodable, Sendable { var id: Int }

/// GET /api/guest-links – active links (the URL is only returned once, at creation or after "new link")
struct GuestLink: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    /// bar | stock | shopping
    var scopes: [String]
    var locationIds: [Int]?
    var note: String?
    var expiresAt: String?
    var createdAt: String?
    var lastSeenAt: String?
}

/// POST /api/guest-links, POST /api/guest-links/:id/rotate → { token, url }
struct GuestLinkURL: Decodable, Sendable { var token: String; var url: String }
