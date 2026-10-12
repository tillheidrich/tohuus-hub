import Foundation

/// "Für mich" (treats), guest links and editing the house info (docs/ios-0.2.md "0.3 parity – Für mich & Hausinfo").
extension APIClient {
    // MARK: treats (server/routes/guest.ts, guestAdmin router mounted at /api)

    func treatMenu() async throws -> [TreatItem] { try await get("api/bar/menu", as: Lossy<TreatItem>.self).wrappedValue }
    func treatHelpers() async throws -> [TreatHelper] { try await get("api/bar/helpers", as: Lossy<TreatHelper>.self).wrappedValue }
    func myTreats() async throws -> [TreatOrder] { try await get("api/bar/my-orders", as: Lossy<TreatOrder>.self).wrappedValue }
    /// what the others asked for and I could bring
    func treatRequests() async throws -> [TreatOrder] { try await get("api/bar/requests", as: Lossy<TreatOrder>.self).wrappedValue }

    /// POST /api/bar/orders { note, bring_by, lines: [{ product_id, qty, options }] } → { id }
    func askForTreat(lines: [(productId: Int, qty: Int, options: [String])], note: String?, bringBy: Int?) async throws -> Int {
        let body: [String: Any] = [
            "note": note ?? NSNull(),
            "bring_by": bringBy ?? NSNull(),
            "lines": lines.map { ["product_id": $0.productId, "qty": $0.qty, "options": $0.options] as [String: Any] },
        ]
        return try await send("POST", "api/bar/orders", json: body, as: CreatedID.self).id
    }

    /// PATCH /api/orders/:id { status: accepted | done | declined, reason? } – "I'll bring it", "Brought it", "Can't right now"
    func answerTreat(_ id: Int, status: String, reason: String? = nil) async throws {
        _ = try await send("PATCH", "api/orders/\(id)", json: ["status": status, "reason": reason ?? NSNull()], as: Ignored.self)
    }

    /// POST /api/bar/orders/:id/thanks – once, private, only from the person who asked
    func thankForTreat(_ id: Int) async throws { _ = try await send("POST", "api/bar/orders/\(id)/thanks", as: Ignored.self) }

    // MARK: guest links (server/routes/guest.ts, server/routes/data.ts)

    func guestLinks() async throws -> [GuestLink] { try await get("api/guest-links", as: Lossy<GuestLink>.self).wrappedValue }

    /// POST /api/guest-links { name, scopes, location_ids, days (0 = no expiry), note } → { token, url }
    func createGuestLink(name: String, scopes: [String], locationIds: [Int], days: Int, note: String?) async throws -> GuestLinkURL {
        try await send("POST", "api/guest-links", json: [
            "name": name, "scopes": scopes, "location_ids": locationIds, "days": days, "note": note ?? NSNull(),
        ])
    }

    /// a new token for the link – the old URL stops working
    func rotateGuestLink(_ id: Int) async throws -> GuestLinkURL { try await send("POST", "api/guest-links/\(id)/rotate") }
    func revokeGuestLink(_ id: Int) async throws { _ = try await send("DELETE", "api/guest-links/\(id)", as: Ignored.self) }

    // MARK: house info, admins (server/routes/house-guide.ts)

    /// POST /api/house-guide/cards or PATCH …/cards/:id { type, topic, area, title, body, detail }
    func saveHouseCard(id: Int?, _ body: [String: Any]) async throws {
        if let id { _ = try await send("PATCH", "api/house-guide/cards/\(id)", json: body, as: Ignored.self) }
        else { _ = try await send("POST", "api/house-guide/cards", json: body, as: Ignored.self) }
    }
    func deleteHouseCard(_ id: Int) async throws { _ = try await send("DELETE", "api/house-guide/cards/\(id)", as: Ignored.self) }

    /// POST /api/house-guide/codes or PATCH …/codes/:id { kind, label, area, value?, wifi?, note } – `value` omitted = unchanged
    func saveHouseCode(id: Int?, _ body: [String: Any]) async throws {
        if let id { _ = try await send("PATCH", "api/house-guide/codes/\(id)", json: body, as: Ignored.self) }
        else { _ = try await send("POST", "api/house-guide/codes", json: body, as: Ignored.self) }
    }
    func deleteHouseCode(_ id: Int) async throws { _ = try await send("DELETE", "api/house-guide/codes/\(id)", as: Ignored.self) }
}
