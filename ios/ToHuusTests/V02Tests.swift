import XCTest
@testable import ToHuus

/// 0.2: tolerant decoding of the endpoints that may not be on the server yet, and the watch link format.
final class V02Tests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String, plain: Bool = false) throws -> T {
        let d = plain ? JSONDecoder() : JSONCoding.decoder()
        return try d.decode(T.self, from: Data(json.utf8))
    }

    func testNotifyPrefsArrayAndObject() throws {
        let a = try decode(NotifyPrefs.self, #"{"events":[{"event":"shopping.addon","push":true},{"key":"auth.new_device","on":false,"locked":true}],"quietHours":{"enabled":true,"from":"21:30","to":"06:45"}}"#, plain: true)
        XCTAssertEqual(a.events.map(\.key), ["shopping.addon", "auth.new_device"])
        XCTAssertEqual(a.events.map(\.on), [true, false])
        XCTAssertTrue(a.events[1].locked)
        XCTAssertEqual(a.quietHours, .init(enabled: true, from: "21:30", to: "06:45"))
        let o = try decode(NotifyPrefs.self, #"{"events":{"stock.low":{"push":true},"test":{"push":true},"budget.warning":false}}"#, plain: true)
        XCTAssertEqual(o.events.map(\.key), ["budget.warning", "stock.low"], "sorted, test event left out")
        XCTAssertFalse(o.household)
    }

    func testNotifyPrefsFromHouseholdSettingsKeepsKeys() throws {
        let settings = try decode(JSONValue.self, #"{"notify":{"events":{"auth.new_device":{"ha":false,"webhook":false,"ntfy":false,"email":true,"push":true}}}}"#, plain: true)
        let p = try XCTUnwrap(NotifyPrefs.fromSettings(settings))
        XCTAssertTrue(p.household)
        XCTAssertEqual(p.events.first?.key, "auth.new_device", "plain decoding keeps snake_case event keys")
        XCTAssertEqual(p.events.first?.title, NotifyPrefs.title(for: "auth.new_device"))
        XCTAssertEqual(p.raw["auth.new_device"]?["email"]?.bool, true)
    }

    func testAIStatusShapes() throws {
        let flat = try decode(AIStatus.self, #"{"ai":false,"voice":false,"receiptsAi":true,"locked":true}"#)
        XCTAssertEqual(flat.ai, false)
        XCTAssertEqual(flat.locked, true)
        let nested = try decode(AIStatus.self, #"{"ai":{"enabled":true,"household":true,"personal":false,"locked":false},"voice":true}"#)
        XCTAssertEqual(nested.ai, true)
        XCTAssertEqual(nested.personal, false)
        XCTAssertEqual(nested.locked, false)
    }

    func testChildFromMe() throws {
        let kid = try decode(MeResponse.self, #"{"actor":{"kind":"kid","name":"Mika"}}"#)
        XCTAssertTrue(kid.isChild)
        let adult = try decode(MeResponse.self, #"{"actor":{"kind":"user","name":"Sam","role":"admin"}}"#)
        XCTAssertFalse(adult.isChild)
    }

    func testShopListLiveFieldsAndExpectedTotal() throws {
        let l = try decode(ShopList.self, #"""
        {"sections":[{"key":"chilled","items":[{"id":1,"text":"Milch","qty":2,"price":1.09,"substitute":"ask"},{"id":2,"text":"Butter"}]}],
         "shoppers":[{"user_id":2,"name":"Mira","store":"Lidl","since":"2026-10-12 08:00:00"}],
         "requests":[{"id":7,"text":"Hafermilch","by":"Ben","status":"open"},{"id":8,"text":"Eis","status":"declined"}],
         "lists":[{"id":1,"name":"Einkauf"},{"id":"drog","name":"Drogerie","open":3}],"list":{"id":1,"name":"Einkauf"}}
        """#)
        XCTAssertEqual(l.shoppers.first?.name, "Mira")
        XCTAssertEqual(l.shoppers.first?.userId, 2)
        XCTAssertEqual(l.requests.filter(\.isOpen).map(\.id), [7])
        XCTAssertEqual(l.lists.map(\.id.value), ["1", "drog"])
        XCTAssertEqual(l.openItems.first?.substitute, "ask")
        let est = try XCTUnwrap(l.expected)
        XCTAssertEqual(est.total ?? 0, 2.18, accuracy: 0.001)
        XCTAssertEqual(est.known, 1)
        XCTAssertEqual(est.count, 2)
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

    func testFactsShapes() throws {
        let a = try decode(FactsResponse.self, #"[{"id":1,"title":"Brot einfrieren","text":"…","source":{"name":"BZfE","url":"https://www.bzfe.de"}}]"#)
        XCTAssertEqual(a.facts.first?.source, "BZfE")
        XCTAssertEqual(a.facts.first?.sourceUrl, "https://www.bzfe.de")
        let b = try decode(FactsResponse.self, #"{"facts":[{"slug":"eier","title":"Eier","source":"Verbraucherzentrale"},{"broken":true}]}"#)
        XCTAssertEqual(b.facts.map(\.id), ["eier"])
    }

    func testDragPayloads() {
        XCTAssertEqual(ItemDrag(payload: ItemDrag(id: 9).payload)?.id, 9)
        XCTAssertNil(ItemDrag(payload: "Milch"))
        XCTAssertEqual(PlanDrag(payload: PlanDrag(id: 4).payload)?.id, 4)
        XCTAssertNil(PlanDrag(payload: "tohuus-item:4"))
    }
}
