import Foundation

/// What the home-screen widget shows: written by the app into the App Group whenever the list changes.
struct WidgetSnapshot: Codable, Sendable, Equatable {
    var open: Int
    var items: [String]
    var household: String?
    var updatedAt: Date
    /// what ToHuus remembers as probably due next (watch complication, Smart Stack)
    var nextDue: String? = nil

    static let placeholder = WidgetSnapshot(open: 3, items: ["Milch", "Brot", "Bananen"], household: nil, updatedAt: Date())

    private static var url: URL { SharedConfig.sharedContainer.appendingPathComponent("widget-snapshot.json") }

    static func load() -> WidgetSnapshot? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return try? d.decode(WidgetSnapshot.self, from: data)
    }

    func save() {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        guard let data = try? e.encode(self) else { return }
        try? data.write(to: Self.url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func clear() { try? FileManager.default.removeItem(at: url) }
}
