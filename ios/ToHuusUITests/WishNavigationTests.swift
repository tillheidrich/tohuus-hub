import XCTest

/// Wish lists: one tap on a list opens exactly that list – from every way in (Build 22 bug, 20 Oct 2026: from Mehr
/// the tap on an empty list seemed to do nothing until one went back). Needs a test server like the audit tests:
///   TEST_RUNNER_TOHUUS_SERVER=http://localhost:8141 TEST_RUNNER_TOHUUS_TOKEN=<app token> TEST_RUNNER_TOHUUS_HOUSEHOLD=<id> \
///   xcodebuild test -scheme ToHuus -only-testing:ToHuusUITests/WishNavigationTests …
/// Each test makes a new, empty list through the API, so it never depends on what else is on the server.
@MainActor
final class WishNavigationTests: XCTestCase {
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUp() {
        continueAfterFailure = false
    }

    private func server() throws -> (String, String, String) {
        guard let s = env["TOHUUS_SERVER"], let t = env["TOHUUS_TOKEN"], let h = env["TOHUUS_HOUSEHOLD"] else {
            throw XCTSkip("no test server (TOHUUS_SERVER / TOHUUS_TOKEN / TOHUUS_HOUSEHOLD)")
        }
        return (s, t, h)
    }

    /// POST /api/wishes/lists – a new empty list; returns its id and name
    /// POST with the test account; returns the new object's id
    private func post(_ path: String, _ body: [String: Any]) throws -> Int {
        let (s, t, h) = try server()
        var req = URLRequest(url: URL(string: "\(s)\(path)")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
        req.setValue(h, forHTTPHeaderField: "X-Household")
        req.setValue("ios", forHTTPHeaderField: "X-ToHuus-Client")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let done = expectation(description: path)
        var id: Int?
        URLSession.shared.dataTask(with: req) { data, _, _ in
            if let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { id = obj["id"] as? Int }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        guard let id else { throw XCTSkip("the test server did not answer \(path)") }
        return id
    }

    /// a new empty list (POST /api/wishes/lists); returns its id and name
    private func makeEmptyList(eventDate: String? = nil) throws -> (Int, String) {
        let name = "UI-Test \(Int(Date().timeIntervalSince1970) % 100_000)"
        var body: [String: Any] = ["name": name, "occasion": "birthday", "visibility": "household"]
        if let eventDate { body["event_date"] = eventDate }
        return (try post("/api/wishes/lists", body), name)
    }

    private func launch(_ extra: [String]) throws -> XCUIApplication {
        let (s, t, h) = try server()
        let app = XCUIApplication()
        app.launchArguments = ["-debugServer", s, "-debugToken", t, "-debugHousehold", h,
                               "-AppleLanguages", "(de)", "-AppleLocale", "de_DE"] + extra
        app.launch()
        return app
    }

    /// a screenshot next to the failure (TOHUUS_SHOTS=<dir> on the host, e.g. /tmp/wishfix-shots)
    private func snap(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: shot)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        if let dir = env["TOHUUS_SHOTS"] { try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/test-\(name).png")) }
    }

    /// the row of the list – the overview may be longer than the screen
    private func row(_ app: XCUIApplication, _ id: Int) -> XCUIElement {
        let row = app.buttons["wishes.list.\(id)"]
        _ = app.navigationBars["Wünsche"].waitForExistence(timeout: 15)
        var n = 0
        while !(row.exists && row.isHittable) && n < 8 { app.swipeUp(); n += 1 }
        return row
    }

    /// tap the list once → its own page with its own empty state; back → the overview
    private func openAndCheck(_ app: XCUIApplication, id: Int, name: String, _ label: String) {
        let row = row(app, id)
        XCTAssertTrue(row.waitForExistence(timeout: 5), "list row in the overview")
        snap("\(label)-1-overview")
        row.tap()
        let opened = app.navigationBars[name].waitForExistence(timeout: 8)
        snap("\(label)-2-after-tap")
        XCTAssertTrue(opened, "one tap opens the list")
        XCTAssertTrue(app.staticTexts["Noch keine Wünsche"].waitForExistence(timeout: 8), "the list's own empty state")
        XCTAssertTrue(app.buttons["Wunsch hinzufügen"].exists, "the button of the empty state")
        XCTAssertFalse(app.staticTexts["Deine erste Wunschliste"].exists, "not the overview's empty state")
        app.navigationBars[name].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Wünsche"].waitForExistence(timeout: 8), "back leads to the overview")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        // and once more: the same tap opens it again, no double push
        row.tap()
        XCTAssertTrue(app.navigationBars[name].waitForExistence(timeout: 8), "second tap opens the list again")
        app.navigationBars[name].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Wünsche"].waitForExistence(timeout: 8), "one back step – no second copy of the list")
    }

    /// Wünsche as an area (tab bar or its own sheet)
    func testOpenListFromWishesArea() throws {
        let (id, name) = try makeEmptyList()
        let app = try launch(["-debugTab", "wishes"])
        openAndCheck(app, id: id, name: name, "area")
    }

    /// Mehr › Wunschlisten & Geschenke (a view link on top of the Settings path – where Build 22 failed)
    func testOpenListFromMore() throws {
        let (id, name) = try makeEmptyList()
        let app = try launch(["-debugSettings", "YES"])
        let row = app.buttons["Wunschlisten & Geschenke"]
        XCTAssertTrue(row.waitForExistence(timeout: 15), "Mehr shows the wish lists")
        row.tap()
        XCTAssertTrue(app.navigationBars["Wünsche"].waitForExistence(timeout: 8))
        openAndCheck(app, id: id, name: name, "more")
    }

    /// the door on top of Einkauf (a sheet with its own stack)
    func testOpenListFromShopping() throws {
        let (id, name) = try makeEmptyList()
        let app = try launch(["-debugTab", "shopping", "-debugWishes", "YES"])
        openAndCheck(app, id: id, name: name, "shopping")
    }

    /// "Erinnern": the suggested day (10 days before the occasion) is chosen from the start, a tap chooses another
    func testReminderSuggestsTenDaysBefore() throws {
        let day = Calendar.current.date(byAdding: .day, value: 30, to: Date())!
        let c = Calendar.current.dateComponents([.year, .month, .day], from: day)
        let (id, _) = try makeEmptyList(eventDate: String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!))
        let wid = try post("/api/wishes/lists/\(id)/items", ["title": "Malkasten", "price": 24.9])
        let app = try launch(["-debugTab", "wishes", "-debugWishes", "list:\(id)/remind:\(wid)"])
        let ten = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '10 Tage'")).firstMatch
        XCTAssertTrue(ten.waitForExistence(timeout: 20))
        snap("remind-1")
        XCTAssertTrue(ten.isSelected, "the suggested day is chosen")
        let week = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '1 Woche'")).firstMatch
        week.tap()
        XCTAssertTrue(week.isSelected)
        XCTAssertFalse(ten.isSelected)
    }

    /// a new list opens right away, with its empty state
    func testNewListOpensIt() throws {
        _ = try server()
        let app = try launch(["-debugTab", "wishes", "-debugWishes", "new"])
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        let name = "Neu \(Int(Date().timeIntervalSince1970) % 100_000)"
        field.tap()
        field.typeText(name)
        app.buttons["Anlegen"].tap()
        XCTAssertTrue(app.navigationBars[name].waitForExistence(timeout: 10), "the new list is open")
        XCTAssertTrue(app.staticTexts["Noch keine Wünsche"].waitForExistence(timeout: 8))
        app.navigationBars[name].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Wünsche"].waitForExistence(timeout: 8))
    }
}
