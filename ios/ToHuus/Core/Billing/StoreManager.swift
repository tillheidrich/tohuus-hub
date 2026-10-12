import Foundation
import Observation
import StoreKit

/// StoreKit 2: one subscription per household (appAccountToken = household UUID). The server verifies the signed
/// transaction itself (POST /api/billing/apple/transaction) and answers with the new plan status.
@MainActor
@Observable
final class StoreManager {
    static let productIds = [
        "de.heidrichdigital.tohuus.haushalt.monthly",
        "de.heidrichdigital.tohuus.haushalt.yearly",
        "de.heidrichdigital.tohuus.plus.monthly",
        "de.heidrichdigital.tohuus.plus.yearly",
    ]

    private(set) var products: [Product] = []
    private(set) var purchasing: String?
    private(set) var loadError: String?
    var message: String?

    @ObservationIgnored private var updates: Task<Void, Never>?
    /// set by the app: where verified transactions are reported
    @ObservationIgnored var report: (@MainActor (String) async -> BillingStatus?)?

    func start() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                await self?.handle(result)
            }
        }
    }

    func loadProducts() async {
        guard products.isEmpty else { return }
        do {
            products = try await Product.products(for: Self.productIds).sorted { $0.price < $1.price }
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    func product(plan: String, yearly: Bool) -> Product? {
        products.first { $0.id == "de.heidrichdigital.tohuus.\(plan).\(yearly ? "yearly" : "monthly")" }
    }

    @discardableResult
    func purchase(_ product: Product, household: String?) async -> Bool {
        // one subscription per household: without the household's UUID the server could not assign the purchase
        guard let household, let uuid = UUID(uuidString: household) else {
            message = L("Please choose a household first – a subscription always belongs to one household.")
            return false
        }
        purchasing = product.id
        defer { purchasing = nil }
        let options: Set<Product.PurchaseOption> = [.appAccountToken(uuid)]
        do {
            let result = try await product.purchase(options: options)
            switch result {
            case .success(let verification):
                return await handle(verification)
            case .pending:
                message = L("The purchase is waiting for approval (Ask to Buy).")
                return false
            case .userCancelled:
                return false
            @unknown default:
                return false
            }
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    /// "Wiederherstellen": sync with the App Store and report every current entitlement.
    func restore() async {
        do {
            try await AppStore.sync()
        } catch {
            message = error.localizedDescription
            return
        }
        var found = false
        for await result in Transaction.currentEntitlements {
            found = true
            await handle(result)
        }
        message = found ? L("Your subscription has been restored.") : L("No active subscription was found for this Apple Account.")
    }

    @discardableResult
    private func handle(_ result: VerificationResult<Transaction>) async -> Bool {
        guard case .verified(let transaction) = result else {
            message = L("The App Store could not confirm this purchase.")
            return false
        }
        // the server checks the JWS itself; only finish once it has it, so StoreKit re-delivers otherwise
        if let report, await report(result.jwsRepresentation) != nil {
            await transaction.finish()
            return true
        }
        return false
    }
}

extension Product {
    var periodLabel: String {
        guard let p = subscription?.subscriptionPeriod else { return "" }
        switch p.unit {
        case .year: return L("per year")
        case .month: return L("per month")
        case .week: return L("per week")
        case .day: return L("per day")
        @unknown default: return ""
        }
    }
}
