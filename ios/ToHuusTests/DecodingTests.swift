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

    func testShopList() throws {
        let list = try decode(ShopList.self, "shop-list")
        XCTAssertEqual(list.stores.map(\.name), ["REWE", "Aldi"])
        XCTAssertEqual(list.sections.map(\.key), ["chilled", "other"])
        // the broken row is dropped, not the whole list
        XCTAssertEqual(list.openCount, 3)
        let milk = list.sections[0].items[0]
        XCTAssertEqual(milk.productId, 4)
        XCTAssertEqual(milk.productName, "Vollmilch")
        XCTAssertEqual(milk.qtyLabel, "2×")
        XCTAssertEqual(milk.claim?.name, "Till")
        XCTAssertFalse(milk.isInBasket)
        XCTAssertTrue(list.sections[1].items[0].buyAt == ["dm"])
        XCTAssertEqual(list.done.first?.isChecked, true)
        XCTAssertFalse(milk.originLine.isEmpty)
    }

    func testToday() throws {
        let t = try decode(TodayPayload.self, "today")
        XCTAssertEqual(t.greeting, "Guten Morgen, Till")
        XCTAssertEqual(t.householdName, "Familie Heidrich")
        XCTAssertEqual(t.rhythm.count, 2)
        XCTAssertEqual(t.rhythm[0].everyDays, 4.5)
        XCTAssertEqual(t.list?.open, 3)
        XCTAssertEqual(t.list?.recent.count, 2)
        XCTAssertEqual(t.list?.recent[1].id?.value, "x13")
        XCTAssertEqual(t.stillHave.map(\.name), ["Sahne", "Spinat"])
        XCTAssertEqual(t.stillHave[0].date, "2026-10-13")
        XCTAssertEqual(t.cookToday?.missing.map(\.name), ["Lasagneplatten", "Ricotta"])
        XCTAssertEqual(t.money?.budget, 600)
        XCTAssertEqual(t.notices.map(\.text), ["2 Bons warten auf Prüfung", "Testphase endet in 3 Tagen"])
    }

    func testTodayMinimal() throws {
        let t = try decode(TodayPayload.self, "today-minimal")
        XCTAssertEqual(t.householdName, "WG Rotdorn")
        XCTAssertTrue(t.rhythm.isEmpty)
        XCTAssertNil(t.cookToday)
        XCTAssertNil(t.money?.week)
    }

    func testProducts() throws {
        let p = try JSONCoding.decoder().decode(Lossy<ProductInfo>.self, from: try fixture("products")).wrappedValue
        XCTAssertEqual(p.count, 3)
        XCTAssertEqual(p[0].stock.first?.bestBefore, "2026-10-15")
        XCTAssertEqual(p[0].status, "low")
        XCTAssertEqual(p[0].amountLabel, "1 Stück")
        XCTAssertTrue(p[1].isLevel)
        XCTAssertFalse(p[2].isTracked)
        let d = try decode(ProductInfo.self, "product-detail")
        XCTAssertEqual(d.perWeek, 3.5)
        XCTAssertEqual(d.history.first?.delta, -1)
    }

    func testRecipeAndMatch() throws {
        let r = try decode(Recipe.self, "recipe")
        XCTAssertEqual(r.steps.map(\.text), ["Ofen vorheizen.", "Schichten."])
        XCTAssertEqual(r.ingredients.count, 2)
        XCTAssertEqual(r.favorite?.bool, true)
        let m = try JSONCoding.decoder().decode(Lossy<IngredientMatch>.self, from: try fixture("recipe-match")).wrappedValue
        XCTAssertEqual(m.map(\.atHome), [false, true, true])
    }

    func testCookIdeasBothShapes() throws {
        let ideas = try decode(CookIdeasResponse.self, "cook-ideas").ideas
        XCTAssertEqual(ideas.map(\.recipeId), [3, 4])
        XCTAssertEqual(ideas[1].missing.map(\.name), ["Eier"])
        XCTAssertEqual(ideas[0].reasons, ["Sahne muss weg"])
        let fromSuggest = try JSONCoding.decoder().decode(Lossy<CookIdea>.self, from: try fixture("recipes-suggest")).wrappedValue
        XCTAssertEqual(fromSuggest.first?.recipeId, 3)
        XCTAssertEqual(fromSuggest.first?.title, "Spinatlasagne")
        XCTAssertEqual(fromSuggest.first?.image, "r3.webp")
        XCTAssertEqual(fromSuggest.first?.missing.map(\.name), ["Lasagneplatten"])
        // a bare array is accepted too
        let arr = try JSONCoding.decoder().decode(CookIdeasResponse.self, from: Data(#"[{"recipeId":1,"title":"A","missing":[]}]"#.utf8))
        XCTAssertEqual(arr.ideas.count, 1)
    }

    func testPlan() throws {
        let p = try decode(PlanResponse.self, "plan")
        XCTAssertEqual(p.days.count, 2)
        XCTAssertEqual(p.entries.first?.recipeId, 3)
        XCTAssertEqual(p.entries.first?.isCooked, false)
    }

    func testMoneyOverview() throws {
        let m = try decode(MoneyOverview.self, "money-overview")
        XCTAssertEqual(m.total, 412.35)
        XCTAssertEqual(Set(m.byCategory.map(\.label)), ["Milchprodukte", "Obst & Gemüse"])
        XCTAssertEqual(m.byShop.first?.label, "REWE")
        XCTAssertEqual(m.byWeek.count, 2)
        XCTAssertEqual(m.vsLastMonth, 8.5)
        XCTAssertEqual(m.lastMonthTotal, 380)
        XCTAssertEqual(m.priceChanges.count, 2)
        XCTAssertEqual(m.priceChanges[0].pct ?? 0, 20.1, accuracy: 0.1)
        XCTAssertEqual(m.priceChanges[1].pct, -14.3)
        XCTAssertEqual(m.hints.count, 2)
        let alt = try decode(MoneyOverview.self, "money-overview-alt")
        XCTAssertEqual(alt.budget, 500)
        XCTAssertEqual(alt.vsLastMonth, -3.2)
        XCTAssertTrue(alt.byCategory.isEmpty)
    }

    func testBillingStatus() throws {
        let b = try decode(BillingStatus.self, "billing-status")
        XCTAssertEqual(b.plan, "trial")
        XCTAssertEqual(b.assistantUsed, 12)
        XCTAssertEqual(b.assistantLimit, 1500)
        XCTAssertEqual(b.storageUsedBytes, 10_485_760)
        XCTAssertEqual(b.storageLimitBytes, 5120 * 1_048_576)
        XCTAssertFalse(b.isPaid)
        XCTAssertNotNil(ServerDate.parse(b.trialEndsAt))
    }

    func testAuthResponses() throws {
        let a = try decode(AppAuthResponse.self, "auth-app")
        XCTAssertEqual(a.token, "sw_app_abc123")
        XCTAssertEqual(a.householdId, "6b1f9d2e-0f7a-4b8e-9c1d-2a3b4c5d6e7f")
        XCTAssertEqual(a.households.map(\.id.value), ["6b1f9d2e-0f7a-4b8e-9c1d-2a3b4c5d6e7f", "42"])
        XCTAssertEqual(a.userName, "Till")
        let s = try decode(AppAuthResponse.self, "auth-app-selfhost")
        XCTAssertEqual(s.householdId, "default")
        XCTAssertEqual(s.userName, "Lea")
    }

    func testInstance() throws {
        let i = try decode(InstanceInfo.self, "instance")
        XCTAssertTrue(i.isCloud)
        XCTAssertTrue(i.voiceEnabled)
        XCTAssertTrue(i.billingApple)
        XCTAssertEqual(i.legal?.imprint, "https://tohuus.heidrich-digital.de/impressum")
    }

    func testChatAndOthers() throws {
        let c = try decode(ChatResponse.self, "chat")
        XCTAssertEqual(c.conversationId?.value, "17")
        XCTAssertEqual(c.actions.count, 2)
        XCTAssertEqual(c.actions[0].undo?["id"]?.int, 12)
        XCTAssertNil(c.actions[1].undo)
        let r = try JSONCoding.decoder().decode(Lossy<RhythmItem>.self, from: try fixture("rhythm")).wrappedValue
        XCTAssertEqual(r.map(\.productId), [4])
        let u = try decode(ImportUploadResponse.self, "imports-upload")
        XCTAssertEqual(u.results.count, 2)
        XCTAssertEqual(u.results[0].id, 55)
        XCTAssertNotNil(u.results[1].error)
        let s = try decode(SyncResponse.self, "sync")
        XCTAssertEqual(s.results.map(\.opId), ["ios-1", "ios-2"])
        let b = try decode(BarcodeLookup.self, "barcode")
        XCTAssertEqual(b.remoteName, "Haferdrink")
        XCTAssertEqual(b.remoteImage, "https://images.openfoodfacts.org/x.jpg")
        XCTAssertNil(b.local)
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
        XCTAssertEqual(api.imageURL("https://x.org/a.jpg")?.absoluteString, "https://x.org/a.jpg")
        XCTAssertNil(api.imageURL(nil))
    }
}
