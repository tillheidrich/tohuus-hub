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
