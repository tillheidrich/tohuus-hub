import XCTest
@testable import ToHuus

/// Decoding of every payload the app reads, from fixtures written after the server code (server/routes, server/lib).
final class DecodingTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"), "missing fixture \(name)")
        return try Data(contentsOf: url)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try JSONCoding.decoder().decode(T.self, from: try fixture(name))
    }

    // Fixtures are real responses from the server (branch integrate, MULTI_TENANT=true, demo data + 5 receipts),
    // captured with an app token – see ios/tools/README in the commit message for how they were made.

    func testShopList() throws {
        let list = try decode(ShopList.self, "shop-list")
        XCTAssertGreaterThanOrEqual(list.stores.count, 2)
        XCTAssertEqual(list.sections.map(\.key), ["produce", "chilled", "frozen", "household", "other"])
        XCTAssertEqual(list.openCount, 6)
        XCTAssertEqual(list.open, 6)
        let milk = try XCTUnwrap(list.openItems.first { $0.text == "Milch" })
        XCTAssertEqual(milk.qtyLabel, "2×")
        XCTAssertFalse(milk.isInBasket)
        XCTAssertEqual(milk.origin, "Sam · heute 15:26")
        XCTAssertEqual(milk.originLine, "Sam · heute 15:26", "the server's origin line is shown as it is")
        XCTAssertEqual(list.openItems.first { $0.text == "Erdbeer-Eis" }?.originLine, "im Vorrat knapp")
        // lenient: a broken row is dropped, not the whole list
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: try fixture("shop-list")) as? [String: Any])
        var sections = raw["sections"] as! [[String: Any]]
        var items = sections[0]["items"] as! [Any]
        items.append(["id": "broken"])
        sections[0]["items"] = items
        raw["sections"] = sections
        raw["unknown"] = ["future": true]
        let again = try JSONCoding.decoder().decode(ShopList.self, from: JSONSerialization.data(withJSONObject: raw))
        XCTAssertEqual(again.openCount, 6)
    }

    func testToday() throws {
        let t = try decode(TodayPayload.self, "today")
        XCTAssertEqual(t.greeting, "Hallo, Sam")
        XCTAssertEqual(t.householdName, "Familie Berg")
        XCTAssertEqual(t.rhythm.count, 5)
        XCTAssertEqual(t.rhythm[0].name, "Bananen")
        XCTAssertEqual(t.rhythm[0].dueInDays, -2)
        XCTAssertEqual(t.rhythm[0].detail, "alle ~7 Tage · zuletzt vor 9 Tagen")
        XCTAssertEqual(t.list?.open, 6)
        XCTAssertEqual(t.list?.recent.first?.title, "Paketband")
        XCTAssertEqual(t.list?.recent.first { $0.text == "Milch" }?.title, "2× Milch")
        XCTAssertEqual(t.stillHave.map(\.name), ["Fruchtzwerge weniger süß", "Mozzarella", "Feta"])
        XCTAssertEqual(t.stillHave[0].label, "Datum überschritten")
        XCTAssertEqual(t.stillHave[0].daysLeft, -1)
        XCTAssertEqual(t.cookToday?.kind, "ready")
        XCTAssertEqual(t.cookToday?.recipeId, 1)
        XCTAssertEqual(t.cookToday?.why?.first, "alles da")
        XCTAssertTrue(t.cookToday?.missing.isEmpty ?? false)
        XCTAssertEqual(t.money?.budgetAmount, 400)
        XCTAssertEqual(t.money?.budgetState, "ok")
        XCTAssertEqual(t.money?.currency, "EUR")
        XCTAssertEqual(t.notices.first?.kind, "imports")
    }

    func testTodayLenient() throws {
        let json = #"{ "greeting": "Hallo", "household": "WG Rotdorn", "list": { "open": 0 }, "cookToday": null,"#
            + #" "money": { "week": null, "month": 0, "budget": 250 }, "stillHave": ["Spinat"], "notices": ["Hinweis"] }"#
        let t = try JSONCoding.decoder().decode(TodayPayload.self, from: Data(json.utf8))
        XCTAssertEqual(t.householdName, "WG Rotdorn")
        XCTAssertTrue(t.rhythm.isEmpty)
        XCTAssertNil(t.cookToday)
        XCTAssertEqual(t.money?.budgetAmount, 250)
        XCTAssertEqual(t.stillHave.first?.name, "Spinat")
        XCTAssertEqual(t.notices.first?.text, "Hinweis")
    }

    func testRhythm() throws {
        let r = try JSONCoding.decoder().decode(Lossy<RhythmItem>.self, from: try fixture("rhythm")).wrappedValue
        XCTAssertFalse(r.isEmpty)
        let b = try XCTUnwrap(r.first { $0.name == "Bananen" })
        XCTAssertEqual(b.everyDays, 7)
        XCTAssertEqual(b.suggested, true)
        XCTAssertEqual(b.onList, false)
        XCTAssertEqual(b.muted, false)
        XCTAssertEqual(b.count, 5)
        XCTAssertEqual(b.origin, "receipts")
        XCTAssertTrue(r.contains { $0.image?.contains("&s=") == true }, "images come pre-signed for bearer clients")
    }

    func testProducts() throws {
        let p = try JSONCoding.decoder().decode(Lossy<ProductInfo>.self, from: try fixture("products")).wrappedValue
        XCTAssertEqual(p.count, 66)
        XCTAssertTrue(p.contains { !$0.stock.isEmpty })
        XCTAssertTrue(p.allSatisfy { $0.status != nil })
        let d = try decode(ProductInfo.self, "product-detail")
        XCTAssertEqual(d.name, "Bananen")
        XCTAssertEqual(d.history.count, 1)
        let places = try JSONCoding.decoder().decode(Lossy<Place>.self, from: try fixture("places")).wrappedValue
        XCTAssertEqual(places.first?.name, "Kühlschrank")
        XCTAssertEqual(places.first?.productCount, 9)
    }

    func testRecipeAndMatch() throws {
        let r = try decode(Recipe.self, "recipe")
        XCTAssertEqual(r.id, 1)
        XCTAssertEqual(r.steps.count, 3)
        XCTAssertEqual(r.ingredients.count, 6)
        let m = try JSONCoding.decoder().decode(Lossy<IngredientMatch>.self, from: try fixture("recipe-match")).wrappedValue
        XCTAssertEqual(m.count, 6)
        XCTAssertTrue(m[0].atHome)
    }

    func testCookIdeas() throws {
        let res = try decode(CookIdeasResponse.self, "cook-ideas")
        XCTAssertEqual(res.ideas.count, 7, "ready + almost")
        XCTAssertEqual(res.ideas.filter { $0.missing.isEmpty }.count, 6)
        let almost = try XCTUnwrap(res.ideas.last)
        XCTAssertEqual(almost.title, "Pfannkuchen")
        XCTAssertEqual(almost.missing.map(\.name), ["Milch"])
        XCTAssertEqual(res.ideas[0].reasons.first, "alles da")
        // older servers: /api/recipes/suggest has the same information
        let fromSuggest = try JSONCoding.decoder().decode(Lossy<CookIdea>.self, from: try fixture("recipes-suggest")).wrappedValue
        XCTAssertEqual(fromSuggest.count, 5)
        XCTAssertEqual(fromSuggest.first?.recipeId, 1)
        // a bare array is accepted too
        let arr = try JSONCoding.decoder().decode(CookIdeasResponse.self, from: Data(#"[{"recipeId":1,"title":"A","missing":[]}]"#.utf8))
        XCTAssertEqual(arr.ideas.count, 1)
    }

    func testPlan() throws {
        let p = try decode(PlanResponse.self, "plan")
        XCTAssertEqual(p.days.count, 7)
        XCTAssertEqual(p.entries.first?.recipeId, 5)
        XCTAssertEqual(p.entries.first?.isCooked, false)
    }

    func testMoneyOverview() throws {
        let m = try decode(MoneyOverview.self, "money-overview")
        XCTAssertEqual(m.month, "2026-09")
        XCTAssertEqual(m.total, 98.64)
        XCTAssertEqual(m.budget, 400)
        XCTAssertEqual(m.budgetLeft, 301.36)
        XCTAssertEqual(m.budgetState, "ok")
        XCTAssertEqual(m.byCategory.first?.label, "Getränke")
        XCTAssertEqual(m.byShop.first?.value, 98.64)
        XCTAssertEqual(m.byWeek.count, 5)
        XCTAssertEqual(m.byWeek.first?.label, "2026-09-01")
        XCTAssertNil(m.vsLastMonth, "pct is null without a previous month")
        XCTAssertEqual(m.lastMonthTotal, 0)
        let cur = try decode(MoneyOverview.self, "money-overview-current")
        XCTAssertEqual(cur.currency, "EUR")
        // price changes and hints in the server's shape
        let pc = #"{"total":1,"priceChanges":[{"productId":3,"name":"Butter","now":2.39,"before":1.99,"pct":20.1,"direction":"up","shops":["REWE","Aldi"]}],"hints":[{"kind":"cheaper_shop","text":"Butter ist bei Aldi günstiger"}]}"#
        let x = try JSONCoding.decoder().decode(MoneyOverview.self, from: Data(pc.utf8))
        XCTAssertEqual(x.priceChanges.first?.after, 2.39)
        XCTAssertEqual(x.priceChanges.first?.shop, "REWE, Aldi")
        XCTAssertEqual(x.hints.first?.kind, "cheaper_shop")
    }

    func testBillingStatus() throws {
        let b = try decode(BillingStatus.self, "billing-status")
        XCTAssertEqual(b.plan, "trial")
        XCTAssertEqual(b.assistantUsed, 0)
        XCTAssertEqual(b.assistantLimit, 1500)
        XCTAssertEqual(b.storageLimitBytes, 5_368_709_120)
        XCTAssertEqual(b.storageUsedBytes, 5_867_772)
        XCTAssertFalse(b.isPaid)
        XCTAssertNotNil(ServerDate.parse(b.trialEndsAt))
    }

    func testAuthResponses() throws {
        let a = try decode(AppAuthResponse.self, "auth-app")
        XCTAssertTrue(a.token.hasPrefix("sw_app_"))
        XCTAssertEqual(a.householdId, "1ebb0595-5608-40c3-93d6-47d91417735d")
        XCTAssertEqual(a.households.first?.name, "Familie Berg")
        XCTAssertEqual(a.households.first?.trialEndsAt, "2026-10-26 13:26:36")
        XCTAssertEqual(a.userName, "Sam")
        let s = try decode(AppAuthResponse.self, "signup")
        XCTAssertEqual(s.householdId, "1ebb0595-5608-40c3-93d6-47d91417735d")
        XCTAssertTrue(s.households.isEmpty)
        let me = try decode(CloudMe.self, "cloud-me")
        XCTAssertEqual(me.email, "sam@example.org")
        XCTAssertFalse(me.verified)
        XCTAssertEqual(me.allHouseholds.count, 1)
        let devices = try JSONCoding.decoder().decode(Lossy<AppDevice>.self, from: try fixture("devices")).wrappedValue
        XCTAssertEqual(devices.count, 2)
        XCTAssertEqual(devices.first?.current, true)
        XCTAssertEqual(devices.first?.label, "Test iPhone")
        let link = try decode(JSONValue.self, "web-link")
        XCTAssertEqual(link["expiresIn"]?.int, 60)
        XCTAssertTrue(link["url"]?.string?.contains("/api/auth/app/web-link/") == true)
        let mine = try decode(MeResponse.self, "me")
        XCTAssertEqual(mine.name, "Sam")
    }

    func testInstance() throws {
        let i = try decode(InstanceInfo.self, "instance")
        XCTAssertTrue(i.isCloud)
        XCTAssertTrue(i.billingApple)
        XCTAssertFalse(i.assistantEnabled, "no AI key on the fixture server")
        XCTAssertEqual(i.passwordMin, 10)
        XCTAssertNil(i.legal?.privacy)
    }

    func testChatAndOthers() throws {
        let c = try decode(ChatResponse.self, "chat")
        XCTAssertNotNil(c.conversationId)
        XCTAssertEqual(c.mode, "basic")
        XCTAssertEqual(c.actions.first?.kind, "list_add")
        XCTAssertEqual(c.actions.first?.undo?.count, 32)
        let u = try decode(JSONValue.self, "undo")
        XCTAssertEqual(u["ok"]?.bool, true)
        let up = try decode(ImportUploadResponse.self, "imports-upload")
        XCTAssertEqual(up.results.first?.id, 6)
        let s = try decode(SyncResponse.self, "sync")
        XCTAssertEqual(s.results.map(\.opId), ["ios-test-1"])
        XCTAssertEqual(s.results.first?.ok, true)
        let b = try decode(BarcodeLookup.self, "barcode")
        XCTAssertEqual(b.remoteName, "Haferdrink")
        XCTAssertNil(b.local)
    }

    func testErrorMapping() async throws {
        // 402 quota.assistant / 429 quota.receiptAi / 413 storage.full, served by a stub URLProtocol
        StubProtocol.responses = [
            "/api/a": (402, #"{"error":"Alle","code":"quota.assistant","remaining":0}"#),
            "/api/b": (429, #"{"error":"Zu viele Fotos","code":"quota.receiptAi","remaining":0}"#),
            "/api/c": (413, #"{"error":"Voll","key":"storage.full"}"#),
            "/api/d": (404, #"{"error":"not found"}"#),
        ]
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://stub.example")!, token: "sw_app_x", session: URLSession(configuration: config))
        do { _ = try await api.get("api/a", as: Ignored.self); XCTFail() } catch let e as APIError { XCTAssertEqual(e, .quota("Alle")) }
        do { _ = try await api.get("api/b", as: Ignored.self); XCTFail() } catch let e as APIError { XCTAssertEqual(e, .quota("Zu viele Fotos")) }
        do { _ = try await api.get("api/c", as: Ignored.self); XCTFail() } catch let e as APIError { XCTAssertEqual(e, .storageFull("Voll")) }
        do { _ = try await api.get("api/d", as: Ignored.self); XCTFail() } catch let e as APIError { XCTAssertEqual(e, .notFound) }
    }

    func testServerDates() {
        XCTAssertNotNil(ServerDate.parse("2026-10-12 07:10:00"))
        XCTAssertNotNil(ServerDate.parse("2026-10-12T07:10:00Z"))
        XCTAssertNotNil(ServerDate.parse("2026-10-12T07:10:00.123Z"))
        XCTAssertNotNil(ServerDate.parse("2026-10-12"))
        XCTAssertNil(ServerDate.parse("gestern"))
    }

    func testImageURLs() {
        let api = APIClient(baseURL: URL(string: "https://cloud.example.org")!)
        XCTAssertEqual(api.imageURL("p4.webp")?.absoluteString, "https://cloud.example.org/img/p4.webp")
        XCTAssertEqual(api.imageURL("/img/p4.webp")?.absoluteString, "https://cloud.example.org/img/p4.webp")
        // signed URLs keep their query
        XCTAssertEqual(api.imageURL("/img/r1-3f35.webp?h=hcy&e=1792454400&s=E2Jc_-x")?.absoluteString,
                       "https://cloud.example.org/img/r1-3f35.webp?h=hcy&e=1792454400&s=E2Jc_-x")
        XCTAssertEqual(api.imageURL("https://x.org/a.jpg")?.absoluteString, "https://x.org/a.jpg")
        XCTAssertNil(api.imageURL(nil))
    }
}

/// Serves canned HTTP responses by path.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var responses: [String: (Int, String)] = [:]
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, body) = Self.responses[request.url?.path ?? ""] ?? (200, "{}")
        let resp = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
