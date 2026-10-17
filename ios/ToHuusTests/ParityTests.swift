import XCTest
@testable import ToHuus

/// Mehr like the web (14 Oct 2026): the guest/area filters and the payloads of Pflege and Hausinfo.
/// The JSON is written after server/routes/home.ts (/api/care) and server/routes/house-guide.ts.
final class ParityTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.decoder().decode(T.self, from: Data(json.utf8))
    }

    /// same answers as web/src/people/access.ts guestAllows (checked against the TS with node)
    func testGuestAllowsLikeTheWeb() {
        XCTAssertTrue(MoreAccess.guestAllows(nil, "/pflege"), "people who live here see everything")
        XCTAssertFalse(MoreAccess.guestAllows("paused", "/hausinfo"))
        XCTAssertTrue(MoreAccess.guestAllows("order", "/hausinfo"))
        XCTAssertFalse(MoreAccess.guestAllows("order", "/wo"))
        XCTAssertTrue(MoreAccess.guestAllows("stock", "/wo"))
        XCTAssertFalse(MoreAccess.guestAllows("stock", "/lieblinge"))
        XCTAssertTrue(MoreAccess.guestAllows("recipes", "/lieblinge"))
        XCTAssertFalse(MoreAccess.guestAllows("family", "/pflege"))
        XCTAssertFalse(MoreAccess.guestAllows("family", "/urlaub"))
        XCTAssertTrue(MoreAccess.guestAllows("family", "/bar"))
        XCTAssertFalse(MoreAccess.guestAllows("family", "/einkauf/wuensche"), "wish lists are never for guests")
        XCTAssertTrue(MoreAccess.guestAllows("order", "/einstellungen?tab=members"))
    }

    func testAreasLikeTheWeb() {
        XCTAssertEqual(MoreAccess.moduleOf("/pflege"), "homeinfo")
        XCTAssertNil(MoreAccess.moduleOf("/hausinfo"), "Hausinfo stays when Pflege & Hausinfo is off, like the web")
        XCTAssertEqual(MoreAccess.moduleOf("/einstellungen?tab=ha"), "ha")
        XCTAssertFalse(MoreAccess.moduleAllows(["guests": false], "/bar"))
        XCTAssertTrue(MoreAccess.moduleAllows([:], "/bar"))
    }

    func testCare() throws {
        let d = try decode(CareData.self, """
        {"tasks":[{"id":3,"name":"Wasserfilter wechseln","template":"water-filter","interval_n":4,"interval_unit":"week",
          "next_due":"2026-10-15","last_done":"2026-09-17","lead_days":3,"location_id":null,"product_id":12,"consume_qty":1,
          "assignee_user_id":2,"note":null,"state":"soon","days":1,
          "product":{"id":12,"name":"Brita Maxtra","brand":null,"image_path":null,"unit":"pcs","track_mode":"count","stock":0},
          "location":null,"assignee":{"id":2,"name":"Mira","color":"#C56B4B"}},
         {"id":4,"name":"Reisepass Mika","template":"passport","interval_n":null,"interval_unit":null,"next_due":"2029-03-01",
          "last_done":null,"lead_days":90,"location_id":null,"product_id":null,"consume_qty":1,"assignee_user_id":null,"note":null,
          "state":"ok","days":1234,"product":null,"location":null,"assignee":null}],
         "templates":[{"key":"water-filter","name":"Change water filter","n":4,"unit":"week","product":"Brita Maxtra","group":"kitchen","added":true},
                      {"key":"passport","name":"Passport / ID card expires","n":null,"unit":null,"lead":90,"group":"papers","added":false}],
         "users":[{"id":2,"name":"Mira","color":"#C56B4B"}],"today":"2026-10-14"}
        """)
        XCTAssertEqual(d.tasks.count, 2)
        XCTAssertTrue(d.tasks[0].isDueNow)
        XCTAssertEqual(d.tasks[0].assignee?.name, "Mira")
        XCTAssertEqual(d.tasks[0].product?.stock, 0)
        XCTAssertFalse(d.tasks[1].isDueNow)
        XCTAssertNil(d.tasks[1].intervalN, "fixed date: done asks for the new date")
        XCTAssertEqual(d.templates.filter { $0.added != true }.map(\.key), ["passport"])
        XCTAssertEqual(CareLabels.interval(4, "week"), LF("every %d weeks", 4))
        XCTAssertEqual(CareLabels.interval(nil, nil), L("fixed date"))
        XCTAssertEqual(CareLabels.due(d.tasks[0]), L("due tomorrow"))

        let done = try decode(CareDoneResult.self, """
        {"task":{"id":3,"name":"Wasserfilter wechseln","next_due":"2026-11-12","state":"ok","days":29,
          "product":{"id":12,"name":"Brita Maxtra","stock":0}},"consumed":1,"on_shopping_list":true}
        """)
        XCTAssertEqual(done.onShoppingList, true)
        XCTAssertEqual(done.task.nextDue, "2026-11-12")
    }

    func testHouseGuideForAdmins() throws {
        let g = try decode(HouseGuide.self, """
        {"cards":[{"id":1,"type":"voice","topic":"light","area":"Wohnzimmer","title":"Licht","body":"","detail":null,
           "assistant":"alexa","sort":0,"draft":true,"hint":"What do you say to switch the light on?",
           "visibility":{"members":true,"guest_level":"order","sitters":true,"links":[]}},
          {"id":2,"type":"contact","topic":"numbers","area":null,"title":"Notruf","body":"112","detail":null,"assistant":null,"sort":1,
           "draft":false,"visibility":{"members":true,"guest_level":"order","sitters":true,"links":[{"id":5,"until":null,"name":"Babysitter"}]}}],
         "codes":[{"id":9,"kind":"wifi","label":"Gäste-WLAN","area":null,"note":null,"sort":0,"has_value":true,"masked":"••••",
           "wifi":{"ssid":"Berg-Gast","security":"WPA","hidden":false},
           "visibility":{"members":true,"guest_level":null,"sitters":false,"links":[{"id":5,"until":"2026-10-20"}]},
           "last_views":[{"viewer":"Babysitter","via":"link","at":"2026-10-13 19:02:11"}]}],
         "ha_voice":{"assistant":"alexa","assistant_name":"Alexa","items":[],
           "groups":[{"area":"Küche","items":[{"id":7,"entity_id":"light.kitchen","name":"Küchenlicht","area":"Küche","domain":"light",
             "phrases":["Alexa, Küchenlicht an"],"kind":"device"}]}]},
         "areas":["Wohnzimmer"],"can_edit":true,"assistant":"alexa"}
        """)
        XCTAssertEqual(g.cards.first?.isDraft, true)
        XCTAssertEqual(g.cards.first?.hint, "What do you say to switch the light on?")
        XCTAssertEqual(g.cards.last?.visibility?.links?.first?.id, 5)
        XCTAssertEqual(g.codes.first?.lastViews?.first?.via, "link")
        XCTAssertEqual(g.codes.first?.visibility?.links?.first?.until, "2026-10-20")
        XCTAssertEqual(g.haVoice?.assistantName, "Alexa")
        XCTAssertEqual(g.haVoice?.groups.first?.items.first?.phrases?.first, "Alexa, Küchenlicht an")
        XCTAssertEqual(HouseGuideView.telURL("112")?.absoluteString, "tel:112")
        XCTAssertEqual(HouseGuideView.telURL("+49 (40) 123-45")?.absoluteString, "tel:+494012345")
        XCTAssertNil(HouseGuideView.telURL("Frau Berg nebenan"))
    }

    func testHouseLinkSelection() throws {
        let s = try decode(HouseLinkSelection.self, """
        {"link":{"id":5,"name":"Babysitter","custom":false,"expires_at":"2026-10-20 22:00:00"},
         "cards":[{"id":2,"title":"Notruf","area":null,"topic":"numbers","type":"contact","shown":true}],
         "codes":[{"id":9,"label":"Gäste-WLAN","kind":"wifi","area":null,"shown":false,"until":null}]}
        """)
        XCTAssertEqual(s.link.custom, false)
        XCTAssertEqual(s.link.expiresAt, "2026-10-20 22:00:00")
        XCTAssertEqual(s.cards.first?.shown, true)
        XCTAssertEqual(s.codes.first?.shown, false)
        let log = try decode(Lossy<HouseLogEntry>.self, """
        [{"code_id":9,"label":"Gäste-WLAN","viewer":"Babysitter","via":"link","at":"2026-10-13 19:02:11"}]
        """).wrappedValue
        XCTAssertEqual(log.first?.codeId, 9)
    }
}
