import Foundation

/// The app's error log (docs/error-log.md): server errors (5xx) and answers the app could not read are kept on the
/// device (last 200, Application Support, no list or receipt content) and sent to the server's error log
/// (`POST /api/diag/errors`), where the developer finds them by time or by the code the person saw. Settings ›
/// Hilfe › Fehlerprotokoll shows the local list and shares it as a text file. Compiled into the iPhone app and the
/// Watch app.
actor ErrorLog {
    static let shared = ErrorLog()

    struct Entry: Codable, Sendable, Identifiable, Hashable {
        var id = UUID()
        var at = Date()
        /// http | decoding | network | app
        var kind: String
        var message: String
        var route: String?
        var status: Int?
        var sent = false
    }

    private var entries: [Entry] = []
    private var loaded = false
    private var flushing = false
    /// the server to report to – set by the app when a session exists
    private var target: (base: URL, token: String?, household: String?)?

    private var file: URL? {
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("error-log.json")
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let file, let data = try? Data(contentsOf: file), let list = try? JSONDecoder().decode([Entry].self, from: data) { entries = list }
    }

    private func save() {
        guard let file, let data = try? JSONEncoder().encode(entries) else { return }
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func use(base: URL, token: String?, household: String?) { target = (base, token, household) }

    /// Remember an error and send it soon (never throws, never blocks the caller).
    func record(kind: String, message: String, route: String? = nil, status: Int? = nil) {
        load()
        let clean = String(message.prefix(500))
        // the same error again within a minute is not news
        if let last = entries.last, last.kind == kind, last.message == clean, last.route == route, Date().timeIntervalSince(last.at) < 60 { return }
        entries.append(Entry(kind: kind, message: clean, route: route.map { String($0.prefix(200)) }, status: status))
        if entries.count > 200 { entries.removeFirst(entries.count - 200) }
        save()
        Task { await self.flush() }
    }

    func all() -> [Entry] {
        load()
        return entries.reversed()
    }

    func clear() {
        entries = []
        save()
    }

    /// Plain text for "Teilen" (mail, Messages, Files).
    func text() -> String {
        load()
        let f = ISO8601DateFormatter()
        let head = "ToHuus \(Self.appVersion) · \(Self.platform)\n\(entries.count) entries\n"
        return head + entries.reversed().map { e in
            "\(f.string(from: e.at)) [\(e.kind)\(e.status.map { " \($0)" } ?? "")] \(e.route ?? "-")\n  \(e.message)"
        }.joined(separator: "\n")
    }

    /// Send what has not been sent yet (at most 20 per call; the rest goes next time).
    func flush() async {
        load()
        guard !flushing, let target else { return }
        let pending = entries.enumerated().filter { !$0.element.sent }.prefix(20)
        guard !pending.isEmpty else { return }
        flushing = true
        defer { flushing = false }
        #if os(watchOS)
        let source = "watch"
        #else
        let source = "ios"
        #endif
        let body: [String: Any] = [
            "source": source,
            "errors": pending.map { p -> [String: Any] in
                var e: [String: Any] = ["message": p.element.message, "kind": p.element.kind, "appVersion": Self.appVersion, "platform": Self.platform]
                if let r = p.element.route { e["route"] = r }
                if let s = p.element.status { e["status"] = s }
                return e
            },
        ]
        var req = URLRequest(url: target.base.appendingPathComponent("api/diag/errors"))
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let t = target.token { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        if let h = target.household { req.setValue(h, forHTTPHeaderField: "X-Household") }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        // a plain URLSession call – never through APIClient, so a failing report cannot report itself
        guard let (_, resp) = try? await URLSession.shared.upload(for: req, from: data),
              let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return }
        // by id: while sending, new entries may have come in and old ones dropped out
        let sentIds = Set(pending.map { $0.element.id })
        for i in entries.indices where sentIds.contains(entries[i].id) { entries[i].sent = true }
        save()
    }

    static var appVersion: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(v) (\(b))"
    }

    static var platform: String {
        #if os(watchOS)
        return "watchOS \(ProcessInfo.processInfo.operatingSystemVersionString)"
        #else
        return "iOS \(ProcessInfo.processInfo.operatingSystemVersionString)"
        #endif
    }
}
