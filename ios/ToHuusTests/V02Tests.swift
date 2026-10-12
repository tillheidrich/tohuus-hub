import XCTest
@testable import ToHuus

/// 0.2: tolerant decoding of the endpoints that may not be on the server yet, and the watch link format.
final class V02Tests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String, plain: Bool = false) throws -> T {
        let d = plain ? JSONDecoder() : JSONCoding.decoder()
        return try d.decode(T.self, from: Data(json.utf8))
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"), "missing fixture \(name)")
        return try Data(contentsOf: url)
    }

    func testNotifyPrefsRealShape() throws {
        let p = try JSONDecoder().decode(NotifyPrefs.self, from: try fixture("notify-prefs"))
        let addon = try XCTUnwrap(p.events.first { $0.key == "trip.addon" })
        XCTAssertTrue(addon.on, "apns is the iPhone switch")
        XCTAssertEqual(addon.title, "Etwas für meinen Einkauf", "the server's label wins")
        XCTAssertEqual(p.events.first { $0.key == "trip.started" }?.on, false)
        XCTAssertEqual(p.quietHours, .init(enabled: true, from: "22:00", to: "07:00"))
        XCTAssertFalse(p.household)
        let off = try JSONDecoder().decode(NotifyPrefs.self, from: Data(#"{"events":[],"quiet":null}"#.utf8))
        XCTAssertEqual(off.quietHours?.enabled, false)
        let o = try decode(NotifyPrefs.self, #"{"events":{"stock.low":{"push":true},"test":{"push":true},"budget.warning":false}}"#, plain: true)
        XCTAssertEqual(o.events.map(\.key), ["budget.warning", "stock.low"], "sorted, test event left out")
    }

    func testNotifyPrefsFromHouseholdSettingsKeepsKeys() throws {
        let settings = try decode(JSONValue.self, #"{"notify":{"events":{"auth.new_device":{"ha":false,"webhook":false,"ntfy":false,"email":true,"push":true}}}}"#, plain: true)
        let p = try XCTUnwrap(NotifyPrefs.fromSettings(settings))
        XCTAssertTrue(p.household)
        XCTAssertEqual(p.events.first?.key, "auth.new_device", "plain decoding keeps snake_case event keys")
        XCTAssertEqual(p.events.first?.title, NotifyPrefs.title(for: "auth.new_device"))
        XCTAssertEqual(p.raw["auth.new_device"]?["email"]?.bool, true)
    }

    func testAIStatusAndSettings() throws {
        let st = try JSONCoding.decoder().decode(AIStatus.self, from: try fixture("assistant-status"))
        XCTAssertEqual(st.ai, false)
        XCTAssertEqual(st.household, true)
        XCTAssertEqual(st.personal, true)
        XCTAssertEqual(st.locked, false)
        XCTAssertEqual(st.reason, "no_model")
        let set = try JSONCoding.decoder().decode(AISettings.self, from: try fixture("ai-settings"))
        XCTAssertEqual(set.admin, true)
        XCTAssertEqual(set.kids?.first?.name, "Mika")
        XCTAssertEqual(set.kids?.first?.ai, true)
        let nested = try decode(AIStatus.self, #"{"ai":{"enabled":true,"household":true,"personal":false,"locked":false},"voice":true}"#)
        XCTAssertEqual(nested.personal, false)
    }

    func testTripsListsEstimateAndRows() throws {
        let trips = try JSONCoding.decoder().decode(Lossy<Trip>.self, from: try fixture("trips")).wrappedValue
        let t = try XCTUnwrap(trips.first)
        XCTAssertTrue(t.isMine)
        XCTAssertEqual(t.user.name, "Sam")
        XCTAssertEqual(t.store?.name, "Lidl")
        XCTAssertEqual(t.basket.map(\.text), ["Brot", "Eier"])
        XCTAssertEqual(t.openAddOns.map(\.text), ["Hafermilch"])
        let lists = try JSONCoding.decoder().decode(Lossy<ListRef>.self, from: try fixture("list-lists")).wrappedValue
        XCTAssertEqual(lists.map(\.id.value), ["0", "1"])
        XCTAssertTrue(lists[0].isMain)
        XCTAssertEqual(lists[1].kind, "store")
        let est = try JSONCoding.decoder().decode(Estimate.self, from: try fixture("list-estimate"))
        XCTAssertEqual(est.priced, 0)
        XCTAssertEqual(est.unpricedNames?.count, 9)
        let usuals = try JSONCoding.decoder().decode(Lossy<Usual>.self, from: try fixture("list-usuals")).wrappedValue
        XCTAssertFalse(usuals.isEmpty)
        let g = try JSONCoding.decoder().decode(GuardResponse.self, from: try fixture("list-guard"))
        XCTAssertTrue(g.hints.isEmpty)
        let hint = try decode(GuardResponse.self, #"{"hints":[{"kind":"bought","text":"laut Bon vorgestern gekauft","day":"2026-10-10"},{"kind":"on_list","text":"steht schon drauf"}]}"#)
        XCTAssertEqual(hint.hints.first(where: \.asks)?.kind, "bought")
        // rows: last receipt price for the expected total when the server has no estimate
        let l = try decode(ShopList.self, #"{"sections":[{"key":"chilled","items":[{"id":1,"text":"Milch","qty":2,"substitute":"exact","photo_path":"/img/l1.webp","last_bought":{"price":1.09,"shop":"Lidl"},"price_hint":"am günstigsten bei Aldi: 0,99 €"},{"id":2,"text":"Butter"}]}]}"#)
        let milk = try XCTUnwrap(l.openItems.first)
        XCTAssertEqual(milk.photoPath, "/img/l1.webp")
        XCTAssertEqual(milk.priceHint, "am günstigsten bei Aldi: 0,99 €")
        let e = try XCTUnwrap(l.expected)
        XCTAssertEqual(e.total ?? 0, 2.18, accuracy: 0.001)
        XCTAssertEqual(e.priced, 1)
        XCTAssertEqual(e.unpriced, 1)
    }

    func testHouseGuideOffersImportsFacts() throws {
        let g = try JSONCoding.decoder().decode(HouseGuide.self, from: try fixture("house-guide"))
        XCTAssertEqual(g.cards.first?.title, "Müll")
        let code = try XCTUnwrap(g.codes.first)
        XCTAssertEqual(code.hasValue, true)
        XCTAssertEqual(code.masked?.contains("•"), true)
        let raw = String(decoding: try fixture("house-guide"), as: UTF8.self)
        XCTAssertFalse(raw.contains("geheim123"), "lists never carry a code value")
        let offers = try JSONCoding.decoder().decode(Lossy<Offer>.self, from: try fixture("offers")).wrappedValue
        XCTAssertEqual(offers.first?.name, "Butter 250 g")
        XCTAssertEqual(offers.first?.price, 1.49)
        XCTAssertEqual(offers.first?.shop, "Lidl")
        let receipt = try JSONCoding.decoder().decode(LinesImport.self, from: try fixture("imports-lines-receipt"))
        XCTAssertEqual(receipt.kind, "receipt")
        XCTAssertNotNil(receipt.id)
        XCTAssertEqual(receipt.sumMatches, true)
        let list = try JSONCoding.decoder().decode(LinesImport.self, from: try fixture("imports-lines-list"))
        XCTAssertEqual(list.kind, "list")
        XCTAssertTrue(list.items.contains { $0.name == "Milch" && $0.qty == 2 })
        let facts = try JSONCoding.decoder().decode(FactsResponse.self, from: try fixture("facts")).facts
        XCTAssertFalse(facts.isEmpty)
        XCTAssertTrue(facts.allSatisfy { !$0.sources.isEmpty }, "every fact has its source")
    }

    func testShopListRoundTripsForTheWatch() throws {
        let list = try JSONCoding.decoder().decode(ShopList.self, from: Data(#"{"stores":[{"id":1,"name":"Aldi"}],"sections":[{"key":"produce","items":[{"id":3,"text":"Bananen","origin":"merkt sich"}]}]}"#.utf8))
        let data = try JSONCoding.encoder().encode(list)
        let back = try JSONCoding.decoder().decode(ShopList.self, from: data)
        XCTAssertEqual(back.openItems.first?.text, "Bananen")
        XCTAssertEqual(back.openItems.first?.origin, "merkt sich")
        XCTAssertEqual(back.stores.first?.name, "Aldi")
    }

    func testWatchLinkMessages() throws {
        let s = WatchLink.Session(server: URL(string: "https://cloud.example")!, mode: "cloud", household: "h1", token: "sw_app_x")
        XCTAssertEqual(WatchLink.Session(s.dictionary), s)
        XCTAssertNil(WatchLink.Session(["t": "session", "server": "https://x", "token": "nope"]), "only app tokens are taken")
        let ops = [PendingOp.check(5, on: true, toStock: true), PendingOp.add("Milch", localId: -1)]
        let msg = try XCTUnwrap(WatchLink.ops(ops))
        XCTAssertEqual(WatchLink.decodeOps(msg)?.map(\.opId), ops.map(\.opId))
        let ctx = WatchLink.Context(list: Data("{}".utf8), open: 3, nextDue: "Milch", household: nil, ackOps: ["a"], signedIn: true)
        let back = try XCTUnwrap(WatchLink.Context(ctx.dictionary))
        XCTAssertEqual(back.open, 3)
        XCTAssertEqual(back.nextDue, "Milch")
        XCTAssertEqual(back.ackOps, ["a"])
        let action = WatchLink.action("addon-accept", data: ["request_id": "12"])
        XCTAssertEqual(WatchLink.decodeAction(action)?.data["request_id"], "12")
    }

    func testNotificationActionBody() {
        let body = NotifyKit.actionBody("shop-add", data: ["product_id": "42", "note": "x"])
        XCTAssertEqual(body["action"] as? String, "shop-add")
        let data = body["data"] as? [String: Any]
        XCTAssertEqual(data?["product_id"] as? Int, 42)
        XCTAssertEqual(data?["note"] as? String, "x")
        XCTAssertEqual(NotifyKit.Action.addonAccept.serverAction, "addon-accept")
        XCTAssertNil(NotifyKit.Action.openList.serverAction)
    }

    func testDragPayloads() {
        XCTAssertEqual(ItemDrag(payload: ItemDrag(id: 9).payload)?.id, 9)
        XCTAssertNil(ItemDrag(payload: "Milch"))
        XCTAssertEqual(PlanDrag(payload: PlanDrag(id: 4).payload)?.id, 4)
        XCTAssertNil(PlanDrag(payload: "tohuus-item:4"))
    }
}
