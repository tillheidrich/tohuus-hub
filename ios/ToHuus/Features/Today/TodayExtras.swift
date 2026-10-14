import SwiftUI

// Heute, the parts the web has beyond the five cards (web: pages/Today.tsx, pulse.tsx, Onboarding.tsx ChecklistCard):
// notices that lead somewhere, the empty "Fällig" with the three ways in, the weekly question, the getting-started
// checklist and the person's own card order (GET/PUT /api/list/today-order).

// MARK: - models

/// The notices of GET /api/today with their target (`path`) – read from the same answer as TodayPayload.
struct TodayNoticeLinks: Decodable, Sendable {
    struct Item: Decodable, Sendable, Hashable, Identifiable {
        var kind: String?
        var text: String?
        var path: String?
        var to: String?
        var id: String { (kind ?? "") + (text ?? "") }
        var target: String? { path ?? to }
    }
    @Lossy var notices: [Item]
}

/// GET /api/pulse – the weekly question (opt-in per household, Sundays/Mondays)
struct PulseState: Decodable, Sendable {
    struct Question: Decodable, Sendable { var week: String?; var options: [String] }
    var enabled: Bool?
    var share: Bool?
    var question: Question?
}

/// GET /api/onboarding – the first-run state (server/lib/onboard.ts gettingStarted)
struct GettingStarted: Decodable, Sendable {
    struct State: Decodable, Sendable {
        var step: String?
        var started: Bool?
        var closed: Bool?
        var skipped: Bool?
        var checklistDismissed: Bool?
    }
    struct Checklist: Decodable, Sendable {
        struct Item: Decodable, Sendable, Hashable, Identifiable { var key: String; var done: Bool; var id: String { key } }
        @Lossy var items: [Item]
        var done: Int?
        var total: Int?
    }
    struct HouseholdInfo: Decodable, Sendable { var name: String?; var language: String? }
    struct Counts: Decodable, Sendable { var members: Int?; var products: Int?; var recipes: Int? }
    var state: State?
    var newHousehold: Bool?
    var wizardDue: Bool?
    var admin: Bool?
    var checklist: Checklist?
    var showChecklist: Bool?
    var household: HouseholdInfo?
    /// { form, form_chosen, … } (lib/places.ts homeSetup)
    var home: JSONValue?
    var counts: Counts?

    var form: String? { home?["form"]?.string }
    var formChosen: Bool { home?["formChosen"]?.bool ?? home?["form_chosen"]?.bool ?? false }
}

extension APIClient {
    func todayOrder() async throws -> [String] {
        let r: JSONValue = try await get("api/list/today-order")
        return r["order"]?.array?.compactMap(\.string) ?? []
    }

    func setTodayOrder(_ order: [String]) async throws {
        _ = try await send("PUT", "api/list/today-order", json: ["order": order], as: Ignored.self)
    }

    func pulse() async throws -> PulseState { try await get("api/pulse") }
    func answerPulse(_ answer: String) async throws { _ = try await send("POST", "api/pulse", json: ["answer": answer], as: Ignored.self) }

    func gettingStarted() async throws -> GettingStarted { try await get("api/onboarding") }
    func dismissChecklist() async throws { _ = try await send("POST", "api/onboarding/checklist/dismiss", json: [:], as: Ignored.self) }

    /// POST /api/shop/quick-add with plain names (and product ids where known)
    func quickAddNames(_ items: [NameItem]) async throws {
        let rows: [[String: Any]] = items.map { i in
            var d: [String: Any] = ["name": i.name]
            if let p = i.productId { d["product_id"] = p }
            return d
        }
        _ = try await send("POST", "api/shop/quick-add", json: ["items": rows], as: Ignored.self)
    }
}

// MARK: - card order

/// The cards of Heute that can be arranged (server list2.ts TODAY_CARDS) – the web's default order.
enum TodayCardKey: String, CaseIterable, Identifiable {
    case rhythm, tasks, list, still, cook, money, pulse
    var id: String { rawValue }

    var title: String {
        switch self {
        case .rhythm: return L("Due")
        case .tasks: return L("Tasks today")
        case .list: return L("List")
        case .still: return L("Still at home – use soon")
        case .cook: return L("Cook today?")
        case .money: return L("Money")
        case .pulse: return L("One question for the week")
        }
    }

    var symbol: String {
        switch self {
        case .rhythm: return "clock.arrow.circlepath"
        case .tasks: return "checklist"
        case .list: return "cart"
        case .still: return "refrigerator"
        case .cook: return "fork.knife"
        case .money: return "eurosign.circle"
        case .pulse: return "questionmark.bubble"
        }
    }

    /// saved order first, then the rest in the default order
    static func sorted(_ keys: [TodayCardKey], by order: [String]) -> [TodayCardKey] {
        func pos(_ k: TodayCardKey) -> Int {
            if let i = order.firstIndex(of: k.rawValue) { return i }
            return 100 + (allCases.firstIndex(of: k) ?? 0)
        }
        return keys.sorted { pos($0) < pos($1) }
    }
}

/// "Karten anordnen": the shown cards as a list to drag (native reordering instead of the web's drag handles).
struct TodayArrangeSheet: View {
    let keys: [TodayCardKey]
    let save: ([TodayCardKey]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var order: [TodayCardKey] = []

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(order) { k in
                        Label(k.title, systemImage: k.symbol)
                    }
                    .onMove { from, to in order.move(fromOffsets: from, toOffset: to) }
                } footer: {
                    Text(L("Hold and drag. Only you see this order."))
                }
            }
            .environment(\.editMode, .constant(.active))
            .themedList()
            .navigationTitle(L("Arrange cards"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Done")) {
                        if order != keys { save(order) }
                        dismiss()
                    }
                }
            }
            .onAppear { if order.isEmpty { order = keys } }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - the empty "Fällig": three ways in

struct TodayEntryLevels: View {
    @Environment(AppModel.self) private var app
    let shareReceipt: () -> Void
    let photoOfList: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(L("Nothing due right now. ToHuus remembers how often you buy things – from receipts and from ticking off the list."))
                .font(.footnote).foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: Theme.Space.s2) { tiles }
                VStack(spacing: Theme.Space.s2) { tiles }
            }
        }
    }

    @ViewBuilder private var tiles: some View {
        if app.moduleOn("money") || app.moduleOn("stock") {
            tile("doc.text", L("Share a receipt"), L("eBon, PDF, delivery"), action: shareReceipt)
        }
        tile("camera", L("Photo of the list"), L("paper receipt or note"), action: photoOfList)
        if app.aiOn {
            tile("sparkles", L("Just speak"), L("“Milk is out”")) { app.showAssistant = true }
        } else {
            tile("textformat", L("Just type it"), L("“milk, bread, coffee”")) { app.requestAdd() }
        }
    }

    private func tile(_ symbol: String, _ title: String, _ sub: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Image(systemName: symbol).font(.title3).foregroundStyle(Theme.primaryText).accessibilityHidden(true)
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(sub).font(.caption).foregroundStyle(Theme.ink3)
            }
            .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
            .padding(Theme.Space.s3)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - the weekly question

struct TodayPulseCard: View {
    let api: APIClient
    let pulse: PulseState
    let answered: () -> Void
    @State private var done = false
    @State private var error: String?

    private static let labels: [String: String] = ["0": "never", "1-2": "1–2 times", "3-5": "3–5 times", "more": "more often"]

    var body: some View {
        Card(title: L("One question for the week"), systemImage: TodayCardKey.pulse.symbol) {
            Text(L("How often did someone have to ask “Do we still have …?” this week?"))
                .font(.subheadline).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            FlowLayout(spacing: 8) {
                ForEach(pulse.question?.options ?? [], id: \.self) { o in
                    Button(L(Self.labels[o] ?? o)) { Task { await answer(o) } }
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                        .disabled(done)
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.empty) }
            Text(pulse.share == true ? L("Stays with you; only the anonymous count is shared, as you chose.") : L("Stays in your household – nobody else sees it."))
                .font(.caption).foregroundStyle(Theme.ink3)
        }
    }

    private func answer(_ a: String) async {
        done = true
        error = nil
        do {
            try await api.answerPulse(a)
            Haptics.success()
            answered()
        } catch {
            done = false
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: - getting started

/// "3 von 5 erledigt" – admins, until done or hidden (server decides `showChecklist`).
struct TodayChecklistCard: View {
    let g: GettingStarted
    let open: (String) -> Void
    let hide: () -> Void
    @State private var confirmHide = false

    private func title(_ key: String) -> String {
        switch key {
        case "home": return L("Name your home and say who belongs to it")
        case "invite":
            switch g.form {
            case "single": return L("Invite someone")
            case "couple": return L("Invite your partner")
            case "shared": return L("Invite your flatmates")
            case "carer": return L("Invite the people you shop for")
            default: return L("Invite your family")
            }
        case "stock": return L("Get the first things in")
        case "phone": return L("Turn on notifications on this iPhone")
        case "recipe": return L("Save a first recipe")
        default: return key
        }
    }

    var body: some View {
        let c = g.checklist
        let done = c?.done ?? 0
        let total = max(1, c?.total ?? 1)
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Getting started")).font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Theme.ink3)
                    Text(LF("%d of %d done", done, total)).font(.headline).foregroundStyle(Theme.ink)
                }
                Spacer()
                Button { confirmHide = true } label: {
                    Image(systemName: "xmark").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3).tapTarget()
                }
                .accessibilityLabel(L("Hide"))
            }
            .accessibilityElement(children: .contain)
            ProgressView(value: Double(done), total: Double(total)).tint(Theme.primary)
                .accessibilityHidden(true)
            ForEach(c?.items ?? []) { i in
                Button {
                    open(i.key)
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: i.done ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(i.done ? Theme.primary : Theme.ink3)
                            .font(.title3)
                            .accessibilityHidden(true)
                        Text(title(i.key)).font(.subheadline).foregroundStyle(i.done ? Theme.ink3 : Theme.ink)
                            .strikethrough(i.done, color: Theme.ink3)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                        if !i.done { Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.ink3) }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(i.done)
                .accessibilityLabel(i.done ? LF("Done: %@", title(i.key)) : title(i.key))
            }
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.primarySoft.opacity(0.55), in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        .confirmationDialog(L("Hide this checklist?"), isPresented: $confirmHide, titleVisibility: .visible) {
            Button(L("Hide"), role: .destructive) { hide() }
        } message: {
            Text(L("Everything on it stays possible – in Settings and on the pages themselves."))
        }
    }
}

/// Settings › Haushalt (web: pulse.tsx PulseSettingsCard): the weekly question on Heute – take part, and separately
/// share the anonymous count. Admins change it, everyone sees it.
struct PulseSettingsSection: View {
    let api: APIClient
    let admin: Bool
    @State private var state: PulseState?
    @State private var error: String?

    var body: some View {
        Section {
            if let s = state {
                Toggle(isOn: Binding(get: { s.enabled ?? false }, set: { v in Task { await set(["enabled": v]) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Ask on Sundays"))
                        Text(L("“How often did someone have to ask ‘Do we still have …?’” – one tap on “Heute”.")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .disabled(!admin)
                if s.enabled == true {
                    Toggle(isOn: Binding(get: { s.share ?? false }, set: { v in Task { await set(["share": v]) } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Share the answer anonymously"))
                            Text(L("Only a count per week and answer – no name, no household. Off by default.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    .disabled(!admin)
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.empty) }
        } header: {
            Text(L("Weekly question (test phase)"))
        }
        .tint(Theme.primary)
        .task { state = try? await api.pulse() }
    }

    private func set(_ body: [String: Any]) async {
        do {
            _ = try await api.send("PUT", "api/pulse/settings", json: body, as: Ignored.self)
            state = try await api.pulse()
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
