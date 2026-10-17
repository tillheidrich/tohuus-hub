import Foundation

// Receipts ("Bons"): history and review – GET /api/imports, GET /api/imports/:id (server/routes/imports.ts).
// Decoded with convertFromSnakeCase: created_at → createdAt, product_name → productName …

/// One row of GET /api/imports (newest first, at most 80).
struct ImportSummary: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var kind: String?
    /// review | applied | discarded
    var status: String
    var title: String
    var shop: String?
    var total: Double?
    var meta: JSONValue?
    var actor: String?
    var createdAt: String?
    var appliedAt: String?
    /// number of lines
    var lines: Int?

    /// what was paid: the reconciled final total first (pickup matched with the eBon), else the receipt total
    var paid: Double? { meta?["finalTotal"]?.double ?? total }
    var reconciled: Bool { !(meta?["reconciledWith"]?.isNull ?? true) }
    /// the receipt's own date when the parser found one
    var day: String? { meta?["date"]?.string ?? createdAt }
}

/// GET /api/imports/:id – the import with its lines.
struct ImportDetail: Decodable, Sendable, Identifiable {
    var id: Int
    var kind: String?
    var status: String
    var title: String
    var shop: String?
    var total: Double?
    var meta: JSONValue?
    var createdAt: String?
    var appliedAt: String?
    @Lossy var lines: [ImportLine]

    var readonly: Bool { status != "review" }
    var day: String? { meta?["date"]?.string ?? createdAt }
    var reconciled: Bool { !(meta?["reconciledWith"]?.isNull ?? true) }
    var finalTotal: Double? { meta?["finalTotal"]?.double }
    /// lines that will be booked in (the web's "Book in n")
    var bookCount: Int { lines.filter { $0.action != "skip" && $0.qty != 0 }.count }
}

struct ImportLine: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var raw: String?
    var name: String
    var qty: Double
    var unit: String?
    var price: Double?
    /// ok | substitute | unavailable | reduced | returned | extra | deposit
    var status: String
    var note: String?
    var productId: Int?
    var locationId: Int?
    /// add | skip | new
    var action: String
    var confidence: Double?
    var receiptName: String?
    var bestBefore: String?
    var productName: String?
    var productBrand: String?
    var productImage: String?

    var skipped: Bool { action == "skip" }
    var isDeposit: Bool { status == "deposit" }
    /// "Kurz prüfen": not skipped and not a plain recognised line
    var needsLook: Bool { !skipped && (status != "ok" || action == "new") }

    /// the web's status badge label (English key)
    var statusLabel: String? {
        switch status {
        case "substitute": return L("substitute")
        case "unavailable": return L("not delivered")
        case "reduced": return L("fewer than ordered")
        case "returned": return L("returned")
        case "extra": return L("bought extra")
        case "deposit": return L("deposit")
        default: return nil
        }
    }

    /// colour role for the badge (StatusStyle keys)
    var statusTone: String? {
        switch status {
        case "substitute": return "expiring"
        case "unavailable", "returned": return "empty"
        case "reduced": return "low"
        default: return nil
        }
    }
}

/// PATCH /api/imports/:id/lines/:lineId → { ok, learned: ["product","qty",…] }
struct LinePatchResult: Decodable, Sendable {
    var ok: Bool?
    var learned: [String]?
}

/// POST /api/imports/:id/apply → { applied, created }
struct ApplyResult: Decodable, Sendable {
    var applied: Int?
    var created: Int?
}

/// DELETE /api/imports/:id → stock bookings taken back, products only this receipt created removed
struct ImportDeleteResult: Decodable, Sendable {
    var reverted: Int?
    var removedProducts: Int?
}

/// POST /api/imports/url → createImport result { id, merged?, duplicate? }
struct UrlImportResult: Decodable, Sendable {
    var id: Int?
    var merged: Bool?
    var duplicate: Bool?
}

/// POST /api/imports/:id/rematch → { matched }
struct RematchResult: Decodable, Sendable {
    var matched: Int?
}

enum ImportUnits {
    /// same values as the web's UNITS (web/src/pages/QualityReport.tsx)
    static let all = ["Stk", "g", "kg", "ml", "l", "Pck"]
    static func label(_ u: String) -> String { u == "Stk" ? L("pcs") : u == "Pck" ? L("pack") : u }
}
