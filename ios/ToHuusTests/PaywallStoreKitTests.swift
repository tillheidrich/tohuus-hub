import StoreKit
import StoreKitTest
import XCTest
@testable import ToHuus

/// StoreKit Testing with ios/StoreKit/ToHuus.storekit (the four products of the "ToHuus" group).
final class PaywallStoreKitTests: XCTestCase {
    /// the products the paywall asks for exist in the configuration and carry a period
    func testConfigurationHasTheFourProducts() async throws {
        let session = try SKTestSession(configurationFileNamed: "ToHuus")
        session.disableDialogs = true
        session.clearTransactions()
        let ids = ["de.heidrichdigital.tohuus.haushalt.monthly", "de.heidrichdigital.tohuus.haushalt.yearly",
                   "de.heidrichdigital.tohuus.plus.monthly", "de.heidrichdigital.tohuus.plus.yearly"]
        let products = try await Product.products(for: ids)
        XCTAssertEqual(Set(products.map(\.id)), Set(ids))
        for p in products {
            XCTAssertEqual(p.type, .autoRenewable)
            XCTAssertNotNil(p.subscription?.subscriptionPeriod)
            XCTAssertNil(p.subscription?.introductoryOffer, "the trial is server-side, no App Store intro offer")
        }
    }

    /// Screenshot run only (TEST_RUNNER_TOHUUS_PAYWALL_SHOT=1): opens the paywall in the host app with the StoreKit
    /// products loaded and keeps it on screen so `simctl io screenshot` can take the App Review picture.
    @MainActor
    func testPaywallOnScreenForScreenshot() async throws {
        guard ProcessInfo.processInfo.environment["TOHUUS_PAYWALL_SHOT"] == "1" else { throw XCTSkip("screenshot run only") }
        let session = try SKTestSession(configurationFileNamed: "ToHuus")
        session.disableDialogs = true
        session.clearTransactions()
        try await Task.sleep(nanoseconds: 8_000_000_000)
        NotificationCenter.default.post(name: .toHuusDebugShowPaywall, object: nil)
        try await Task.sleep(nanoseconds: 45_000_000_000)
    }
}
