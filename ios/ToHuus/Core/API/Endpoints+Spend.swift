import Foundation

/// Money in detail (server/routes/spend2.ts, docs/ios-0.2.md "0.3 parity – Geld").
extension APIClient {
    private func periodQuery(_ period: String, date: String?, tag: String?, view: String? = nil) -> [URLQueryItem] {
        var q = [URLQueryItem(name: "period", value: period)]
        if let date { q.append(URLQueryItem(name: "date", value: date)) }
        if let tag, !tag.isEmpty { q.append(URLQueryItem(name: "tag", value: tag)) }
        if view == "mine" { q.append(URLQueryItem(name: "view", value: "mine")) }
        return q
    }

    /// GET /api/spend/stats?period=week|month|year|all&date=&tag=[&view=mine]
    func spendStats(period: String, date: String?, tag: String?, view: String? = nil) async throws -> SpendStats {
        try await get("api/spend/stats", query: periodQuery(period, date: date, tag: tag, view: view))
    }

    func spendMeta() async throws -> SpendMeta { try await get("api/spend/meta") }

    /// GET /api/spend/entries?period=custom&from&to[&category|store|tag|excluded=1] – the drill-down
    func spendEntries(from: String, to: String, category: String? = nil, store: String? = nil, tag: String? = nil,
                      excludedOnly: Bool = false, view: String? = nil) async throws -> SpendEntries {
        var q = [URLQueryItem(name: "period", value: "custom"), URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to)]
        if let category { q.append(URLQueryItem(name: "category", value: category)) }
        if let store { q.append(URLQueryItem(name: "store", value: store)) }
        if let tag, !tag.isEmpty { q.append(URLQueryItem(name: "tag", value: tag)) }
        if excludedOnly { q.append(URLQueryItem(name: "excluded", value: "1")) }
        if view == "mine" { q.append(URLQueryItem(name: "view", value: "mine")) }
        return try await get("api/spend/entries", query: q)
    }

    func spendReceipt(_ id: Int) async throws -> SpendReceipt { try await get("api/spend/receipts/\(id)") }
    func setReceiptTags(_ id: Int, tags: [String]) async throws {
        _ = try await send("PUT", "api/spend/receipts/\(id)/tags", json: ["tags": tags], as: Ignored.self)
    }

    /// PATCH /api/spend/lines/:id { category: string|null, tags } – statistics only, the product keeps its category
    func updateSpendLine(_ id: Int, category: String?, tags: [String]) async throws {
        _ = try await send("PATCH", "api/spend/lines/\(id)", json: ["category": category ?? NSNull(), "tags": tags], as: Ignored.self)
    }

    // MARK: own expenses

    private func expenseBody(amount: Double, day: String, store: String?, category: String?, note: String?, tags: [String]) -> [String: Any] {
        ["amount": amount, "day": day, "store": store ?? NSNull(), "category": category ?? NSNull(), "note": note ?? NSNull(), "tags": tags]
    }

    func addExpense(amount: Double, day: String, store: String?, category: String?, note: String?, tags: [String]) async throws {
        _ = try await send("POST", "api/spend/expenses", json: expenseBody(amount: amount, day: day, store: store, category: category, note: note, tags: tags), as: Ignored.self)
    }

    func updateExpense(_ id: Int, amount: Double, day: String, store: String?, category: String?, note: String?, tags: [String]) async throws {
        _ = try await send("PATCH", "api/spend/expenses/\(id)", json: expenseBody(amount: amount, day: day, store: store, category: category, note: note, tags: tags), as: Ignored.self)
    }

    func deleteExpense(_ id: Int) async throws { _ = try await send("DELETE", "api/spend/expenses/\(id)", as: Ignored.self) }

    // MARK: left out

    func spendExclusions() async throws -> [SpendExclusion] {
        try await get("api/spend/exclusions", as: Lossy<SpendExclusion>.self).wrappedValue
    }

    /// POST /api/spend/exclusions { scope: line|receipt|product|category|store|expense, ref, reason? }
    func excludeSpend(scope: String, ref: String, reason: String?) async throws {
        var refValue: Any = ref
        if ["line", "receipt", "product", "expense"].contains(scope), let n = Int(ref) { refValue = n }
        _ = try await send("POST", "api/spend/exclusions", json: ["scope": scope, "ref": refValue, "reason": reason ?? NSNull()], as: Ignored.self)
    }

    func countAgain(_ exclusionId: Int) async throws { _ = try await send("DELETE", "api/spend/exclusions/\(exclusionId)", as: Ignored.self) }

    /// DELETE /api/spend/exclusions/by-ref?scope=category&ref=…
    func countAgain(scope: String, ref: String) async throws {
        let req = try request("DELETE", "api/spend/exclusions/by-ref", query: [URLQueryItem(name: "scope", value: scope), URLQueryItem(name: "ref", value: ref)])
        _ = try await perform(req)
    }

    // MARK: budgets

    func spendBudgets() async throws -> BudgetsResponse { try await get("api/spend/budgets") }

    /// PUT /api/spend/budgets { category: string|null, period: week|month, amount: number|null (null removes), notify? }
    func setBudget(category: String?, period: String, amount: Double?, notify: Bool?) async throws {
        var body: [String: Any] = ["category": category ?? NSNull(), "period": period, "amount": amount ?? NSNull()]
        if let notify { body["notify"] = notify }
        _ = try await send("PUT", "api/spend/budgets", json: body, as: Ignored.self)
    }

    // MARK: export & prices

    /// GET /api/spend/export?format=csv&period=…&date=… – the raw CSV (UTF-8 with BOM)
    func spendExportCSV(period: String, date: String?, tag: String?, view: String? = nil) async throws -> Data {
        try await getData("api/spend/export", query: [URLQueryItem(name: "format", value: "csv")] + periodQuery(period, date: date, tag: tag, view: view))
    }

    func priceHistory(_ productId: Int) async throws -> PriceHistory { try await get("api/spending/prices/\(productId)") }
    func pricedProducts() async throws -> [PricedProduct] {
        try await get("api/spending/products", as: Lossy<PricedProduct>.self).wrappedValue
    }
}
