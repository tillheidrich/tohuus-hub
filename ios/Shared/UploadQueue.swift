import Foundation

/// Something shared into ToHuus that still has to reach the server: receipt files, a link or text.
struct PendingUpload: Codable, Identifiable, Sendable, Equatable {
    enum Kind: String, Codable, Sendable { case receiptFiles, receiptURL, recipeURL, text }
    var id: String = UUID().uuidString
    var kind: Kind
    /// file names inside the queue folder (receiptFiles)
    var files: [QueuedFile] = []
    var url: String?
    var text: String?
    var createdAt: Date = Date()
    /// a Cookidoo link in ToHuus Cloud: the app shows the confirm sheet (ingredients only) instead of sending it
    var confirm: Bool?

    struct QueuedFile: Codable, Sendable, Equatable {
        var storedName: String
        var originalName: String
        var mimeType: String
    }
}

/// File-based queue in the App Group container, written by the share extension when offline, drained by the app.
enum UploadQueue {
    static var folder: URL {
        let url = SharedConfig.sharedContainer.appendingPathComponent("UploadQueue", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
                                                 attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return url
    }

    private static var indexURL: URL { folder.appendingPathComponent("queue.json") }

    static func all() -> [PendingUpload] {
        guard let data = try? Data(contentsOf: indexURL) else { return [] }
        return (try? JSONDecoder().decode([PendingUpload].self, from: data)) ?? []
    }

    private static func write(_ items: [PendingUpload]) {
        guard let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: indexURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Stores the payload files next to the index and appends the entry.
    static func enqueue(_ upload: PendingUpload, fileData: [Data] = []) {
        var item = upload
        for (i, data) in fileData.enumerated() where i < item.files.count {
            let url = folder.appendingPathComponent(item.files[i].storedName)
            try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        item.files = item.files.filter { FileManager.default.fileExists(atPath: folder.appendingPathComponent($0.storedName).path) }
        var items = all()
        items.append(item)
        write(items)
    }

    static func data(for file: PendingUpload.QueuedFile) -> Data? {
        try? Data(contentsOf: folder.appendingPathComponent(file.storedName))
    }

    static func remove(id: String) {
        var items = all()
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        for f in items[idx].files { try? FileManager.default.removeItem(at: folder.appendingPathComponent(f.storedName)) }
        items.remove(at: idx)
        write(items)
    }
}

/// Sends shared things to the server. Used by the extension directly and by the app when draining the queue.
struct ShareUploader: Sendable {
    let session: SessionInfo
    let token: String

    enum UploadError: Error { case offline, server(String), needsConfirm }

    private func request(_ path: String, method: String = "POST") -> URLRequest {
        var req = URLRequest(url: session.serverURL.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 60
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let h = session.householdId { req.setValue(h, forHTTPHeaderField: "X-Household") }
        return req
    }

    private func send(_ req: URLRequest, body: Data) async throws {
        let data: Data
        let resp: URLResponse
        do {
            (data, resp) = try await URLSession.shared.upload(for: req, from: body)
        } catch {
            throw UploadError.offline
        }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(code) {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            // Cookidoo in ToHuus Cloud: never fetched, the person confirms title + ingredients in the app
            if code == 409, obj?["code"] as? String == "cookidoo_confirm" { throw UploadError.needsConfirm }
            let msg = obj?["error"] as? String
            throw UploadError.server(msg ?? "HTTP \(code)")
        }
    }

    func upload(_ item: PendingUpload, files: [Data]) async throws {
        switch item.kind {
        case .receiptFiles:
            var mp = Multipart()
            for (i, f) in item.files.enumerated() where i < files.count {
                mp.addFile("files", filename: f.originalName, mimeType: f.mimeType, data: files[i])
            }
            var req = request("api/imports/upload")
            req.setValue(mp.contentType, forHTTPHeaderField: "Content-Type")
            try await send(req, body: mp.finished())
        case .text:
            var mp = Multipart()
            mp.addField("text", item.text ?? "")
            var req = request("api/imports/upload")
            req.setValue(mp.contentType, forHTTPHeaderField: "Content-Type")
            try await send(req, body: mp.finished())
        case .receiptURL, .recipeURL:
            var req = request(item.kind == .receiptURL ? "api/imports/url" : "api/recipes/import/url")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var json: [String: Any] = ["url": item.url ?? ""]
            // social links: the share-sheet caption often is the recipe
            if item.kind == .recipeURL, let t = item.text, !t.isEmpty { json["text"] = t }
            let body = try JSONSerialization.data(withJSONObject: json)
            try await send(req, body: body)
        }
    }
}
