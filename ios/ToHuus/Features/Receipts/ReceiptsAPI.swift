import Foundation

// Receipts and money, wave 3 (native parity with the web): receipt recognition on one import (web: QualityReport.tsx),
// who paid on an import (shop/forms.tsx WhoPaidPanel), the receipt address and the
// self-hosted receipt inbox (MailAddress.tsx, Retail.tsx), cupboard photos and text imports (Imports.tsx). Same endpoints
// as the web; models decoded with convertFromSnakeCase. (The recognition page and Bons/printers live in Settings.)

// MARK: - recognition (server/routes/quality.ts)

/// GET /api/quality/imports/:id – how one import was read.
struct RecognitionReport: Decodable, Sendable {
    var importId: Int?
    var kind: String?
    var shop: String?
    /// header | text | layout | learned | corrected | model | unknown
    var storeVia: String?
    var storeDetected: String?
    var storeLearnable: Bool?
    var sumMatches: Bool?
    var itemsSum: Double?
    var total: Double?
    var receiptDiscount: Double?
    @Lossy var lines: [LineGrade]
    var counts: Counts?
    var goods: Int?
    var rules: Int?
    /// receipt total minus the lines (nil when it adds up)
    var difference: Double?
    /// rows filled in from the total because the photo did not show them
    @Lossy var assumed: [Assumed]
    /// unmatched lines with a clean name: they become new products ("new", not "not recognised")
    var newLines: Int?
    /// "Read again with AI": available now, today's allowance (left nil = no daily limit)
    var ai: AIState?
    var aiUndo: Bool?
    var hasSource: Bool?

    struct LineGrade: Decodable, Sendable, Hashable {
        var id: Int
        /// learned | sure | suggested | unmatched | ignored | none
        var grade: String?
        var new: Bool?
        var corrected: Bool?
    }

    struct Assumed: Decodable, Sendable, Hashable {
        var kind: String
        var amount: Double
        var label: String {
            let a = String(format: "%.2f", amount).replacingOccurrences(of: ".", with: ",")
            return kind == "discount" ? LF("discount -%@", a) : LF("deposit %@", a)
        }
    }

    struct AIState: Decodable, Sendable {
        var available: Bool
        var left: Int?
        var perDay: Int?
        var paused: Bool?
    }

    struct Counts: Decodable, Sendable {
        var learned: Int?
        var sure: Int?
        var suggested: Int?
        var unmatched: Int?
        var ignored: Int?
    }

    func grade(of lineId: Int) -> String? { lines.first { $0.id == lineId }?.grade }
    func isNew(_ lineId: Int) -> Bool { lines.first { $0.id == lineId }?.new == true }
}

/// GET /api/quality/imports/:id/fixture?names=1|0 – the anonymised test file, built on request, sent nowhere.
struct RecognitionFixture: Decodable, Sendable {
    var filename: String
    var text: String
    @Lossy var removed: [Removed]
    var check: Check?
    /// text | lines
    var source: String?
    var chain: String?
    var issueUrl: String?
    var issueTruncated: Bool?
    var mailto: String?
    var mailTruncated: Bool?
    var mailTo: String?

    struct Removed: Decodable, Sendable, Hashable {
        var kind: String?
        var count: Int?
        var label: String
    }

    struct Check: Decodable, Sendable {
        var same: Bool
        var linesBefore: Int?
        var linesAfter: Int?
    }
}

struct StoreSetResult: Decodable, Sendable {
    var shop: String?
    var learned: Bool?
}

// MARK: - import: who paid, for whom (server/routes/list2.ts POST /imports/:id/split)

/// The fields of GET /api/imports/:id the who-paid panel needs (the shared ImportDetail model leaves them out).
struct ImportSplitInfo: Decodable, Sendable {
    var id: Int
    var actor: String?
    var paidBy: Int?
    var privateFor: Int?
    @Lossy var lines: [Line]

    struct Line: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var price: Double?
        var forUserId: Int?
        var forListId: Int?
    }
}

/// The parts of GET /api/me this area needs: is there an image model, which household form.
struct MeExtras: Decodable, Sendable {
    var features: Features?
    var home: JSONValue?
    struct Features: Decodable, Sendable {
        var vision: Bool?
    }
    var vision: Bool { features?.vision ?? false }
    var form: String? { home?["form"]?.string }
}

// MARK: - receipt address (ToHuus Cloud, server/routes/mail.ts)

struct MailAddressInfo: Decodable, Sendable {
    var available: Bool
    var allowed: Bool?
    var address: String?
    var stats: Stats?
    struct Stats: Decodable, Sendable {
        var days: Int
        var received: Int
        var imported: Int
        var ignored: [String: Int]?
        var ignoredTotal: Int { (ignored ?? [:]).values.reduce(0, +) }
    }
}

// MARK: - receipt inbox (self-hosted IMAP, server/routes/retail.ts)

struct InboxInfo: Decodable, Sendable {
    /// false in ToHuus Cloud (no mailbox polling there)
    var available: Bool?
    var configured: Bool
    var enabled: Bool
    var forwardTo: String?
    var folder: String?
    var status: InboxStatus?
    /// admins only
    var settings: InboxSettings?
    @Lossy var recent: [RecentMail]

    struct RecentMail: Decodable, Sendable, Identifiable {
        var messageId: String
        var subject: String?
        var fromAddr: String?
        var createdAt: String?
        var result: Result?
        var id: String { messageId }
        struct Result: Decodable, Sendable {
            @Lossy var imports: [Ref]
            var note: String?
        }
        struct Ref: Decodable, Sendable {
            var id: Int
            var duplicate: Bool?
        }
    }
}

struct InboxStatus: Decodable, Sendable {
    var at: String?
    var ok: Bool
    var message: String
    var checked: Int?
    var imported: Int?
}

struct InboxSettings: Decodable, Sendable {
    var enabled: Bool
    var host: String
    var port: Int
    var tls: Bool
    var user: String
    var folder: String
    var allowFrom: [String]
    var moveTo: String?
    var hasPassword: Bool?
}

// MARK: - endpoints

extension APIClient {
    // recognition
    func recognitionReport(_ importId: Int) async throws -> RecognitionReport { try await get("api/quality/imports/\(importId)") }
    func setImportStore(_ importId: Int, shop: String) async throws -> StoreSetResult {
        try await send("PATCH", "api/quality/imports/\(importId)/store", json: ["shop": shop])
    }
    func recognitionFixture(_ importId: Int, names: Bool) async throws -> RecognitionFixture {
        try await get("api/quality/imports/\(importId)/fixture", query: [URLQueryItem(name: "names", value: names ? "1" : "0")])
    }

    // who paid
    func importSplitInfo(_ id: Int) async throws -> ImportSplitInfo { try await get("api/imports/\(id)") }
    /// POST /api/imports/:id/split { lines: [{ id, for_user_id, for_list_id }] } – one line for a person or a care list
    func setImportLineFor(_ id: Int, line: Int, userId: Int?, listId: Int?) async throws {
        let l: [String: Any] = ["id": line, "for_user_id": userId.map { $0 as Any } ?? NSNull(), "for_list_id": listId.map { $0 as Any } ?? NSNull()]
        _ = try await send("POST", "api/imports/\(id)/split", json: ["lines": [l]], as: Ignored.self)
    }

    func meExtras() async throws -> MeExtras { try await get("api/me") }

    // receipt address & inbox
    func mailAddress() async throws -> MailAddressInfo { try await get("api/mail/address") }
    func rotateMailAddress() async throws { _ = try await send("POST", "api/mail/address/rotate", json: [:], as: Ignored.self) }
    func inbox() async throws -> InboxInfo { try await get("api/retail/inbox") }
    func checkInbox() async throws -> InboxStatus { try await send("POST", "api/retail/inbox/check", json: [:], timeout: 90) }

    // imports: cupboard photos (shelf) and plain text
    /// POST /api/imports/upload mode=shelf [location_id] – photos of a cupboard or freezer; needs the server's image model
    func uploadStocktake(images: [Data], locationId: Int?) async throws -> ImportUploadResponse {
        var mp = Multipart()
        for (i, d) in images.enumerated() { mp.addFile("files", filename: "shelf-\(i + 1).jpg", mimeType: "image/jpeg", data: d) }
        mp.addField("mode", "shelf")
        if let locationId { mp.addField("location_id", String(locationId)) }
        return try await upload("api/imports/upload", multipart: mp, timeout: 180)
    }
    /// POST /api/imports/upload text=… – "2x Mio Mio Mate / Paketband" matched against the products
    func importText(_ text: String) async throws -> ImportUploadResponse {
        var mp = Multipart()
        mp.addField("text", text)
        return try await upload("api/imports/upload", multipart: mp, timeout: 90)
    }

    /// GET /api/spend/export?format=csv|json&period=&date=&tag=[&view=mine]
    func spendExport(format: String, period: String, date: String?, tag: String?, view: String?) async throws -> Data {
        var q = [URLQueryItem(name: "format", value: format), URLQueryItem(name: "period", value: period)]
        if let date { q.append(URLQueryItem(name: "date", value: date)) }
        if let tag, !tag.isEmpty { q.append(URLQueryItem(name: "tag", value: tag)) }
        if view == "mine" { q.append(URLQueryItem(name: "view", value: "mine")) }
        return try await getData("api/spend/export", query: q)
    }
}
