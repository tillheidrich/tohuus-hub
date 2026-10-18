import Foundation

// Haushaltswissen – "Was ToHuus sich merkt" as cards (server/routes/knowledge.ts, docs/knowledge.md). Same screen as
// the web (web/src/pages/Knowledge.tsx): subject · property · value, history, only me / whole household, for guests.

struct KnowledgeHistory: Decodable, Sendable, Hashable, Identifiable {
    /// position in the stored history – for restore / remove
    var i: Int
    var text: String
    var value: String?
    var until: String?
    var at: String?
    var by: String?
    var id: String { "\(i)-\(at ?? until ?? "")" }
    var shown: String { value ?? text }
}

struct KnowledgeMay: Decodable, Sendable, Hashable {
    var edit: Bool?
    var share: Bool?
    var makePrivate: Bool?
}

struct KnowledgeEntry: Decodable, Sendable, Hashable, Identifiable {
    var id: Int
    var subject: String?
    var subjectRef: String?
    /// person | place | product | free
    var subjectKind: String?
    var property: String?
    var value: String?
    var text: String
    var note: String?
    var photo: String?
    var structured: Bool?
    /// household | me
    var visibility: String?
    var guests: Bool?
    var sensitive: Bool?
    var origin: String?
    var author: String?
    var mine: Bool?
    var createdAt: String?
    var updatedAt: String?
    var updatedBy: String?
    @Lossy var history: [KnowledgeHistory]
    var may: KnowledgeMay?

    var onlyMe: Bool { visibility == "me" }
    var isCard: Bool { structured == true || property != nil }
}

struct KnowledgeGroup: Decodable, Sendable, Hashable, Identifiable {
    var key: String
    var title: String?
    var kind: String?
    var ref: String?
    @Lossy var entries: [KnowledgeEntry]
    var id: String { key }
}

struct KnowledgeSubject: Decodable, Sendable, Hashable, Identifiable {
    var ref: String
    var name: String
    var kind: String
    var id: String { ref }
}

struct KnowledgeList: Decodable, Sendable {
    @Lossy var entries: [KnowledgeEntry]
    @Lossy var groups: [KnowledgeGroup]
    @Lossy var subjects: [KnowledgeSubject]
}

/// what a write answered: done (with the card and an undo token), or a question first
enum KnowledgeWrite: Sendable {
    case done(entry: KnowledgeEntry?, before: String?, undo: String?)
    /// the household's one-time consent for health data (409 health_consent)
    case needsConsent
    /// sharing a health entry with everyone (409 health_share)
    case needsShareConsent
}

/// POST /api/knowledge/say – one sentence from "Schreib es ToHuus"
enum KnowledgeSay: Sendable {
    case saved(entry: KnowledgeEntry, before: String?, undo: String?)
    case answer([KnowledgeEntry])
    case confirm(action: String, entries: [KnowledgeEntry])
    case form(subject: String?, subjectRef: String?, property: String?, value: String?, text: String)
    case needsConsent
}

extension APIClient {
    /// GET /api/knowledge?ref= – cards grouped by subject (guests: only what is shared with guests)
    func knowledge(ref: String? = nil) async throws -> KnowledgeList {
        try await get("api/knowledge", query: ref.map { [URLQueryItem(name: "ref", value: $0)] } ?? [], as: KnowledgeList.self)
    }

    func knowledgeEntry(_ id: Int) async throws -> KnowledgeEntry { try await get("api/knowledge/\(id)", as: KnowledgeEntry.self) }

    private func decodeValue<T: Decodable>(_ v: JSONValue?, as: T.Type) -> T? {
        guard let v, let data = try? JSONEncoder().encode(v) else { return nil }
        return try? JSONCoding.decoder().decode(T.self, from: data)
    }

    private func knowledgeWrite(_ method: String, _ path: String, _ body: [String: Any]) async throws -> KnowledgeWrite {
        let r = try await sendRaw(method, path, json: body, timeout: 30)
        if (200..<300).contains(r.status) {
            return .done(entry: decodeValue(r.body["entry"], as: KnowledgeEntry.self), before: r.body["before"]?["text"]?.string, undo: r.body["undo"]?.string)
        }
        if r.status == 409, r.body["code"]?.string == "health_consent" { return .needsConsent }
        if r.status == 409, r.body["code"]?.string == "health_share" { return .needsShareConsent }
        if r.status == 404 { throw APIError.notFound }
        throw APIError.server(status: r.status, message: r.body["error"]?.string ?? HTTPURLResponse.localizedString(forStatusCode: r.status))
    }

    /// POST /api/knowledge { subject?, subjectRef?, property?, value?, text?, note?, visibility?, guests?, consent?, origin }
    func knowledgeCreate(_ body: [String: Any]) async throws -> KnowledgeWrite {
        var b = body
        b["origin"] = "app"
        return try await knowledgeWrite("POST", "api/knowledge", b)
    }

    /// PATCH /api/knowledge/:id – value, subject, property, text, note, visibility, guests (old values go into the history)
    func knowledgeUpdate(_ id: Int, _ body: [String: Any]) async throws -> KnowledgeWrite {
        try await knowledgeWrite("PATCH", "api/knowledge/\(id)", body)
    }

    /// DELETE /api/knowledge/:id → undo token
    func knowledgeDelete(_ id: Int) async throws -> String? {
        let r = try await sendRaw("DELETE", "api/knowledge/\(id)", json: [:], timeout: 30)
        if r.status == 404 { throw APIError.notFound }
        guard (200..<300).contains(r.status) else { throw APIError.server(status: r.status, message: r.body["error"]?.string ?? "") }
        return r.body["undo"]?.string
    }

    /// POST /api/knowledge/:id/history/:i/restore – the earlier value back
    func knowledgeRestore(_ id: Int, _ i: Int) async throws -> KnowledgeWrite { try await knowledgeWrite("POST", "api/knowledge/\(id)/history/\(i)/restore", [:]) }

    /// DELETE /api/knowledge/:id/history/:i – one earlier value removed
    func knowledgeRemoveHistory(_ id: Int, _ i: Int) async throws -> KnowledgeWrite { try await knowledgeWrite("DELETE", "api/knowledge/\(id)/history/\(i)", [:]) }

    /// POST /api/knowledge/:id/photo (multipart "image")
    func knowledgePhoto(_ id: Int, jpeg: Data) async throws {
        var mp = Multipart()
        mp.addFile("image", filename: "knowledge-\(id).jpg", mimeType: "image/jpeg", data: jpeg)
        _ = try await upload("api/knowledge/\(id)/photo", multipart: mp, as: Ignored.self, timeout: 120)
    }

    func knowledgeRemovePhoto(_ id: Int) async throws { _ = try await send("DELETE", "api/knowledge/\(id)/photo", as: Ignored.self) }

    /// POST /api/knowledge/say { text, visibility?, consent? } – read without AI
    func knowledgeSay(_ text: String, visibility: String?, consent: Bool = false) async throws -> KnowledgeSay {
        var body: [String: Any] = ["text": text, "origin": "app"]
        if let visibility { body["visibility"] = visibility }
        if consent { body["consent"] = true }
        let r = try await sendRaw("POST", "api/knowledge/say", json: body, timeout: 30)
        if r.status == 409, r.body["code"]?.string == "health_consent" { return .needsConsent }
        guard (200..<300).contains(r.status) else { throw APIError.server(status: r.status, message: r.body["error"]?.string ?? HTTPURLResponse.localizedString(forStatusCode: r.status)) }
        let entries = decodeValue(r.body["entries"], as: [KnowledgeEntry].self) ?? []
        switch r.body["kind"]?.string {
        case "saved":
            if let e = decodeValue(r.body["entry"], as: KnowledgeEntry.self) { return .saved(entry: e, before: r.body["before"]?["text"]?.string, undo: r.body["undo"]?.string) }
            return .answer([])
        case "answer": return .answer(entries)
        case "confirm": return .confirm(action: r.body["action"]?.string ?? "delete", entries: entries)
        default:
            let d = r.body["draft"]
            return .form(subject: d?["subject"]?.string, subjectRef: d?["subjectRef"]?.string, property: d?["property"]?.string, value: d?["value"]?.string, text: d?["text"]?.string ?? text)
        }
    }
}

// MARK: - Import and export (server/lib/knowledge-io.ts, docs/knowledge.md › Import und Export)

struct KnowledgeImportItem: Decodable, Sendable, Hashable, Identifiable {
    var i: Int
    var line: Int?
    /// card | line
    var kind: String
    var subject: String?
    var subjectKnown: Bool?
    var property: String?
    var value: String?
    var text: String?
    var note: String?
    var visibility: String?
    var sensitive: Bool?
    /// create | update | skip | blocked
    var action: String
    var before: String?
    /// unchanged | exists | twice | secret | limit | health
    var reason: String?
    var id: Int { i }
    var canTake: Bool { action == "create" || action == "update" }
    var shown: String { kind == "card" ? "\(subject ?? "") · \(property ?? ""): \(value ?? "")" : (text ?? "") }
}

struct KnowledgeImportCounts: Decodable, Sendable, Hashable {
    var create: Int
    var update: Int
    var skip: Int
    var blocked: Int
}

struct KnowledgeImportPreview: Decodable, Sendable {
    @Lossy var items: [KnowledgeImportItem]
    var counts: KnowledgeImportCounts
    var truncated: Bool?
    var needsHealthConsent: Bool?
}

struct KnowledgeImportResult: Decodable, Sendable {
    var created: Int
    var updated: Int
    var skipped: Int?
    var undo: String?
}

/// a picked file (bytes, checked by the server) or pasted text
struct KnowledgeImportSource: Sendable {
    var filename: String?
    var data: Data?
    var text: String?
}

enum KnowledgeImportOutcome: Sendable {
    case done(KnowledgeImportResult)
    /// the household's one-time consent for health data (409 health_consent)
    case needsConsent
}

extension APIClient {
    static let knowledgeImportMaxBytes = 512 * 1024

    private func knowledgeImportCall(_ path: String, _ src: KnowledgeImportSource, fields: [String: Any]) async throws -> Data {
        if let data = src.data {
            var mp = Multipart()
            for (k, v) in fields {
                if let s = v as? String { mp.addField(k, s) } else if let b = v as? Bool { mp.addField(k, b ? "true" : "false") } else if let a = v as? [Int] {
                    mp.addField(k, "[" + a.map(String.init).joined(separator: ",") + "]")
                }
            }
            mp.addFile("file", filename: src.filename ?? "import.txt", mimeType: "text/plain", data: data)
            var req = try request("POST", path, timeout: 60)
            req.setValue(mp.contentType, forHTTPHeaderField: "Content-Type")
            return try await perform(req, body: mp.finished())
        }
        var body = fields
        body["text"] = src.text ?? ""
        if let name = src.filename { body["filename"] = name }
        let r = try await sendRaw("POST", path, json: body, timeout: 60)
        if (200..<300).contains(r.status) { return try JSONEncoder().encode(r.body) }
        throw APIError.server(status: r.status, message: r.body["error"]?.string ?? HTTPURLResponse.localizedString(forStatusCode: r.status))
    }

    /// POST /api/knowledge/import/preview – what would be created, changed, skipped (nothing is saved)
    func knowledgeImportPreview(_ src: KnowledgeImportSource, target: String, update: Bool) async throws -> KnowledgeImportPreview {
        let data = try await knowledgeImportCall("api/knowledge/import/preview", src, fields: ["target": target, "onDuplicate": update ? "update" : "skip"])
        return try decode(KnowledgeImportPreview.self, from: data)
    }

    /// POST /api/knowledge/import – the picked rows; health rows need the household's consent first
    func knowledgeImport(_ src: KnowledgeImportSource, target: String, update: Bool, pick: [Int], consent: Bool) async throws -> KnowledgeImportOutcome {
        var fields: [String: Any] = ["target": target, "onDuplicate": update ? "update" : "skip", "pick": pick]
        if consent { fields["consent"] = true }
        do {
            let data = try await knowledgeImportCall("api/knowledge/import", src, fields: fields)
            return .done(try decode(KnowledgeImportResult.self, from: data))
        } catch let APIError.server(status, _) where status == 409 {
            return .needsConsent
        }
    }

    /// GET /api/knowledge/export?format=md|csv|json&ids= → a file in the temporary folder, for the share sheet
    func knowledgeExport(format: String, ids: [Int]? = nil) async throws -> URL {
        var q = [URLQueryItem(name: "format", value: format)]
        if let ids, !ids.isEmpty { q.append(URLQueryItem(name: "ids", value: ids.map(String.init).joined(separator: ","))) }
        let data = try await perform(try request("GET", "api/knowledge/export", query: q, timeout: 60))
        let day = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(L("tohuus-knowledge"))-\(day).\(format)")
        try? FileManager.default.removeItem(at: url)
        try data.write(to: url, options: .atomic)
        return url
    }
}
