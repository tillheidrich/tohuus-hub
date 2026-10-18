import StoreKit
import SwiftUI

/// The moments around the plan (monetisation page of 18 Oct 2026, wiki):
///   - F1 the end of the 14-day trial: a look back with the household's own numbers, once (GET /api/billing/trial-summary)
///   - "nur lesen": ToHuus Cloud has no Free – after the trial without a plan writing answers 402 `plan.readonly`;
///     one calm card says why and leads to the plans (never an error, never a dead end: plans, restore, export)
///   - F2 the paywall knows why it opened (`AppModel.paywallReason`, counted without tracking: POST /api/billing/event)
///   - F4 Apple's review dialog after good moments only (ReviewPrompt)
/// The iPhone app never points to buying on the web (App Store Review Guideline 3.1.1).

extension Notification.Name {
    /// 402 plan.readonly / quota.ai_paused from any request (APIClient) – MainTabView shows one calm card
    static let toHuusPlanNotice = Notification.Name("ToHuusPlanNotice")
    /// a request that went well and is a good moment (shop finished, receipt kept, task done) – ReviewPrompt counts it
    static let toHuusGoodMoment = Notification.Name("ToHuusGoodMoment")
}

/// GET /api/billing/trial-summary (server/lib/trial-end.ts)
struct TrialSummary: Decodable, Sendable {
    struct Counts: Decodable, Sendable {
        var receipts: Int?
        var receiptsTotal: Double?
        var listTicks: Int?
        var trips: Int?
        var tasksDone: Int?
        var recipesCooked: Int?
        var assistant: Int?
        var products: Int?
    }
    /// running | ended | none
    var state: String?
    var endsAt: String?
    var daysLeft: Int?
    var counts: Counts?
    var show: Bool?
    /// readonly | free – what follows the trial without a plan
    var after: String?
}

extension APIClient {
    func trialSummary() async throws -> TrialSummary { try await get("api/billing/trial-summary") }
    func trialSummarySeen() async { _ = try? await send("POST", "api/billing/trial-summary/seen", json: [:], as: Ignored.self) }
    /// counters only: day, event, platform (no household, no person) – server/routes/billing.ts
    func billingEvent(_ event: String, reason: String? = nil) async {
        var body: [String: Any] = ["event": event]
        if let reason { body["reason"] = reason }
        _ = try? await send("POST", "api/billing/event", json: body, as: Ignored.self)
    }
}

/// Why the paywall opened – the same keys as the server (routes/billing.ts PAYWALL_REASONS).
enum PaywallReason {
    static func headline(_ reason: String?) -> String? {
        switch reason {
        case "trial_end": return L("Your trial is over. Everything stays visible – with Household or Plus you carry on.")
        case "assistant_plan": return L("The assistant with AI comes with Household and Plus.")
        case "assistant_quota": return L("This month’s assistant messages are used up. Plus has many more.")
        case "ai_paused": return L("AI is paused for your household until the 1st.")
        case "week_plan": return L("The week plan from what you have at home comes with Plus.")
        case "plus_recipe": return L("The ToHuus recipes for the season come with Plus.")
        case "receipt_ai", "import_ai": return L("Reading photos and links with AI comes with Household and Plus.")
        case "history", "price_history": return L("The whole history and prices come with Household and Plus.")
        case "monthly": return L("The look back at every month comes with Plus.")
        case "connected", "mirror": return L("Connected households and shared lists come with Household and Plus.")
        case "mail_inbox": return L("The receipt address comes with Household and Plus.")
        default: return nil
        }
    }
}

// MARK: review dialog (F4)

/// Apple's own review dialog, only after ToHuus visibly helped: at least 3 good moments (shop finished, receipt kept,
/// task done), the app installed for 7 days, no error in this session, at most every 120 days (Apple adds its own
/// limit of 3 a year), never for guests or children, never right after the paywall or the end of the trial.
/// No question before it, nothing in return.
enum ReviewPrompt {
    private static let d = UserDefaults.standard
    private static let installedKey = "review.installedAt"
    private static let momentsKey = "review.moments"
    private static let lastKey = "review.lastAsked"
    private static let errorKey = "review.errorSession"
    /// a new value every launch: an error is remembered for this launch only
    private static let launch = UUID().uuidString

    static func noteLaunch() {
        if d.object(forKey: installedKey) == nil { d.set(Date(), forKey: installedKey) }
    }

    static func noteError() { d.set(launch, forKey: errorKey) }

    /// APIClient: which successful requests are good moments
    static func observe(method: String, path: String, status: Int) {
        if status >= 500 || status == 0 { noteError(); return }
        guard (200..<300).contains(status), method == "POST" else { return }
        let good = path.hasSuffix("api/list/finish") || path.hasSuffix("api/shop/checkout")
            || path.range(of: #"api/imports/\d+/apply$"#, options: .regularExpression) != nil
            || path.range(of: #"api/care/\d+/done$"#, options: .regularExpression) != nil
        if good {
            d.set(d.integer(forKey: momentsKey) + 1, forKey: momentsKey)
            DispatchQueue.main.async { NotificationCenter.default.post(name: .toHuusGoodMoment, object: nil) }
        }
    }

    static func shouldAsk(now: Date = .now) -> Bool {
        guard let installed = d.object(forKey: installedKey) as? Date, now.timeIntervalSince(installed) >= 7 * 86400 else { return false }
        if d.string(forKey: errorKey) == launch { return false }
        if let last = d.object(forKey: lastKey) as? Date, now.timeIntervalSince(last) < 120 * 86400 { return false }
        return d.integer(forKey: momentsKey) >= 3
    }

    static func asked(now: Date = .now) {
        d.set(now, forKey: lastKey)
        d.set(0, forKey: momentsKey)
    }
}

// MARK: the modifier on the main screen

extension View {
    /// trial look back, read-only card and review dialog – one line in MainTabView
    func planMoments(store: ServerStore) -> some View { modifier(PlanMoments(store: store)) }
}

private struct PlanMoments: ViewModifier {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @Environment(\.requestReview) private var requestReview
    @Environment(\.scenePhase) private var scenePhase
    @State private var notice: String?
    @State private var noticeShownAt: Date?
    @State private var lookBack: TrialSummary?

    func body(content: Content) -> some View {
        content
            .onReceive(NotificationCenter.default.publisher(for: .toHuusPlanNotice)) { n in
                guard !app.isGuest, !app.isChild, !app.showPaywall, lookBack == nil else { return }
                // once in a while is enough – the action itself already said it did not work
                if let at = noticeShownAt, Date.now.timeIntervalSince(at) < 300 { return }
                noticeShownAt = .now
                notice = (n.object as? String) ?? L("Your trial is over. With Household or Plus you can carry on – or run ToHuus on your own server. Everything stays visible and you can export it.")
                Task { await store.api.billingEvent("paywall.view", reason: "trial_end") }
            }
            .onReceive(NotificationCenter.default.publisher(for: .toHuusGoodMoment)) { _ in
                guard ReviewPrompt.shouldAsk(), !app.isGuest, !app.isChild, !app.showPaywall, notice == nil, lookBack == nil,
                      app.billing?.readonly != true else { return }
                // a moment later, when the screen has settled – never in the middle of the action
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    ReviewPrompt.asked()
                    requestReview()
                    await store.api.billingEvent("review.request")
                }
            }
            .task {
                ReviewPrompt.noteLaunch()
                await checkLookBack()
            }
            .onChange(of: scenePhase) { _, p in if p == .active { Task { await checkLookBack() } } }
            .sheet(item: Binding(get: { notice.map(NoticeText.init) }, set: { notice = $0?.text })) { n in
                ReadOnlySheet(message: n.text) {
                    notice = nil
                    app.openPaywall("trial_end")
                }
            }
            .sheet(item: Binding(get: { lookBack.map(LookBackItem.init) }, set: { if $0 == nil { closeLookBack() } })) { item in
                TrialLookBackSheet(summary: item.summary) {
                    closeLookBack()
                    app.openPaywall("trial_end")
                }
            }
    }

    private func checkLookBack() async {
        guard app.isCloud, !app.isGuest, !app.isChild, lookBack == nil, notice == nil, !app.showPaywall,
              UserDefaults.standard.string(forKey: "debugToken") == nil else { return }
        guard let s = try? await store.api.trialSummary(), s.show == true, s.counts != nil else { return }
        guard !app.showPaywall, !app.showAssistant else { return }
        lookBack = s
    }

    private func closeLookBack() {
        lookBack = nil
        Task { await store.api.trialSummarySeen() }
    }
}

private struct NoticeText: Identifiable { let text: String; var id: String { text } }
private struct LookBackItem: Identifiable { let summary: TrialSummary; var id: String { summary.endsAt ?? "trial" } }

/// "Eure Testphase ist vorbei": calm, with the way on (plans, restore inside the paywall) and the reassurance that
/// nothing is deleted and the export works.
private struct ReadOnlySheet: View {
    let message: String
    let openPlans: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Label(L("Your trial is over"), systemImage: "hourglass").font(.title3.weight(.semibold)).foregroundStyle(Theme.ink)
            Text(message).font(.body).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
            Text(L("Nothing is deleted. You can look at everything and export your data in Settings at any time. One plan covers the whole household, members and guests never pay."))
                .font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            if let g = ServerDate.parse(app.billing?.graceUntil) {
                Text(LF("Ticking off the shopping list still works until %@.", g.formatted(date: .long, time: .omitted)))
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
            if app.purchasesAvailable {
                Button(L("See plans"), action: openPlans).buttonStyle(PrimaryButtonStyle())
            }
            Button(L("Close")) { dismiss() }.buttonStyle(SecondaryButtonStyle())
        }
        .padding(Theme.Space.s4)
        .presentationDetents([.medium, .large])
    }
}

/// "Was ToHuus in den 14 Tagen für euch gemerkt hat": only numbers of the own household, shown once.
private struct TrialLookBackSheet: View {
    let summary: TrialSummary
    let openPlans: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    private var lines: [String] {
        guard let c = summary.counts else { return [] }
        var out: [String] = []
        if let n = c.listTicks, n > 0 { out.append(LF("%d times ticked off the list", n)) }
        if let n = c.trips, n > 0 { out.append(LF("%d shopping trips done", n)) }
        if let n = c.receipts, n > 0 {
            if let sum = c.receiptsTotal, sum > 0 {
                out.append(LF("%d receipts kept, %@ in total", n, sum.formatted(.currency(code: "EUR"))))
            } else {
                out.append(LF("%d receipts kept", n))
            }
        }
        if let n = c.tasksDone, n > 0 { out.append(LF("%d tasks done", n)) }
        if let n = c.recipesCooked, n > 0 { out.append(LF("%d times cooked from a recipe", n)) }
        if let n = c.assistant, n > 0 { out.append(LF("%d questions to the assistant", n)) }
        if let n = c.products, n > 0 { out.append(LF("%d things ToHuus remembers for you", n)) }
        return out
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s3) {
                    Text(summary.state == "running" ? L("What ToHuus has remembered for you so far") : L("What ToHuus remembered for you in the 14 days"))
                        .font(.title3.weight(.semibold)).foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(lines, id: \.self) { l in
                        Label(l, systemImage: "checkmark").font(.subheadline).foregroundStyle(Theme.ink)
                    }
                    Text(endText).font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                    if app.purchasesAvailable {
                        Button(L("See plans"), action: openPlans).buttonStyle(PrimaryButtonStyle())
                    }
                    Button(L("Later")) { dismiss() }.buttonStyle(SecondaryButtonStyle())
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
        }
        .presentationDetents([.medium, .large])
    }

    private var endText: String {
        let readonly = summary.after != "free"
        if summary.state == "running", let d = ServerDate.parse(summary.endsAt) {
            let date = d.formatted(date: .long, time: .omitted)
            return readonly
                ? LF("Your trial ends on %@. After that everything stays visible and you can export it; adding and changing things carries on with Household or Plus. Nothing is charged automatically.", date)
                : LF("Your trial ends on %@. After that you carry on with Free. Nothing is charged automatically.", date)
        }
        return readonly
            ? L("Your trial is over. Everything stays visible and you can export it; adding and changing things carries on with Household or Plus.")
            : L("Your trial is over. You carry on with Free – the assistant with AI comes with Household and Plus.")
    }
}
