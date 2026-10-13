import Foundation

/// Constants and small helpers shared by the app and the share extension.
enum SharedConfig {
    static let appGroup = "group.de.heidrichdigital.tohuus"
    static let keychainService = "de.heidrichdigital.tohuus"
    /// The two public addresses in one place (docs/domain.md). A domain change: these two lines, the associated
    /// domain in ios/project.yml and a new build.
    static let cloudURL = URL(string: "https://cloud.tohuus.heidrich-digital.de")!
    /// the website: help pages, legal texts, Ratgeber
    static let siteURL = URL(string: "https://tohuus.heidrich-digital.de")!
    static let termsURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    /// UserDefaults shared through the App Group; falls back to the standard defaults when the group is unavailable
    /// (unsigned simulator builds).
    static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    /// Folder shared with the extension (upload queue). Falls back to the app's own Application Support folder.
    static var sharedContainer: URL {
        if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            return url
        }
        let fallback = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: fallback, withIntermediateDirectories: true)
        return fallback
    }
}

/// Localised string from Localizable.xcstrings. The English text is the key (same rule as the web app).
func L(_ key: String) -> String {
    Bundle.main.localizedString(forKey: key, value: key, table: "Localizable")
}

/// Localised format string: `LF("%d open", n)`.
func LF(_ key: String, _ args: CVarArg...) -> String {
    String(format: L(key), locale: Locale.current, arguments: args)
}

/// What the app needs to talk to the server; stored in shared defaults (URL, household) and the keychain (token).
struct SessionInfo: Codable, Equatable, Sendable {
    var serverURL: URL
    var mode: String // "cloud" | "selfhost"
    var householdId: String?
    var deviceName: String?

    var isCloud: Bool { mode == "cloud" }

    private static let key = "session.info"
    private static let tokenAccount = "session.token"

    static func load() -> SessionInfo? {
        guard let data = SharedConfig.defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(SessionInfo.self, from: data)
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) { SharedConfig.defaults.set(data, forKey: Self.key) }
    }

    static func clear() {
        SharedConfig.defaults.removeObject(forKey: key)
        Keychain.delete(account: tokenAccount)
    }

    static var token: String? {
        get { Keychain.read(account: tokenAccount) }
        set {
            if let newValue { Keychain.save(newValue, account: tokenAccount) } else { Keychain.delete(account: tokenAccount) }
        }
    }
}
