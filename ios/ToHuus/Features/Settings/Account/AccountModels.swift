import Foundation

// Models and endpoints for Mehr › Mein Konto & Sicherheit, Haushalt, Darstellung, Region, "Was nutzt ihr?",
// KI & Zugänge (web: pages/AuthSettings.tsx, AppearanceSettings.tsx, RegionSettings.tsx, Modules.tsx, AiSettings.tsx,
// Settings.tsx › Access, Memory.tsx › AssistantPrivacyCard, Recognition.tsx). docs/ios-native-account.md.

/// GET /api/auth/me – the signed-in member's sign-in methods. In ToHuus Cloud the passkeys and the password are the
/// account's (routes/cloud.ts wraps the answer and adds `confirm`).
struct AccountInfo: Decodable, Sendable {
    var name: String?
    var role: String?
    var email: String?
    var emailPending: String?
    var hasPassword: Bool?
    @Lossy var passkeys: [Passkey]
    var totp: Bool?
    var recoveryLeft: Int?
    var pin: Bool?
    var sso: SSO?
    var mail: Bool?
    var policy: Policy?
    /// ToHuus Cloud: how a new passkey is confirmed – "password" or "email" (a code from a mail in the app)
    var confirm: String?

    struct Passkey: Decodable, Sendable, Identifiable, Hashable {
        var id: String
        var name: String?
        var deviceType: String?
        /// 0/1 from SQLite
        var backedUp: JSONValue?
        var createdAt: String?
        var lastUsedAt: String?

        var synced: Bool { backedUp?.bool ?? false }
    }

    struct SSO: Decodable, Sendable, Hashable {
        var label: String?
        var linked: Bool?
    }

    struct Policy: Decodable, Sendable, Hashable {
        var magicLink: Bool?
        var passkeys: Bool?
        /// "all" | "admins"
        var passwordFor: String?
        var requireTotpAdmins: Bool?
        var pinSwitch: Bool?
    }

    var isAdmin: Bool { role == "admin" }
    var passwordOff: Bool { policy?.passwordFor == "admins" && !isAdmin }
    var passkeysAllowed: Bool { policy?.passkeys ?? true }

    /// "Du kannst dich anmelden mit: …" (web: SignInSummary)
    var ways: [String] {
        var w: [String] = []
        if !passkeys.isEmpty { w.append(L("Passkey")) }
        if email != nil, policy?.magicLink == true, mail == true { w.append(L("E-mail link")) }
        if hasPassword == true, policy?.passwordFor != "admins" || isAdmin { w.append(totp == true ? L("Password + code") : L("Password")) }
        if sso?.linked == true, let l = sso?.label { w.append(l) }
        return w
    }
}

/// GET /api/auth/sessions – browsers signed in with this account (self-hosted: member sessions with a device label;
/// ToHuus Cloud: account sessions with the raw user agent).
struct BrowserSession: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var current: Bool?
    var device: String?
    var ua: String?
    var ip: String?
    var method: String?
    var methodLabel: String?
    var sharedName: String?
    var pin: Bool?
    var createdAt: String?
    var lastSeenAt: String?

    /// "Safari auf iPhone" – the server's label, or a guess from the user agent (cloud)
    var label: String {
        if let device, !device.isEmpty { return device }
        let u = ua ?? ""
        let os = u.contains("iPhone") ? "iPhone" : u.contains("iPad") ? "iPad" : u.contains("Android") ? "Android"
            : u.contains("Mac OS") ? "Mac" : u.contains("Windows") ? "Windows" : u.contains("Linux") ? "Linux" : nil
        let browser = u.contains("Edg/") ? "Edge" : u.contains("Firefox") ? "Firefox" : u.contains("Chrome") ? "Chrome"
            : u.contains("Safari") ? "Safari" : nil
        switch (browser, os) {
        case let (b?, o?): return LF("%@ on %@", b, o)
        case let (b?, nil): return b
        case let (nil, o?): return o
        default: return L("Browser")
        }
    }

    var symbol: String {
        let l = label
        if l.contains("iPhone") || l.contains("Android") { return "iphone" }
        if l.contains("iPad") { return "ipad" }
        return "desktopcomputer"
    }
}

/// POST /api/auth/me/totp/setup
struct TotpSetup: Decodable, Sendable, Identifiable {
    var secret: String
    var uri: String
    var id: String { secret }
}

/// GET /api/appearance
struct AppearanceInfo: Decodable, Sendable {
    /// light | dark | system
    var household: String?
    var userChoice: Bool?
    var mine: String?
    /// what this member sees right now
    var theme: String?
}

/// GET /api/region
struct RegionInfo: Decodable, Sendable {
    var code: String
    var name: String?
    var currency: String
    var currencySymbol: String?
    var locale: String
    /// metric | us
    var units: String?
    var weekStartDay: Int?
    @Lossy var typicalStores: [String]
    var receiptGrammar: String?
    var customised: Bool?
    var options: Options?
    /// PATCH: stores put into store mode with a new region
    var storesAdded: [String]?

    struct Options: Decodable, Sendable {
        @Lossy var regions: [RegionOption]
        @Lossy var currencies: [String]
        @Lossy var locales: [String]
    }

    struct RegionOption: Decodable, Sendable, Identifiable, Hashable {
        var code: String
        var name: String
        var currency: String?
        var locale: String?
        var id: String { code }
    }
}

/// GET /api/settings – the parts this area needs
struct HouseholdSettings: Decodable, Sendable {
    var household: String?
    var language: String?
    var baseUrl: String?
    var ai: AI?
    var features: Features?

    struct AI: Decodable, Sendable { var healthShare: Bool? }
    struct Features: Decodable, Sendable {
        var vision: Bool?
        var email: Bool?
        var visionModel: String?
    }
}

/// GET /api/oauth/connections – this person's assistants signed in via OAuth (Claude, ChatGPT …)
struct OAuthConnections: Decodable, Sendable {
    @Lossy var connections: [Connection]
    var mcpUrl: String?
    var mcp: Bool?

    struct Connection: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var client: String?
        @Lossy var scopes: [String]
        var createdAt: String?
        var lastUsedAt: String?

        static func == (a: Connection, b: Connection) -> Bool { a.id == b.id }
        func hash(into h: inout Hasher) { h.combine(id) }
    }
}

/// GET /api/tokens (admins) – machine accesses: MCP, Home Assistant, full API
struct AccessToken: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String?
    var prefix: String?
    /// mcp | ha | full
    var scope: String?
    var createdAt: String?
    var lastUsedAt: String?
}

/// POST /api/tokens
struct CreatedToken: Decodable, Sendable {
    var token: String
    var id: Int?
}

extension APIClient {
    func accountInfo() async throws -> AccountInfo { try await get("api/auth/me") }
    func browserSessions() async throws -> [BrowserSession] { try await get("api/auth/sessions", as: Lossy<BrowserSession>.self).wrappedValue }
    func householdSettings() async throws -> HouseholdSettings { try await get("api/settings") }
    func appearance() async throws -> AppearanceInfo { try await get("api/appearance") }
    func region() async throws -> RegionInfo { try await get("api/region") }

}
