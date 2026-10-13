import Foundation

// Wish lists / Merkliste and private shopping lists (13 Oct 2026) – docs/wishes.md, docs/shopping-list.md.
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

    @discardableResult
    func saveWish(id: Int?, listId: Int, body data: Data) async throws -> Wish {
        let body = (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if let id { return try await send("PATCH", "api/wishes/items/\(id)", json: body, as: Wish.self) }
        return try await send("POST", "api/wishes/lists/\(listId)/items", json: body, as: Wish.self)
    }
    func deleteWish(_ id: Int) async throws { _ = try await send("DELETE", "api/wishes/items/\(id)", as: Ignored.self) }
    /// open | reserved | bought (404 for the person the list is for)
    func setWishStatus(_ id: Int, status: String) async throws { _ = try await send("POST", "api/wishes/items/\(id)/status", json: ["status": status], as: Ignored.self) }
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
    func wishShareText(listId: Int, itemIds: [Int], prices: Bool, skipTaken: Bool) async throws -> WishShareText {
        var b: [String: Any] = ["prices": prices, "skip_taken": skipTaken]
        if !itemIds.isEmpty { b["item_ids"] = itemIds }
        return try await send("POST", "api/wishes/lists/\(listId)/share", json: b, as: WishShareText.self)
    }
    func wishLinkPreview(_ url: String) async throws -> WishLinkPreview {
        try await send("POST", "api/wishes/preview", json: ["url": url], as: WishLinkPreview.self, timeout: 15)
    }

    /// Private shopping lists: PATCH /api/list/lists/:id { visibility, share_with }
    func setShopListVisibility(_ id: Int, visibility: String, shareWith: [Int]) async throws {
        _ = try await send("PATCH", "api/list/lists/\(id)", json: ["visibility": visibility, "share_with": shareWith], as: Ignored.self)
    }
}
