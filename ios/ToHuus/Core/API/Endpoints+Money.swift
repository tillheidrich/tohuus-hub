import Foundation

/// Geld wave 2 (q-money): own entries with photo/PDF, personal entries, lines per person, money lists – docs/money.md.
extension APIClient {
    /// GET /api/money/overview?month=&view=mine
    func moneyOverview(month: String, view: String?) async throws -> MoneyOverview {
        var q = [URLQueryItem(name: "month", value: month)]
        if view == "mine" { q.append(URLQueryItem(name: "view", value: "mine")) }
        return try await get("api/money/overview", query: q)
    }

    // MARK: own entries

    func expense(_ id: Int) async throws -> ExpenseDetail { try await get("api/spend/expenses/\(id)") }

    /// POST /api/spend/expenses or PATCH …/:id with the full body (q-money fields included). `attachment`: a new token,
    /// `.some(nil)` removes the file, nil leaves it.
    func saveExpense(id: Int?, amount: Double, day: String, store: String?, category: String?, note: String?, tags: [String],
                     privateFor: Int?, paidBy: Int?, items: [ExpenseItem], attachment: String??) async throws {
        var body: [String: Any] = [
            "amount": amount, "day": day, "store": store ?? NSNull(), "category": category ?? NSNull(), "note": note ?? NSNull(), "tags": tags,
            "private_for": privateFor ?? NSNull(), "paid_by": paidBy ?? NSNull(),
            "items": items.map { ["name": $0.name, "price": $0.price, "for_user_id": $0.forUserId ?? NSNull()] as [String: Any] },
        ]
        if let a = attachment { body["attachment"] = a ?? NSNull() }
        if let id { _ = try await send("PATCH", "api/spend/expenses/\(id)", json: body, as: Ignored.self) }
        else { _ = try await send("POST", "api/spend/expenses", json: body, as: Ignored.self) }
    }

    /// POST /api/spend/files (multipart `file`, `read=1`) – photo or PDF; answers the token and what was read.
    func uploadSpendFile(data: Data, filename: String, mimeType: String, read: Bool = true) async throws -> SpendFileUpload {
        var mp = Multipart()
        mp.addField("read", read ? "1" : "0")
        mp.addFile("file", filename: filename, mimeType: mimeType, data: data)
        return try await upload("api/spend/files", multipart: mp, timeout: 120)
    }

    /// GET /api/spend/expenses/:id/attachment – the decrypted file
    func expenseAttachment(_ id: Int) async throws -> Data { try await getData("api/spend/expenses/\(id)/attachment") }

    /// POST /api/spend/receipts/:id/personal { for_user_id } – nil: back to the household
    func setReceiptPersonal(_ id: Int, forUserId: Int?) async throws {
        _ = try await send("POST", "api/spend/receipts/\(id)/personal", json: ["for_user_id": forUserId ?? NSNull()], as: Ignored.self)
    }

    /// POST /api/imports/:id/split – who paid a receipt / one line for one person (nil = household)
    func setReceiptPayer(_ id: Int, userId: Int?) async throws {
        _ = try await send("POST", "api/imports/\(id)/split", json: ["paid_by": userId ?? NSNull()], as: Ignored.self)
    }
    func setLineOwner(receipt id: Int, line: Int, userId: Int?) async throws {
        _ = try await send("POST", "api/imports/\(id)/split", json: ["lines": [["id": line, "for_user_id": userId.map { $0 as Any } ?? NSNull()] as [String: Any]]], as: Ignored.self)
    }

    func setMoneyCategories(_ list: [String]) async throws {
        _ = try await send("PUT", "api/spend/categories", json: ["categories": list], as: Ignored.self)
    }
    func renameMoneyCategory(from: String, to: String) async throws {
        _ = try await send("POST", "api/spend/categories/rename", json: ["from": from, "to": to], as: Ignored.self)
    }
    func setAssignedOut(_ on: Bool) async throws {
        _ = try await send("PUT", "api/spend/settings", json: ["assigned_out": on], as: Ignored.self)
    }

    // MARK: money lists

    func moneyLists() async throws -> [MoneyListSummary] { try await get("api/money/lists", as: Lossy<MoneyListSummary>.self).wrappedValue }
    func moneyList(_ id: Int) async throws -> MoneyList { try await get("api/money/lists/\(id)") }
    func moneySources() async throws -> MoneySources { try await get("api/money/sources") }

    /// POST /api/money/lists – `people` [{user_id}|{name}] or `count` (split by N without names)
    func createMoneyList(title: String?, people: [MoneyPersonInput]?, count: Int?, from: MoneySource?, privateList: Bool, shareWith: [Int]) async throws -> MoneyList {
        var body: [String: Any] = ["visibility": privateList ? "private" : "household", "share_with": privateList ? shareWith : []]
        if let title, !title.isEmpty { body["title"] = title }
        if let people { body["people"] = people.map(\.json) }
        if let count { body["count"] = count }
        if let from { body["from"] = from.json }
        return try await send("POST", "api/money/lists", json: body)
    }
    func updateMoneyList(_ id: Int, mode: String? = nil, settled: Bool? = nil, visibility: String? = nil, shareWith: [Int]? = nil) async throws -> MoneyList {
        var body: [String: Any] = [:]
        if let mode { body["mode"] = mode }
        if let settled { body["settled"] = settled }
        if let visibility { body["visibility"] = visibility }
        if let shareWith { body["share_with"] = shareWith }
        return try await send("PATCH", "api/money/lists/\(id)", json: body)
    }
    func deleteMoneyList(_ id: Int) async throws { _ = try await send("DELETE", "api/money/lists/\(id)", as: Ignored.self) }
    func setMoneyListPeople(_ id: Int, _ people: [MoneyPersonInput]) async throws -> MoneyList {
        try await send("PUT", "api/money/lists/\(id)/people", json: ["people": people.map(\.json)])
    }
    func addMoneyListItem(_ id: Int, name: String, amount: Double) async throws -> MoneyList {
        try await send("POST", "api/money/lists/\(id)/items", json: ["name": name, "amount": amount])
    }
    /// `paidBy` / `forPerson`: .some(nil) clears, nil leaves as is
    func updateMoneyListItem(_ id: Int, item: Int, amount: Double? = nil, paidBy: Int?? = nil, forPerson: Int?? = nil) async throws -> MoneyList {
        var body: [String: Any] = [:]
        if let amount { body["amount"] = amount }
        if let paidBy { body["paid_by"] = paidBy.map { $0 as Any } ?? NSNull() }
        if let forPerson { body["for_person"] = forPerson.map { $0 as Any } ?? NSNull() }
        return try await send("PATCH", "api/money/lists/\(id)/items/\(item)", json: body)
    }
    func deleteMoneyListItem(_ id: Int, item: Int) async throws -> MoneyList { try await send("DELETE", "api/money/lists/\(id)/items/\(item)") }
    func moneyListPaidAll(_ id: Int, by person: Int) async throws -> MoneyList {
        try await send("POST", "api/money/lists/\(id)/items/bulk", json: ["ids": "all", "paid_by": person])
    }
    func addMoneyListPayment(_ id: Int, from: Int, to: Int, amount: Double) async throws -> MoneyList {
        try await send("POST", "api/money/lists/\(id)/payments", json: ["from": from, "to": to, "amount": amount])
    }
    func deleteMoneyListPayment(_ id: Int, payment: Int) async throws -> MoneyList { try await send("DELETE", "api/money/lists/\(id)/payments/\(payment)") }
}
