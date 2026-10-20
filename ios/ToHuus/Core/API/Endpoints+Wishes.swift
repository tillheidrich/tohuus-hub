import Foundation

// Wish lists / Merkliste and private shopping lists (13 Oct 2026, wish-list app features 20 Oct 2026) –
// docs/wishes.md, docs/shopping-list.md. The server never opens links; titles come from LinkPresentation here.
extension APIClient {
    func wishLists(archived: Bool = false) async throws -> [WishList] {
        try await get("api/wishes/lists", query: archived ? [URLQueryItem(name: "archived", value: "1")] : [], as: Lossy<WishList>.self).wrappedValue
    }
    func wishList(_ id: Int, sort: String = "manual", archived: Bool = false) async throws -> WishListDetail {
        var q = [URLQueryItem(name: "sort", value: sort)]
        if archived { q.append(URLQueryItem(name: "archived", value: "1")) }
        return try await get("api/wishes/lists/\(id)", query: q, as: WishListDetail.self)
    }
    /// `body`: JSON built on the main actor, handed over as Data (Sendable – Swift 6 region isolation)
    @discardableResult
    func saveWishList(id: Int?, body data: Data) async throws -> WishList {
        let body = (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if let id { return try await send("PATCH", "api/wishes/lists/\(id)", json: body, as: WishList.self) }
        return try await send("POST", "api/wishes/lists", json: body, as: WishList.self)
    }
    func deleteWishList(_ id: Int) async throws { _ = try await send("DELETE", "api/wishes/lists/\(id)", as: Ignored.self) }
    func searchWishes(_ q: String) async throws -> [Wish] {
        try await get("api/wishes/search", query: [URLQueryItem(name: "q", value: q)], as: Lossy<Wish>.self).wrappedValue
    }
    /// drag to sort: the list's wishes in the new order
    func orderWishes(listId: Int, ids: [Int]) async throws { _ = try await send("POST", "api/wishes/lists/\(listId)/order", json: ["ids": ids], as: Ignored.self) }
    /// the link for guests without an account (owner and co-editors) – a new one replaces the old one
    @discardableResult
    func createWishGuestLink(listId: Int) async throws -> WishList { try await send("POST", "api/wishes/lists/\(listId)/link", json: [:], as: WishList.self) }
    @discardableResult
    func revokeWishGuestLink(listId: Int) async throws -> WishList { try await send("DELETE", "api/wishes/lists/\(listId)/link", as: WishList.self) }
    /// "Du schenkst": my reservations over all lists
    func giving() async throws -> Giving { try await get("api/wishes/giving", as: Giving.self) }

    @discardableResult
    func saveWish(id: Int?, listId: Int, body data: Data) async throws -> Wish {
        let body = (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if let id { return try await send("PATCH", "api/wishes/items/\(id)", json: body, as: Wish.self) }
        return try await send("POST", "api/wishes/lists/\(listId)/items", json: body, as: Wish.self)
    }
    func deleteWish(_ id: Int) async throws { _ = try await send("DELETE", "api/wishes/items/\(id)", as: Ignored.self) }
    /// open | reserved | bought (404 for the person the list is for and the owner of a surprise list)
    func setWishStatus(_ id: Int, status: String) async throws { _ = try await send("POST", "api/wishes/items/\(id)/status", json: ["status": status], as: Ignored.self) }
    /// a personal reminder (only for the person who sets it); nil removes it
    func setWishReminder(_ id: Int, day: String?) async throws {
        _ = try await send("PUT", "api/wishes/items/\(id)/reminder", json: ["remind_on": day.map { $0 as Any } ?? NSNull()], as: Ignored.self)
    }
    /// → { shopping_item_id, private }
    func wishToShopping(_ id: Int, listId: Int?) async throws -> Bool {
        let r = try await send("POST", "api/wishes/items/\(id)/to-list", json: ["list_id": listId.map { $0 as Any } ?? NSNull()], as: JSONValue.self)
        return r["private"]?.bool ?? false
    }
    func uploadWishPhoto(_ id: Int, jpeg: Data) async throws {
        var mp = Multipart()
        mp.addFile("image", filename: "wish.jpg", mimeType: "image/jpeg", data: jpeg)
        _ = try await upload("api/wishes/items/\(id)/photo", multipart: mp, as: Ignored.self)
    }
    func deleteWishPhoto(_ id: Int) async throws { _ = try await send("DELETE", "api/wishes/items/\(id)/photo", as: Ignored.self) }
    /// AI reads title, details and a visible price from a photo (needs a model, AI allowed, counts towards AI uses)
    func wishFromPhoto(jpeg: Data) async throws -> WishAIResult {
        var mp = Multipart()
        mp.addFile("image", filename: "wish.jpg", mimeType: "image/jpeg", data: jpeg)
        return try await upload("api/wishes/ai/photo", multipart: mp, as: WishAIResult.self, timeout: 60)
    }
    /// format: text | markdown | csv; withLink adds the guest link to text and Markdown
    func wishShareText(listId: Int, itemIds: [Int] = [], prices: Bool, skipTaken: Bool, format: String = "text", withLink: Bool = false) async throws -> WishShareText {
        var b: [String: Any] = ["prices": prices, "skip_taken": skipTaken, "format": format, "with_link": withLink]
        if !itemIds.isEmpty { b["item_ids"] = itemIds }
        return try await send("POST", "api/wishes/lists/\(listId)/share", json: b, as: WishShareText.self)
    }

    /// Private shopping lists: PATCH /api/list/lists/:id { visibility, share_with }
    func setShopListVisibility(_ id: Int, visibility: String, shareWith: [Int]) async throws {
        _ = try await send("PATCH", "api/list/lists/\(id)", json: ["visibility": visibility, "share_with": shareWith], as: Ignored.self)
    }
}
