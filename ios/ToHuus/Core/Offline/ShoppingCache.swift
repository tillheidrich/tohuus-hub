import Foundation

/// Local, file-protected storage for the offline list: the last server snapshot (raw JSON) and the op queue,
/// per household. Lives in Application Support (not shared with the extension).
struct ShoppingCache: Sendable {
    let key: String

    init(householdKey: String) {
        key = householdKey.replacingOccurrences(of: "/", with: "_")
    }

    static var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ToHuus", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true,
                                                 attributes: [.protectionKey: FileProtectionType.complete])
        return base
    }

    private var listURL: URL { Self.folder.appendingPathComponent("shop-\(key).json") }
    private var opsURL: URL { Self.folder.appendingPathComponent("ops-\(key).json") }

    func saveSnapshot(_ data: Data) {
        try? data.write(to: listURL, options: [.atomic, .completeFileProtection])
    }

    func loadSnapshot() -> ShopList? {
        guard let data = try? Data(contentsOf: listURL) else { return nil }
        return try? JSONCoding.decoder().decode(ShopList.self, from: data)
    }

    func saveOps(_ ops: [PendingOp]) {
        guard let data = try? JSONEncoder().encode(ops) else { return }
        try? data.write(to: opsURL, options: [.atomic, .completeFileProtection])
    }

    func loadOps() -> [PendingOp] {
        guard let data = try? Data(contentsOf: opsURL) else { return [] }
        return (try? JSONDecoder().decode([PendingOp].self, from: data)) ?? []
    }

    /// Sign-out: forget everything stored for any household.
    static func wipeAll() {
        try? FileManager.default.removeItem(at: folder)
    }
}
