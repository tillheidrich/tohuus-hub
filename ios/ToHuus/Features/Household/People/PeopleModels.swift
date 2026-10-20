import Foundation

// People admin, children and permanent guests, sign-in policy, kid profiles and the kid tablet.
// Web: people/People.tsx, pages/Settings.tsx (members tab), DataSettings.tsx (Members), AuthSettings.tsx (SignInAdmin),
// KidsSettings.tsx, Kids.tsx. Server: routes/people.ts, routes/core.ts (/users), routes/auth.ts (/auth/policy,
// /auth/members), routes/data.ts (/data/settings), routes/kids.ts (/kids, /kid/:token).

// MARK: - permanent guests

/// Person.guest { base, level, override: { level, until, set_by } | null, areas }
struct GuestAccessInfo: Sendable, Hashable {
    /// the normal level: order | stock | recipes | family
    var base: String
    /// the level right now (base or the override): order | stock | recipes | family | paused
    var level: String
    var overrideLevel: String?
    /// UTC "YYYY-MM-DD HH:MM:SS" or ISO
    var overrideUntil: String?
    var overrideSetBy: String?
    var areas: [String]

    init?(_ v: JSONValue?) {
        guard let v, let level = v["level"]?.string else { return nil }
        self.level = level
        base = v["base"]?.string ?? level
        let o = v["override"]
        overrideLevel = o?["level"]?.string
        overrideUntil = o?["until"]?.string
        overrideSetBy = o?.first("setBy", "set_by")?.string
        areas = v["areas"]?.array?.compactMap(\.string) ?? []
    }

    var hasOverride: Bool { overrideLevel != nil && overrideUntil != nil }
}

extension Person {
    var guestAccess: GuestAccessInfo? { GuestAccessInfo(guest) }
}

/// The four guest levels with the web's wording (web/src/people/People.tsx LEVELS).
enum GuestLevels {
    static let all = ["order", "stock", "recipes", "family"]

    static func title(_ k: String) -> String {
        switch k {
        case "paused": return L("Paused")
        case "stock": return L("+ Stock & where is what")
        case "recipes": return L("+ Recipes & week plan")
        case "family": return L("Like family")
        default: return L("Bring me something & shopping list")
        }
    }

    static func text(_ k: String) -> String {
        switch k {
        case "stock": return L("Also sees what is in the house and where things are, and can take things out.")
        case "recipes": return L("Also sees recipes, the week plan and what to eat, and can rate dishes.")
        case "family": return L("Everything day to day – but no settings, members, spending or receipts.")
        default: return L("Can ask for treats from the menu and use the shopping list. Sees nothing else.")
        }
    }

    static let alwaysHidden = L("Never visible for guests: settings and members, spending and receipts, imports, backups and access tokens, home & care notes, discreet items.")

    /// server/lib/people-policy.ts LEVEL_AREAS → readable names
    static func areaName(_ a: String) -> String {
        switch a {
        case "order": return L("Bring me something")
        case "shopping": return L("Shopping list")
        case "stock": return L("Stock")
        case "find": return L("Where is what")
        case "recipes": return L("Recipes")
        case "plan": return L("Week plan")
        case "everyday": return L("Everyday things")
        default: return a
        }
    }
}

/// The person colours of the web (People.tsx PERSON_COLORS).
enum PersonColors {
    static let all = ["#3d5a80", "#b5553a", "#2f7d5b", "#7a4f8f", "#a83f62", "#94660f", "#8a6a2a", "#2c7a7b"]
}

/// POST /api/people/users/:id/login-link → { url?, sent, email?, expires_hours }
struct LoginLinkResult: Decodable, Sendable, Identifiable {
    var url: String?
    var sent: Bool?
    var email: String?
    var expiresHours: Int?
    var id: String { url ?? email ?? "sent" }
}

/// GET /api/people/person/:key → one person's likes, dislikes, most cooked (web: people/Ratings.tsx PersonProfileSheet)
struct PersonProfile: Decodable, Sendable {
    var person: Person?
    var likes: [Dish]
    var dislikes: [Dish]
    var mostCooked: [Dish]

    struct Dish: Decodable, Sendable, Identifiable, Hashable {
        var recipeId: Int
        var title: String
        var value: Int?
        var meals: Int?
        var imagePath: String?
        var id: Int { recipeId }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        person = c.first(Person.self, "person")
        likes = c.first(Lossy<Dish>.self, "likes")?.wrappedValue ?? []
        dislikes = c.first(Lossy<Dish>.self, "dislikes")?.wrappedValue ?? []
        mostCooked = c.first(Lossy<Dish>.self, "mostCooked", "most_cooked")?.wrappedValue ?? []
    }
}

// MARK: - sign-in (self-hosted; admins)

/// GET /api/auth/policy
struct AuthPolicyInfo: Decodable, Sendable {
    var policy: Policy
    var breakGlass: Bool?
    var mail: Bool?
    var sso: SSO?
    var redirectUri: String?

    struct Policy: Decodable, Sendable, Hashable {
        var magicLink: Bool?
        var passkeys: Bool?
        /// all | admins
        var passwordFor: String?
        var requireTotpAdmins: Bool?
        var newDeviceAlerts: Bool?
        var pinSwitch: Bool?
    }

    struct SSO: Decodable, Sendable, Hashable {
        var enabled: Bool?
        var issuer: String?
        var clientId: String?
        var clientSecret: String?
        var scopes: String?
        var label: String?
        var autoCreate: Bool?
        var defaultRole: String?
        var trustEmail: Bool?
    }
}

/// GET /api/auth/members – how each member signs in
struct MemberAuth: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var color: String?
    var role: String?
    var email: String?
    var password: Bool?
    var passkeys: Int?
    var totp: Bool?
    var pin: Bool?
    var sso: Bool?
    var sessions: Int?
    var lastSeen: String?
}

// MARK: - kid profiles (parents)

/// GET /api/kids → { kids, avatars, defaults }
struct KidsResponse: Decodable, Sendable {
    var kids: [KidProfile]
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        kids = c.first(Lossy<KidProfile>.self, "kids")?.wrappedValue ?? []
    }
}

struct KidProfile: Decodable, Sendable, Identifiable {
    var id: Int
    var name: String
    var color: String?
    var avatar: String?
    /// pre | reads
    var ageBand: String?
    var speak: Bool?
    var hasPin: Bool?
    var rules: KidRules
    var findIds: [Int]
    var ai: Bool?
    var devices: [KidDevice]
    /// tasks on the tablet: now (one at a time, default) | list
    var taskView: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = c.first(Int.self, "id") ?? 0
        name = c.first(String.self, "name") ?? "?"
        color = c.first(String.self, "color")
        avatar = c.first(String.self, "avatar")
        ageBand = c.first(String.self, "ageBand", "age_band")
        speak = c.first(Bool.self, "speak")
        hasPin = c.first(Bool.self, "hasPin", "has_pin")
        rules = c.first(KidRules.self, "rules") ?? KidRules()
        findIds = c.first([Int].self, "findIds", "find_ids") ?? []
        ai = c.first(Bool.self, "ai")
        taskView = c.first(String.self, "taskView", "task_view")
        devices = c.first(Lossy<KidDevice>.self, "devices")?.wrappedValue ?? []
    }

    var reads: Bool { ageBand == "reads" }
}

struct KidDevice: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var label: String?
    var expiresAt: String?
    var createdAt: String?
    var lastSeenAt: String?
}

/// lib/kids-rules.ts: what a kid may wish for, limits, quiet hours, how many open wishes
struct KidRules: Decodable, Sendable, Hashable {
    var categories: [Int] = []
    var products: [Int] = []
    var blocked: [Int] = []
    var limits: [KidLimit] = []
    var quiet: Quiet?
    var maxOpen: Int = 1

    struct Quiet: Decodable, Sendable, Hashable {
        var from: String
        var to: String
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        categories = c.first([Int].self, "categories") ?? []
        products = c.first([Int].self, "products") ?? []
        blocked = c.first([Int].self, "blocked") ?? []
        limits = c.first(Lossy<KidLimit>.self, "limits")?.wrappedValue ?? []
        quiet = c.first(Quiet.self, "quiet")
        maxOpen = c.first(Int.self, "maxOpen", "max_open") ?? 1
    }

    /// the body PATCH /api/kids/:id { rules } expects (snake_case)
    var json: [String: Any] {
        [
            "categories": categories,
            "products": products,
            "blocked": blocked,
            "limits": limits.filter { $0.categoryId != nil || $0.productId != nil }.map(\.json),
            "quiet": quiet.map { ["from": $0.from, "to": $0.to] as [String: Any] } ?? NSNull(),
            "max_open": maxOpen,
        ]
    }
}

struct KidLimit: Decodable, Sendable, Hashable, Identifiable {
    var id: String
    var categoryId: Int?
    var productId: Int?
    var perDay: Int?
    /// "HH:MM"
    var from: String?
    var to: String?

    init(id: String = String(UUID().uuidString.prefix(7)).lowercased(), categoryId: Int? = nil, productId: Int? = nil, perDay: Int? = 1) {
        self.id = id
        self.categoryId = categoryId
        self.productId = productId
        self.perDay = perDay
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = c.first(String.self, "id") ?? String(UUID().uuidString.prefix(7)).lowercased()
        categoryId = c.first(Int.self, "categoryId", "category_id")
        productId = c.first(Int.self, "productId", "product_id")
        perDay = c.first(Int.self, "perDay", "per_day")
        from = c.first(String.self, "from")
        to = c.first(String.self, "to")
    }

    var json: [String: Any] {
        var o: [String: Any] = ["id": id]
        o["category_id"] = categoryId ?? NSNull()
        o["product_id"] = productId ?? NSNull()
        o["per_day"] = perDay ?? NSNull()
        o["from"] = (from?.isEmpty == false ? from : nil) ?? NSNull()
        o["to"] = (to?.isEmpty == false ? to : nil) ?? NSNull()
        return o
    }

    /// "c3" (a whole group) or "p12" (one item)
    var target: String { categoryId.map { "c\($0)" } ?? productId.map { "p\($0)" } ?? "" }
}

/// GET /api/kids/wishes – waiting for a parent
struct KidWish: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var kidId: Int?
    var kidName: String?
    var kidColor: String?
    var kidAvatar: String?
    var productId: Int?
    var name: String
    var status: String?
    var createdAt: String?
    var imagePath: String?
}

/// GET /api/kids/places – places with an optional photo (kids' and babysitters' "Where is …?")
struct KidPlace: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var icon: String?
    var hint: String?
    var photo: String?
}

/// POST /api/kids/:id/devices → { token, url } (shown only once)
struct KidPairing: Decodable, Sendable, Identifiable {
    var token: String
    var url: String
    var id: String { token }
}

// MARK: - the kid tablet (GET /api/kid/:token, no sign-in)

struct KidHome: Decodable, Sendable {
    var kid: Kid
    var household: String?
    var quiet: Quiet?
    var tiles: [Tile]
    var wishes: [Wish]
    var find: [Find]
    var language: String?
    var ai: JSONValue?
    /// "Jetzt" (docs/now.md): the kid's tasks, one at a time – optional, older servers don't send it
    var tasks: NowQueue?

    struct Kid: Decodable, Sendable, Hashable {
        var name: String
        var color: String?
        var avatar: String?
        var ageBand: String?
        var speak: Bool?
        var hasPin: Bool?
    }

    struct Quiet: Decodable, Sendable, Hashable { var until: String? }

    struct Tile: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var imagePath: String?
        var art: String?
        var category: String?
        /// ok | quiet | later | enough | busy
        var state: String?
        var until: String?
    }

    struct Wish: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var imagePath: String?
        var art: String?
        /// waiting | coming | here | later
        var view: String?
    }

    struct Find: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var imagePath: String?
        var spot: String?
        var place: Place?
    }

    struct Place: Decodable, Sendable, Hashable {
        var id: Int?
        var name: String?
        var icon: String?
        var photo: String?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        guard let k = c.first(Kid.self, "kid") else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no kid"))
        }
        kid = k
        household = c.first(String.self, "household")
        quiet = c.first(Quiet.self, "quiet")
        tiles = c.first(Lossy<Tile>.self, "tiles")?.wrappedValue ?? []
        wishes = c.first(Lossy<Wish>.self, "wishes")?.wrappedValue ?? []
        find = c.first(Lossy<Find>.self, "find")?.wrappedValue ?? []
        language = c.first(String.self, "language")
        ai = c.first(JSONValue.self, "ai")
    }

    var aiEnabled: Bool { ai?["enabled"]?.bool ?? true }
}
