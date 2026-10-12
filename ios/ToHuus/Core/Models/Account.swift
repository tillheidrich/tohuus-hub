import Foundation

/// GET /api/instance (public)
struct InstanceInfo: Decodable, Sendable {
    var name: String?
    var mode: String?
    var version: String?
    var brand: String?
    var lang: String?
    var auth: AuthMethods?
    var region: JSONValue?
    var signup: Bool?
    var features: Features?
    var legal: Legal?

    struct AuthMethods: Decodable, Sendable {
        var password: JSONValue?
        var magicLink: JSONValue?
        var passkey: JSONValue?
        var oidc: JSONValue?
        var passwordMin: Int?
        /// ToHuus Cloud: Sign in with Apple on the web (the app can always use it in the cloud)
        var apple: JSONValue?
    }

    struct Features: Decodable, Sendable {
        var assistant: JSONValue?
        var voice: JSONValue?
        var receiptsAi: JSONValue?
        var billingApple: JSONValue?
        /// { configured, household, mcp }
        var ai: JSONValue?
        /// text recognition on the server
        var ocr: JSONValue?
    }

    struct Legal: Decodable, Sendable {
        var privacy: String?
        var terms: String?
        var imprint: String?
    }

    var isCloud: Bool { mode == "cloud" }
    var assistantEnabled: Bool { features?.assistant?.bool ?? true }
    var voiceEnabled: Bool { features?.voice?.bool ?? false }
    var billingApple: Bool { features?.billingApple?.bool ?? isCloud }
    /// cloud accounts 10, self-hosted members 8
    var passwordMin: Int { auth?.passwordMin ?? (isCloud ? 10 : 8) }

    /// Fallback for servers that predate /api/instance.
    static let legacySelfHost = InstanceInfo(name: "ToHuus", mode: "selfhost", signup: false)
}

struct HouseholdRef: Codable, Sendable, Identifiable, Hashable {
    var id: FlexID
    var name: String?
    var role: String?
    var plan: String?
    var trialEndsAt: String?
}

/// POST /api/auth/app and POST /api/cloud/signup (client ios)
struct AppAuthResponse: Decodable, Sendable {
    var token: String
    var account: JSONValue?
    var user: JSONValue?
    @Lossy var households: [HouseholdRef]
    var household: JSONValue?
    /// Sign in with Apple: a new account and household were created (the app asks about sample data)
    var created: Bool?

    /// The active household: an id string/number or an object with `id`.
    var householdId: String? {
        if let h = household {
            if let s = h.string { return s }
            if let s = h["id"]?.string { return s }
        }
        return households.first?.id.value
    }

    var userName: String? { user?["name"]?.string ?? account?["name"]?.string }
}

/// GET /api/cloud/me
struct CloudMe: Decodable, Sendable {
    var account: JSONValue?
    @Lossy var memberships: [HouseholdRef]
    @Lossy var households: [HouseholdRef]
    var household: JSONValue?

    var email: String? { account?["email"]?.string }
    var verified: Bool { account?["verified"]?.bool ?? (account?["verifiedAt"].map { !$0.isNull } ?? false) }
    var allHouseholds: [HouseholdRef] { households.isEmpty ? memberships : households }
}

/// GET /api/me
struct MeResponse: Decodable, Sendable {
    var actor: JSONValue?
    var household: String?
    var language: String?
    var version: String?
    /// "Was nutzen wir?" { stock, cook, money, treats, homeinfo, guests, ha }
    var modules: [String: Bool]?
    /// { density: compact|normal|large, fontScale }
    var listPrefs: JSONValue?

    var name: String? { actor?["name"]?.string }
    var role: String? { actor?["role"]?.string }
    /// children (kid devices or a child role) see AI as locked
    var isChild: Bool {
        let kind = actor?["kind"]?.string
        return kind == "kid" || kind == "child" || role == "child" || role == "kid" || actor?["child"]?.bool == true
    }
}

/// GET /api/auth/app/devices
struct AppDevice: Decodable, Sendable, Identifiable {
    var id: FlexID
    var name: String?
    var device: String?
    var createdAt: String?
    var lastUsedAt: String?
    var current: Bool?

    var label: String { name ?? device ?? L("Device") }
}

/// GET /api/billing/status
struct BillingStatus: Decodable, Sendable {
    var plan: String?
    var trialEndsAt: String?
    var renewsAt: String?
    var source: String?
    var expiresAt: String?
    var autoRenew: Bool?
    /// monthly | yearly
    var period: String?
    var manageUrl: String?
    /// personal e-mail reminder before a yearly renewal
    var reminder: JSONValue?
    var limits: JSONValue?
    var usage: JSONValue?
    var products: JSONValue?
    var storage: JSONValue?
    /// what each plan includes: `{ free, haushalt, plus }` with the fields of `limits` (cloud)
    var plans: JSONValue?

    var planLabel: String {
        switch plan {
        case "trial": return L("Trial (Plus)")
        case "haushalt": return L("Household")
        case "plus": return L("Plus")
        case "selfhost": return L("Own server – everything included")
        default: return L("Free")
        }
    }

    var isPaid: Bool { plan == "haushalt" || plan == "plus" }

    var assistantUsed: Int? { usage?.first("assistantThisMonth", "assistant")?.int }
    var assistantLimit: Int? { limits?.first("assistantPerMonth", "assistant")?.int }

    /// Storage in bytes, wherever the server puts it (storage, usage or limits).
    var storageUsedBytes: Double? {
        storage?.first("usedBytes", "used")?.double ?? usage?.first("storageBytes", "storageUsedBytes")?.double
            ?? usage?.first("storageMb").flatMap { $0.double.map { $0 * 1_048_576 } }
    }

    var storageLimitBytes: Double? {
        storage?.first("limitBytes", "quotaBytes", "limit")?.double ?? limits?.first("storageBytes", "storageQuotaBytes")?.double
            ?? limits?.first("storageMb").flatMap { $0.double.map { $0 * 1_048_576 } }
    }
}

/// GET /api/assistant/status – what the UI can offer. Fields beyond `ai/voice/receiptsAi` are read when present:
/// `household` (the household's AI switch), `personal` (this member's own switch), `locked` (a child whose parents
/// switched AI off – shown, not changeable), `reason`.
struct AIStatus: Decodable, Sendable, Equatable {
    var ai: Bool?
    var voice: Bool?
    var receiptsAi: Bool?
    var household: Bool?
    var personal: Bool?
    var locked: Bool?
    var reason: String?

    init(ai: Bool? = nil, voice: Bool? = nil, receiptsAi: Bool? = nil, household: Bool? = nil, personal: Bool? = nil, locked: Bool? = nil, reason: String? = nil) {
        self.ai = ai; self.voice = voice; self.receiptsAi = receiptsAi
        self.household = household; self.personal = personal; self.locked = locked; self.reason = reason
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        // `ai` may be a bool or an object { enabled, household, personal, locked }
        if let b = c.first(Bool.self, "ai") { ai = b }
        else if let o = c.first(JSONValue.self, "ai") {
            ai = o.first("enabled", "on", "available")?.bool
            household = o["household"]?.bool
            personal = o["personal"]?.bool
            locked = o["locked"]?.bool
            reason = o["reason"]?.string
        }
        voice = c.first(Bool.self, "voice")
        receiptsAi = c.first(Bool.self, "receiptsAi")
        household = household ?? c.first(Bool.self, "aiHousehold", "household")
        personal = personal ?? c.first(Bool.self, "aiPersonal", "personal")
        locked = locked ?? c.first(Bool.self, "aiLocked", "locked", "kidLock")
        reason = reason ?? c.first(String.self, "aiReason", "reason")
    }
}
