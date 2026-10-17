import Foundation

/// Receipts ("Bons"): history, review, digital receipts via link (server/routes/imports.ts, docs/ios-0.2.md "0.3 parity – Geld, Bons").
extension APIClient {
    /// GET /api/imports – newest first, at most 80
    func imports() async throws -> [ImportSummary] {
        try await get("api/imports", as: Lossy<ImportSummary>.self).wrappedValue
    }

    /// GET /api/imports/:id – with lines (product name/image joined in)
    func importDetail(_ id: Int) async throws -> ImportDetail { try await get("api/imports/\(id)") }

    /// PATCH /api/imports/:id/lines/:lineId { action?, product_id?, location_id?, qty?, name?, unit?, price? }
    /// Only while the import is in review. Corrections are learned for the next receipts (`learned`).
    /// Pass `.null` to clear a nullable field (product_id, unit, price, location_id).
    func patchImportLine(importId: Int, lineId: Int, _ body: [String: JSONValue]) async throws -> LinePatchResult {
        try await send("PATCH", "api/imports/\(importId)/lines/\(lineId)", body: body)
    }

    /// POST /api/imports/:id/apply → { applied, created }
    func applyImportResult(_ id: Int) async throws -> ApplyResult { try await send("POST", "api/imports/\(id)/apply") }

    /// POST /api/imports/:id/discard (status review → discarded)
    func discardImport(_ id: Int) async throws { _ = try await send("POST", "api/imports/\(id)/discard", as: Ignored.self) }

    /// POST /api/imports/:id/reopen – a booked receipt back to "to check" (its stock bookings are taken back);
    /// a discarded one opens again
    func reopenImport(_ id: Int) async throws { _ = try await send("POST", "api/imports/\(id)/reopen", as: Ignored.self) }

    /// DELETE /api/imports/:id → { reverted, removedProducts } – a booked receipt takes its bookings with it
    func deleteImport(_ id: Int) async throws -> ImportDeleteResult { try await send("DELETE", "api/imports/\(id)") }

    /// PATCH /api/imports/:id { shop?, date? (YYYY-MM-DD | null), total? } – any state
    func patchImportHead(_ id: Int, _ body: [String: JSONValue]) async throws {
        _ = try await send("PATCH", "api/imports/\(id)", body: body, as: Ignored.self)
    }

    /// POST /api/imports/:id/lines { name, qty, price, deposit } – a line the reading missed (to check only)
    func addImportLine(_ id: Int, _ body: [String: JSONValue]) async throws {
        _ = try await send("POST", "api/imports/\(id)/lines", body: body, as: Ignored.self)
    }

    /// DELETE /api/imports/:id/lines/:lineId (to check only)
    func deleteImportLine(importId: Int, lineId: Int) async throws {
        _ = try await send("DELETE", "api/imports/\(importId)/lines/\(lineId)", as: Ignored.self)
    }

    /// POST /api/imports/:id/rematch → { matched } – tries "new" lines against the catalogue again
    func rematchImport(_ id: Int) async throws -> Int {
        (try await send("POST", "api/imports/\(id)/rematch", as: RematchResult.self)).matched ?? 0
    }

    /// POST /api/imports/url { url } – digital receipt (eBon) behind a QR code or link
    func importFromURL(_ url: String) async throws -> UrlImportResult {
        try await send("POST", "api/imports/url", json: ["url": url], timeout: 60)
    }
}
