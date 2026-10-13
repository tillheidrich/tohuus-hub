import XCTest

/// Xcode accessibility audit (iOS 17+) over the main screens with real data. Run against a test server:
///   TEST_RUNNER_TOHUUS_SERVER=http://localhost:8097 TEST_RUNNER_TOHUUS_TOKEN=<app token> TEST_RUNNER_TOHUUS_HOUSEHOLD=<id> \
///   xcodebuild test -scheme ToHuus -only-testing:ToHuusUITests …
/// Every finding is printed as one "A11Y[screen] …" line and recorded; the run fails only when TOHUUS_AUDIT_STRICT=1.
/// Without a server the tests are skipped (the signed-out start screen is audited instead).
@MainActor
final class AccessibilityAuditTests: XCTestCase {
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private var strict: Bool { env["TOHUUS_AUDIT_STRICT"] == "1" }

    override func setUp() {
        continueAfterFailure = true
    }

    private func launch(_ extra: [String], signedIn: Bool = true) throws -> XCUIApplication {
        let app = XCUIApplication()
        var args: [String] = []
        if signedIn {
            guard let s = env["TOHUUS_SERVER"], let t = env["TOHUUS_TOKEN"], let h = env["TOHUUS_HOUSEHOLD"] else {
                throw XCTSkip("no test server (TOHUUS_SERVER / TOHUUS_TOKEN / TOHUUS_HOUSEHOLD)")
            }
            args += ["-debugServer", s, "-debugToken", t, "-debugHousehold", h]
        }
        if let size = env["TOHUUS_CONTENT_SIZE"] { args += ["-UIPreferredContentSizeCategoryName", size] }
        app.launchArguments = args + extra
        app.launch()
        _ = app.wait(for: .runningForeground, timeout: 10)
        sleep(UInt32(env["TOHUUS_AUDIT_WAIT"].flatMap(UInt32.init) ?? 6))
        return app
    }

    private func audit(_ name: String, _ extra: [String], signedIn: Bool = true) throws {
        let app = try launch(extra, signedIn: signedIn)
        final class Count { var n = 0 }
        let count = Count()
        let strict = self.strict
        try app.performAccessibilityAudit(for: .all) { issue in
            count.n += 1
            let el = issue.element
            let what = el.map { "\($0.elementType.rawValue) '\($0.label)' id=\($0.identifier) frame=\($0.frame)" } ?? "-"
            print("A11Y[\(name)] \(issue.auditType.rawValue) | \(issue.compactDescription) | \(what)")
            return !strict
        }
        print("A11Y[\(name)] done – \(count.n) finding(s)")
    }

    func testStartSignedOut() throws { try audit("start", ["-debugSignedOut", "YES"], signedIn: false) }
    func testSignUp() throws { try audit("signup", ["-debugSignedOut", "YES", "-debugStartSignUp", "YES"], signedIn: false) }
    func testToday() throws { try audit("today", ["-debugTab", "today"]) }
    func testShopping() throws { try audit("shopping", ["-debugTab", "shopping"]) }
    func testWishes() throws { try audit("wishes", ["-debugTab", "shopping", "-debugWishes", "YES"]) }
    func testPantry() throws { try audit("pantry", ["-debugTab", "pantry"]) }
    func testCooking() throws { try audit("cooking", ["-debugTab", "cooking", "-debugCook", "wte"]) }
    func testWeek() throws { try audit("week", ["-debugTab", "cooking", "-debugCook", "week"]) }
    func testRecipes() throws { try audit("recipes", ["-debugTab", "cooking", "-debugCook", "recipes"]) }
    func testMoney() throws { try audit("money", ["-debugTab", "money"]) }
    func testMoneyList() throws { try audit("moneylist", ["-debugTab", "money", "-debugMoney", "list:1"]) }
    func testReceipts() throws { try audit("receipts", ["-debugTab", "money", "-debugMoney", "receipts"]) }
    func testSettings() throws { try audit("settings", ["-debugSettings", "YES"]) }
    func testPaywall() throws { try audit("paywall", ["-debugPaywall", "YES"]) }
    func testTreats() throws { try audit("treats", ["-debugSettings", "YES", "-debugMore", "treats"]) }
}
