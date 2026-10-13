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
        // until first unlock (not .complete): Siri can add to the list from the lock screen while offline
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true,
                                                 attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: base.path)
        return base
    }

    private var listURL: URL { Self.folder.appendingPathComponent("shop-\(key).json") }
    private var opsURL: URL { Self.folder.appendingPathComponent("ops-\(key).json") }

    func saveSnapshot(_ data: Data) {
        try? data.write(to: listURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func loadSnapshot() -> ShopList? {
        guard let data = try? Data(contentsOf: listURL) else { return nil }
        return try? JSONCoding.decoder().decode(ShopList.self, from: data)
    }

    func saveOps(_ ops: [PendingOp]) {
        guard let data = try? JSONEncoder().encode(ops) else { return }
        try? data.write(to: opsURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func loadOps() -> [PendingOp] {
        guard let data = try? Data(contentsOf: opsURL) else { return [] }
        do {
            return try JSONDecoder().decode([PendingOp].self, from: data)
        } catch {
            // a model change between builds: say so in the error log instead of losing the queue silently
            let message = "Offline queue could not be read: \(error.localizedDescription)"
            Task { await ErrorLog.shared.record(kind: "app", message: message) }
            return []
        }
    }

    /// Sign-out: forget everything stored for any household.
    static func wipeAll() {
        try? FileManager.default.removeItem(at: folder)
    }
}
