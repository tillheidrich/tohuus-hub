import CryptoKit
import Foundation
import Observation
import os

/// The last answer of a few read-only screens (Heute, Aufgaben, Vorrat, Kochen/Wochenplan, Hausinfo), kept on the
/// device so a cold start without a connection, or with the server down, still shows something instead of an error.
///
/// - Only the GET paths in `allowed` are stored, as raw JSON, one file per path (+ query) and household.
/// - Only the household signed in right now: `activate(_:)` (sign-in, household switch) drops every other one,
///   `wipeAll()` (sign-out) drops everything.
/// - Files are protected until first unlock and kept out of backups. House-guide codes are never written:
///   the `codes` list is emptied before saving (their values only ever come from an explicit reveal anyway).
/// - The shopping list has its own cache and queue (ShoppingCache, OpQueue) and is not handled here.
struct ResponseCache: Sendable {
    /// GET paths whose last answer may be kept (without the leading slash, without the query)
    static let allowed: Set<String> = [
        "api/me", "api/today",
        "api/care", "api/care/recent",
        "api/products", "api/locations", "api/categories",
        "api/plan", "api/plan2/week", "api/claims", "api/shop/members",
        "api/recipes", "api/cook/ideas", "api/recipes/suggest",
        "api/house-guide",
    ]
    /// answers that must lose parts before they touch the disk
    private static let stripKeys: [String: [String]] = ["api/house-guide": ["codes"]]

    let household: String
    /// path without query, e.g. "api/care" – also the key for the offline note (OfflineReads)
    let path: String
    let query: String

    /// nil when this request is not one we keep.
    init?(household: String, path rawPath: String, query: [URLQueryItem]) {
        var p = rawPath.hasPrefix("/") ? String(rawPath.dropFirst()) : rawPath
        var q = ""
        if let i = p.firstIndex(of: "?") {
            q = String(p[p.index(after: i)...])
            p = String(p[..<i])
        }
        guard Self.allowed.contains(p) else { return nil }
        let extra = query.map { "\($0.name)=\($0.value ?? "")" }.joined(separator: "&")
        self.household = Self.slug(household)
        self.path = p
        self.query = [q, extra].filter { !$0.isEmpty }.joined(separator: "&")
    }

    // MARK: files

    static var folder: URL {
        let base = ShoppingCache.folder.appendingPathComponent("reads", isDirectory: true)
        if !FileManager.default.fileExists(atPath: base.path) {
            try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true,
                                                     attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var url = base
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
        }
        return base
    }

    /// Whose answers these are: household plus a short fingerprint of the sign-in, so another member signing in to
    /// the same household on this iPhone never sees the previous person's private tasks offline.
    static func owner(household: String, token: String?) -> String {
        let digest = SHA256.hash(data: Data((token ?? "").utf8)).prefix(6).map { String(format: "%02x", $0) }.joined()
        return household + "-" + digest
    }

    private static func slug(_ s: String) -> String {
        let ok = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        let out = String(s.unicodeScalars.map { ok.contains($0) ? Character($0) : "_" })
        return String(out.prefix(120))
    }

    private var dir: URL { Self.folder.appendingPathComponent(household, isDirectory: true) }
    /// the newest answer for this path, whatever the query (the week plan of last Monday is better than nothing)
    private var latestURL: URL { dir.appendingPathComponent(Self.slug(path) + ".json") }
    private var exactURL: URL? { query.isEmpty ? nil : dir.appendingPathComponent(Self.slug(path) + "@" + Self.slug(query) + ".json") }

    func save(_ data: Data) {
        guard Self.isActive(household) else { return }
        guard let body = strip(data) else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                 attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        for url in [latestURL, exactURL].compactMap({ $0 }) {
            try? body.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    /// The stored answer and when it was saved; the exact query first, then the newest for the path.
    func load() -> (data: Data, savedAt: Date)? {
        guard Self.isActive(household) else { return nil }
        for url in [exactURL, latestURL].compactMap({ $0 }) {
            guard let data = try? Data(contentsOf: url) else { continue }
            let at = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? Date()
            return (data, at)
        }
        return nil
    }

    /// Removes what must never be on the disk (house-guide codes). nil when the answer can't be cleaned safely.
    private func strip(_ data: Data) -> Data? {
        guard let keys = Self.stripKeys[path] else { return data }
        guard var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        for k in keys where obj[k] != nil { obj[k] = [Any]() }
        return try? JSONSerialization.data(withJSONObject: obj)
    }

    // MARK: whose cache

    private static let active = OSAllocatedUnfairLock<String?>(initialState: nil)

    private static func isActive(_ household: String) -> Bool {
        active.withLock { $0 == nil || $0 == household }
    }

    /// Sign-in or household switch: only this household's answers stay on the device.
    static func activate(household raw: String) {
        let key = slug(raw)
        active.withLock { $0 = key }
        let fm = FileManager.default
        for url in (try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [] where url.lastPathComponent != key {
            try? fm.removeItem(at: url)
        }
        Task { @MainActor in OfflineReads.shared.reset() }
    }

    /// Sign-out: forget every stored answer.
    static func wipeAll() {
        // nothing is stored again until the next sign-in activates a household (a request still running can't write)
        active.withLock { $0 = "\u{0}signed-out" }
        try? FileManager.default.removeItem(at: folder)
        Task { @MainActor in OfflineReads.shared.reset() }
    }

    /// Errors after which the last stored answer is shown: no connection, timeout, DNS, and the server (or the proxy
    /// in front of it) failing – exactly the "server down" case, not only "phone offline".
    static func shouldFallBack(_ error: APIError) -> Bool {
        switch error {
        case .offline: return true
        case .server(let status, _): return status == 0 || status >= 500
        default: return false
        }
    }
}

/// Which screens show stored answers right now, and from when. Views show "Offline · as of 14:32" from it
/// (OfflineNote) instead of an error.
@MainActor
@Observable
final class OfflineReads {
    static let shared = OfflineReads()
    private(set) var stale: [String: Date] = [:]

    func mark(_ path: String, savedAt: Date?) {
        if let savedAt { stale[path] = savedAt } else if stale[path] != nil { stale[path] = nil }
    }

    func reset() { stale = [:] }

    /// The oldest stored answer among these paths, nil when all of them are fresh.
    func since(_ paths: [String]) -> Date? {
        paths.compactMap { stale[$0] }.min()
    }
}
