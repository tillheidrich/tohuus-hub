import StoreKit
import SwiftUI

/// Plans for ToHuus Cloud (App Store Review Guideline 3.1.2: price, period, renewal and cancellation, terms,
/// privacy, restore, offer codes). Never shown for a self-hosted server – there everything is free.
struct PaywallView: View {
    @Environment(AppModel.self) private var app
    @Environment(StoreManager.self) private var storeKit
    @Environment(\.dismiss) private var dismiss
    @State private var yearly = true
    @State private var redeem = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    if !app.purchasesAvailable {
                        EmptyStateView(systemImage: "server.rack", title: L("Everything is included on your own server."))
                    } else {
                        currentPlan
                        Picker("", selection: $yearly) {
                            Text(L("Monthly")).tag(false)
                            Text(L("Yearly")).tag(true)
                        }
                        .pickerStyle(.segmented)
                        planCard(plan: "haushalt", title: L("Household"), points: [
                            L("Full history: prices, spending, savings review"),
                            L("Connected households and lists"),
                            L("100 assistant messages a month"),
                            L("2 GB for receipts and photos"),
                        ])
                        planCard(plan: "plus", title: L("Plus"), points: [
                            L("Everything in Household"),
                            L("The assistant in everyday use: week plan from the pantry, monthly analysis"),
                            L("1,500 assistant messages a month (fair use)"),
                            L("5 GB for receipts and photos"),
                        ])
                        if let err = storeKit.loadError { ErrorBanner(message: err) { Task { await storeKit.loadProducts() } } }
                        if let m = storeKit.message { Text(m).font(.footnote).foregroundStyle(Theme.info) }
                        legal
                    }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(L("Plans"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .task { await storeKit.loadProducts() }
            .offerCodeRedemption(isPresented: $redeem) { _ in
                Task { await app.refreshBilling() }
            }
        }
    }

    private var currentPlan: some View {
        Card(title: L("Your household's plan"), systemImage: "house") {
            Text(app.billing?.planLabel ?? L("Free")).font(.title3.weight(.semibold))
            if app.billing?.plan == "trial", let d = ServerDate.parse(app.billing?.trialEndsAt) {
                Text(LF("Plus for free until %@. After that Free – nothing is charged automatically.",
                        d.formatted(date: .long, time: .omitted)))
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
            if let r = ServerDate.parse(app.billing?.renewsAt) {
                Text(LF("Renews on %@", r.formatted(date: .long, time: .omitted))).font(.footnote).foregroundStyle(Theme.ink2)
            }
            Text(L("One subscription covers the whole household. Members, children and guests never pay."))
                .font(.footnote).foregroundStyle(Theme.ink3)
        }
    }

    private func planCard(plan: String, title: String, points: [String]) -> some View {
        let product = storeKit.product(plan: plan, yearly: yearly)
        let current = app.billing?.plan == plan
        return Card(title: title, systemImage: plan == "plus" ? "sparkles" : "house") {
            ForEach(points, id: \.self) { p in
                Label(p, systemImage: "checkmark").font(.subheadline).foregroundStyle(Theme.ink)
            }
            if let product {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(product.displayPrice) \(product.periodLabel)").font(.headline)
                    if yearly, let monthly = storeKit.product(plan: plan, yearly: false) {
                        let saving = 1 - (product.price as NSDecimalNumber).doubleValue / ((monthly.price as NSDecimalNumber).doubleValue * 12)
                        if saving > 0.05 { Text(LF("%d %% cheaper than monthly", Int(saving * 100))).font(.caption).foregroundStyle(Theme.primaryText) }
                    }
                }
                Button {
                    Task {
                        if await storeKit.purchase(product, household: app.session?.householdId) {
                            Haptics.success()
                            await app.refreshBilling()
                        }
                    }
                } label: {
                    HStack {
                        Text(current ? L("Your current plan") : LF("Choose %@", title))
                        if storeKit.purchasing == product.id { ProgressView().tint(Theme.onPrimary) }
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(current || storeKit.purchasing != nil)
            } else {
                ProgressView()
            }
        }
    }

    private var legal: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(L("Subscriptions renew automatically at the end of each period unless you cancel at least 24 hours before. The amount is charged to your Apple Account. You can manage and cancel your subscription any time in your Apple Account settings."))
                .font(.caption).foregroundStyle(Theme.ink3)
            HStack(spacing: Theme.Space.s4) {
                Button(L("Restore purchases")) { Task { await storeKit.restore(); await app.refreshBilling() } }
                Button(L("Redeem code")) { redeem = true }
            }
            .font(.footnote)
            HStack(spacing: Theme.Space.s4) {
                Link(L("Terms of Use (EULA)"), destination: SharedConfig.termsURL)
                if let p = app.instance?.legal?.privacy, let url = URL(string: p) { Link(L("Privacy"), destination: url) }
            }
            .font(.footnote)
        }
    }
}
