import StoreKit
import SwiftUI

/// Plans for ToHuus Cloud, per household (App Store Review Guideline 3.1.2: price and period from StoreKit, what each
/// plan includes, renewal and cancellation, terms – Apple's standard EULA and ours –, privacy, restore, manage,
/// offer codes). What a plan includes comes from `GET /api/billing/status` → `plans`, in plain words.
struct PaywallView: View {
    @Environment(AppModel.self) private var app
    @Environment(StoreManager.self) private var storeKit
    @Environment(\.dismiss) private var dismiss
    @State private var yearly = true
    @State private var redeem = false
    @State private var manage = false
    @State private var restoring = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    if !app.purchasesAvailable {
                        EmptyStateView(systemImage: "checkmark.seal", title: L("Everything is included for this household."))
                    } else if let gift = app.billing?.gift {
                        // a gift (beta for everyone, or a code from us): nothing to buy, just say what the household has
                        currentPlan
                        giftNote(gift)
                        legal
                    } else {
                        currentPlan
                        Picker(L("Billing period"), selection: $yearly) {
                            Text(L("Monthly")).tag(false)
                            Text(L("Yearly")).tag(true)
                        }
                        .pickerStyle(.segmented)
                        if storeKit.productsMissing || storeKit.loadError != nil { productsUnavailable }
                        planCard(plan: "haushalt", title: L("Household"), symbol: "house")
                        planCard(plan: "plus", title: L("Plus"), symbol: "sparkles")
                        if let life = storeKit.lifetime, app.billing?.lifetime != true { lifetimeCard(life) }
                        freeCard
                        if let m = storeKit.message { Text(m).font(.footnote).foregroundStyle(Theme.info) }
                        legal
                    }
                }
                .padding(Theme.Space.s4)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .canvasBackground()
            .navigationTitle(L("Plans"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .task {
                await storeKit.loadProducts()
                await app.refreshBilling()
            }
            .offerCodeRedemption(isPresented: $redeem) { _ in
                Task { await app.refreshBilling() }
            }
            .manageSubscriptionsSheet(isPresented: $manage)
        }
    }

    // MARK: the household's plan

    private var currentPlan: some View {
        Card(title: LF("Household “%@”", app.activeHousehold?.name ?? L("Our home")), systemImage: "house") {
            Text(app.billing?.planLabel ?? L("Free – without AI")).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink)
            if app.billing?.plan == "trial", let d = ServerDate.parse(app.billing?.trialEndsAt ?? app.activeHousehold?.trialEndsAt) {
                let days = max(0, Calendar.current.dateComponents([.day], from: .now, to: d).day ?? 0)
                Text(LF("Everything included for %d more days (until %@). After that Free – nothing is charged automatically.",
                        days, d.formatted(date: .long, time: .omitted)))
                    .font(.footnote).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let r = ServerDate.parse(app.billing?.renewsAt) {
                Text(LF("Renews on %@", r.formatted(date: .long, time: .omitted))).font(.footnote).foregroundStyle(Theme.ink2)
            } else if app.billing?.isPaid == true, let e = ServerDate.parse(app.billing?.expiresAt) {
                Text(LF("Ends on %@ – it will not renew.", e.formatted(date: .long, time: .omitted))).font(.footnote).foregroundStyle(Theme.ink2)
            }
            if app.billing?.lifetime == true, app.billing?.autoRenew == true {
                // bought Plus for good while a subscription still renews: Apple keeps charging until it is cancelled
                Text(L("You have Plus for good. Your old subscription still renews – cancel it under “Manage subscription” so it is not charged again."))
                    .font(.footnote).foregroundStyle(Theme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(L("One subscription covers the whole household. Members, children and guests never pay."))
                .font(.footnote).foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func giftNote(_ gift: BillingStatus.Gift) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Label(gift.kind == "beta" ? L("A gift for every household") : L("A gift for your household"), systemImage: "gift")
                .font(.headline).foregroundStyle(Theme.primaryText)
            Group {
                if gift.kind == "beta" {
                    // the operator's gift for every household (server kind "beta") – shown neutrally
                    if gift.forever != true, let d = ServerDate.parse(gift.until) {
                        Text(LF("Every household has this plan as a gift until %@. After that your household keeps what it has on its own – nothing is charged automatically and nothing is deleted.", d.formatted(date: .long, time: .omitted)))
                    } else {
                        Text(L("Every household has this plan as a gift right now. Nothing is charged automatically and nothing is deleted."))
                    }
                } else if gift.forever == true {
                    Text(L("Your household has this plan for good. Nothing is charged."))
                } else if let d = ServerDate.parse(gift.until) {
                    Text(LF("Your household has this plan until %@. After that Free – nothing is charged automatically.", d.formatted(date: .long, time: .omitted)))
                }
            }
            .font(.footnote).foregroundStyle(Theme.ink2)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
    }

    private var productsUnavailable: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Label(L("The App Store prices can’t be loaded right now."), systemImage: "exclamationmark.triangle")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.warning)
            Text(L("Check the connection and try again. Nothing is bought without your confirmation."))
                .font(.footnote).foregroundStyle(Theme.ink2)
            Button(L("Try again")) { Task { await storeKit.loadProducts() } }
                .font(.footnote.weight(.semibold))
                .disabled(storeKit.loading)
        }
        .padding(Theme.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.warningSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
    }

    // MARK: plans

    private func planCard(plan: String, title: String, symbol: String) -> some View {
        let product = storeKit.product(plan: plan, yearly: yearly)
        let current = app.billing?.plan == plan
        return Card(title: title, systemImage: symbol) {
            ForEach(PlanText.points(plan: plan, limits: app.billing?.plans?[plan]), id: \.self) { p in
                Label(p, systemImage: "checkmark").font(.subheadline).foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let product {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(product.displayPrice) \(product.periodLabel)").font(.headline).foregroundStyle(Theme.ink)
                    IntroOfferLine(product: product)
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
            } else if storeKit.productsMissing || storeKit.loadError != nil {
                Text(L("Price not available right now")).font(.footnote).foregroundStyle(Theme.ink3)
            } else {
                ProgressView()
            }
        }
    }

    /// Optional: Plus once, for good (non-consumable `plus.lifetime`).
    private func lifetimeCard(_ product: Product) -> some View {
        Card(title: L("Plus for good"), systemImage: "infinity") {
            Text(L("Everything in Plus for this household, paid once. No subscription, nothing renews."))
                .font(.subheadline).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(product.displayPrice) \(product.periodLabel)").font(.headline).foregroundStyle(Theme.ink)
            Button {
                Task {
                    if await storeKit.purchase(product, household: app.session?.householdId) {
                        Haptics.success()
                        await app.refreshBilling()
                    }
                }
            } label: {
                HStack {
                    Text(L("Buy once"))
                    if storeKit.purchasing == product.id { ProgressView().tint(Theme.onPrimary) }
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(storeKit.purchasing != nil)
        }
    }

    private var freeCard: some View {
        Card(title: L("Free – without AI"), systemImage: "leaf") {
            ForEach(PlanText.points(plan: "free", limits: app.billing?.plans?["free"]), id: \.self) { p in
                Label(p, systemImage: "checkmark").font(.subheadline).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(L("Free stays free – the list, stock and recipes always work, without AI. The assistant with AI comes with Household and Plus.")).font(.footnote).foregroundStyle(Theme.ink3)
        }
    }

    // MARK: legal, restore, manage

    private var legal: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(L("Subscriptions renew automatically at the end of each period unless you cancel at least 24 hours before. The amount is charged to your Apple Account. You can manage and cancel your subscription any time in your Apple Account settings."))
                .font(.caption).foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.Space.s4) { restoreButton; manageButton; redeemButton }
                VStack(alignment: .leading, spacing: Theme.Space.s2) { restoreButton; manageButton; redeemButton }
            }
            .font(.footnote)
            LegalLinks(withAppleEULA: true)
        }
    }

    private var restoreButton: some View {
        Button {
            Task {
                restoring = true
                await storeKit.restore()
                await app.refreshBilling()
                restoring = false
            }
        } label: {
            HStack(spacing: 6) { Text(L("Restore purchases")); if restoring { ProgressView() } }
        }
        .disabled(restoring)
    }

    private var manageButton: some View {
        Button(L("Manage subscription")) {
            // Apple's sheet; the plain link when there is no window scene to show it in
            if UIApplication.shared.connectedScenes.first is UIWindowScene { manage = true }
            else if let u = URL(string: app.billing?.manageUrl ?? "https://apps.apple.com/account/subscriptions") { UIApplication.shared.open(u) }
        }
    }

    private var redeemButton: some View {
        Button(L("Redeem code")) { redeem = true }
    }
}

/// What a plan includes, in plain words, from the plan's limits (`/api/billing/status` → `plans`).
enum PlanText {
    static func points(plan: String, limits l: JSONValue?) -> [String] {
        guard let l, l.object != nil else { return fallback(plan) }
        var out: [String] = []
        let f = l["features"]
        if let days = l["historyDays"]?.int { out.append(LF("The last %d days in view", days)) }
        else { out.append(L("The whole history: prices, spending, what you buy how often")) }
        if f?["connectedHouseholds"]?.bool == true { out.append(L("Connected households and shared lists")) }
        if f?["weekPlanFromPantry"]?.bool == true { out.append(L("Week plan from what you have at home")) }
        if f?["monthlyAnalysis"]?.bool == true { out.append(L("A look back at every month")) }
        if f?["plusRecipes"]?.bool == true { out.append(L("New ToHuus recipes for the season, with pictures")) }
        if l["assistantPerMonth"]?.int == 0 {
            out.append(L("Without AI: the assistant understands simple sentences like “milk and bread”"))
        } else if let n = l["assistantPerMonth"]?.int {
            out.append(l["assistantThrottleOnly"]?.bool == true
                       ? LF("%d assistant messages a month – after that slower, never blocked", n)
                       : LF("%d assistant messages a month", n))
        }
        if let n = l["receiptAiPerDay"]?.int, n > 0 { out.append(LF("Up to %d receipt photos read a day", n)) }
        if let b = l["storageBytes"]?.double {
            out.append(LF("%@ for receipts and photos", ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .binary)))
        }
        return out
    }

    private static func fallback(_ plan: String) -> [String] {
        switch plan {
        case "plus":
            return [L("Everything in Household"), L("Week plan from what you have at home"), L("A look back at every month"), L("New ToHuus recipes for the season, with pictures"),
                    LF("%d assistant messages a month – after that slower, never blocked", 1500), LF("%@ for receipts and photos", "5 GB")]
        case "haushalt":
            return [L("The whole history: prices, spending, what you buy how often"), L("Connected households and shared lists"),
                    LF("%d assistant messages a month", 100), LF("%@ for receipts and photos", "2 GB")]
        default:
            return [LF("The last %d days in view", 30), L("Without AI: the assistant understands simple sentences like “milk and bread”"), LF("%@ for receipts and photos", "100 MB")]
        }
    }
}

/// An introductory offer set up in App Store Connect (e.g. a free trial), with what it costs afterwards – only for people
/// who can still get it (App Store guideline 3.1.2: the terms are clear before buying).
struct IntroOfferLine: View {
    let product: Product
    @State private var eligible = false

    var body: some View {
        Group {
            if eligible, let offer = product.subscription?.introductoryOffer {
                Text(text(offer)).font(.caption).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .task(id: product.id) { eligible = await product.subscription?.isEligibleForIntroOffer ?? false }
    }

    private func text(_ offer: Product.SubscriptionOffer) -> String {
        let length = Self.length(offer.period, times: offer.paymentMode == .payAsYouGo ? offer.periodCount : 1)
        let after = "\(product.displayPrice) \(product.periodLabel)"
        if offer.paymentMode == .freeTrial {
            return LF("First %@ free, then %@. Cancel before the end and nothing is charged.", length, after)
        }
        return LF("%@ for the first %@, then %@.", offer.displayPrice, length, after)
    }

    /// "2 weeks", "1 month" in the app's language
    static func length(_ p: Product.SubscriptionPeriod, times: Int) -> String {
        let n = p.value * max(times, 1)
        var c = DateComponents()
        switch p.unit {
        case .day: c.day = n
        case .week: c.weekOfMonth = n
        case .month: c.month = n
        case .year: c.year = n
        @unknown default: c.day = n
        }
        let f = DateComponentsFormatter()
        f.unitsStyle = .full
        f.allowedUnits = [.day, .weekOfMonth, .month, .year]
        return f.string(from: c) ?? ""
    }
}
