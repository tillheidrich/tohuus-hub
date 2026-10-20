import Observation
import SwiftUI

@MainActor
@Observable
final class TodayModel {
    private(set) var today: TodayPayload?
    /// the same notices with where they lead (`path`)
    private(set) var links: [TodayNoticeLinks.Item] = []
    private(set) var loading = false
    private(set) var error: String?
    private(set) var limited = false
    private(set) var busyIds: Set<Int> = []
    /// only while the context place is the weekly question / getting started
    private(set) var pulse: PulseState?
    private(set) var started: GettingStarted?

    func load(_ store: ServerStore, guest: Bool, admin: Bool) async {
        loading = true
        defer { loading = false }
        do {
            let data = try await store.api.getData("api/today")
            today = try store.api.decode(TodayPayload.self, from: data)
            links = (try? store.api.decode(TodayNoticeLinks.self, from: data))?.notices ?? []
            store.nextDue = today?.rhythm.first { ($0.dueInDays ?? 1) <= 0 && $0.onList != true }?.name
            limited = false
            error = nil
        } catch APIError.notFound {
            // server without /api/today yet: show what the app knows itself
            limited = true
            error = nil
        } catch {
            let e = APIError.from(error)
            if !e.isOffline || today == nil { self.error = e.localizedDescription }
        }
        // the extras never block Heute, and are only asked for when the server chose them
        let kind = today?.context?.kind
        pulse = !guest && kind == "pulse" ? try? await store.api.pulse() : nil
        started = admin && kind == "start" ? try? await store.api.gettingStarted() : nil
    }

    func saveOrder(_ keys: [TodayCardKey], store: ServerStore) async -> String? {
        do {
            try await store.api.setTodayOrder(keys.map(\.rawValue))
            return nil
        } catch {
            return APIError.from(error).localizedDescription
        }
    }

    func pulseAnswered() { pulse = nil }

    func hideChecklist(store: ServerStore) async {
        try? await store.api.dismissChecklist()
        started = try? await store.api.gettingStarted()
    }

    func accept(_ item: RhythmItem, store: ServerStore) async -> String? {
        busyIds.insert(item.productId)
        defer { busyIds.remove(item.productId) }
        do {
            try await store.api.acceptRhythm(item.productId)
            Haptics.success()
        } catch APIError.offline {
            // offline: put it on the list through the queue instead
            await store.addProduct(item.productId, name: item.name)
        } catch {
            return APIError.from(error).localizedDescription
        }
        today?.rhythm.removeAll { $0.productId == item.productId }
        today?.soonAgain.removeAll { $0.productId == item.productId }
        store.touch("shopping")
        await store.refreshList()
        return LF("%@ is on the shopping list", item.name)
    }

    func missingToList(_ cook: TodayPayload.CookToday, store: ServerStore) async -> String? {
        do {
            let n: Int
            if !cook.missing.isEmpty {
                try await store.api.quickAddNames(cook.missing)
                n = cook.missing.count
            } else if let rid = cook.recipeId {
                n = try await store.api.missingToList(rid).added ?? 0
            } else {
                return nil
            }
            store.touch("shopping")
            await store.refreshList()
            Haptics.success()
            return n == 1 ? LF("%@ is on the shopping list", cook.missing.first?.name ?? "") : LF("%d things are on the list now.", n)
        } catch {
            return APIError.from(error).localizedDescription
        }
    }
}

/// Heute, Paket B (web: pages/Today.tsx, docs/today.md): the head, then at most five calm cards in a fixed order –
/// Jetzt dran · Liste · Bald verbrauchen · Heute kochen · (Geld, only when switched on) · one context place. The
/// server decides which cards show (`cards` of /api/today); this view only draws them. No forms on Heute: Check-in
/// and Im Kopf are small ways in below the cards. The calm card only when there is really nothing.
struct TodayView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    let openSettings: () -> Void
    let openTab: (MainTabView.Tab) -> Void
    @State private var model = TodayModel()
    @State private var toast: ToastMessage?
    @State private var arranging = false
    @State private var showFirstRun = false
    @State private var showCheckin = false
    @State private var path = NavigationPath()

    private enum Push: Hashable { case imports, treats, recipe(Int, Int?), wishes, wishList(Int), giving, mind, week, invites, notifications }

    private var refreshKey: Int {
        store.revision("shopping") + store.revision("stock") + store.revision("recipes") + store.revision("imports") + store.revision("care")
    }

    private var guestLevel: String? { app.isGuest ? (app.guestLevel ?? "paused") : nil }
    private func allows(_ path: String) -> Bool { MoreAccess.guestAllows(guestLevel, path) }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                CardStack(spacing: Theme.Space.s4) {
                    header
                    SyncBadge(online: store.isOnline, pending: store.pendingCount)
                    if let note = OfflineNote.for(["api/today"]) { note }
                    if let error = model.error { ErrorBanner(message: error) { Task { await reload() } } }
                    if let t = model.today {
                        ForEach(cards(t)) { key in card(key, t) }
                        // "Fertig für heute": a quiet end – nothing to keep scrolling
                        // no article below it (Paket B: Heute shows no "Gut zu wissen")
                        if t.calm == true && !app.isGuest { CalmCard() }
                        entries(t)
                        if !app.isGuest && movable(t).count > 1 {
                            Button(L("Arrange cards")) { arranging = true }
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    } else if model.limited || !store.isOnline {
                        listCard(open: store.list.openCount, recent: [], soon: [])
                    } else if model.loading {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    }
                }
                .padding(.horizontal, Theme.Space.s4)
                .padding(.bottom, 96)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await reload(); await store.refreshList() }
            .canvasBackground()
            .toolbar(.hidden, for: .navigationBar)
            .task(id: refreshKey) { await reload() }
            .toast($toast)
            .navigationDestination(for: Push.self) { p in
                switch p {
                case .imports: ImportsListView(store: store)
                case .treats: TreatsView(api: store.api)
                case .recipe(let id, let plan): RecipeDetailView(recipeId: id, store: store, planEntryId: plan)
                // wish lists: "Linas Geburtstag in 12 Tagen · 3 Wünsche noch frei", "2 Geschenke noch besorgen"
                case .wishes: WishesView(api: store.api)
                case .wishList(let id): WishListDetailView(api: store.api, listId: id)
                case .giving: GivingView(api: store.api)
                case .mind: MindView(api: store.api)
                case .week: WeekReviewView(api: store.api) { Task { await reload() } }
                case .invites: InvitesView(api: store.api)
                case .notifications: NotificationSettingsView()
                }
            }
            .sheet(isPresented: $arranging) {
                if let t = model.today {
                    TodayArrangeSheet(keys: movable(t)) { keys in Task { await saveOrder(keys) } }
                }
            }
            .sheet(isPresented: $showCheckin, onDismiss: { Task { await reload() } }) {
                NavigationStack {
                    ScrollView {
                        CheckinCard(api: store.api, refresh: refreshKey) { msg in
                            showCheckin = false
                            toast = ToastMessage(text: msg)
                        }
                        .padding(Theme.Space.s4)
                    }
                    .canvasBackground()
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { showCheckin = false } } }
                }
                .presentationDetents([.medium, .large])
            }
            .fullScreenCover(isPresented: $showFirstRun, onDismiss: { Task { await reload() } }) {
                FirstRunView(store: store)
            }
        }
    }

    private func reload() async { await model.load(store, guest: app.isGuest, admin: app.isAdmin) }

    // MARK: cards – the server's choice

    private func cards(_ t: TodayPayload) -> [TodayCardKey] {
        let keys = t.cards.map { $0.compactMap(TodayCardKey.init(rawValue:)) } ?? TodayCardKey.fallback(t)
        // the app's own module state can be newer than the answer (switched off a moment ago)
        return keys.filter { k in
            switch k {
            case .still: return app.moduleOn("stock") && !t.useSoon.isEmpty
            case .cook: return app.moduleOn("cook") && t.cookToday != nil && allows("/kochen")
            case .money: return app.moduleOn("money") && t.money != nil && allows("/geld")
            case .now: return t.now != nil
            case .context: return t.context != nil
            case .list: return allows("/einkauf")
            }
        }
    }

    private func movable(_ t: TodayPayload) -> [TodayCardKey] { cards(t).filter { $0 != .context } }

    @ViewBuilder private func card(_ key: TodayCardKey, _ t: TodayPayload) -> some View {
        switch key {
        case .now:
            if let n = t.now {
                TodayNowCard(api: store.api, now: n, refresh: refreshKey, openTasks: { openTab(.tasks) }) { msg in
                    if let msg { toast = msg }
                    Task { await reload() }
                }
            }
        case .list: listCard(open: t.list?.open ?? store.list.openCount, recent: t.list?.recent ?? [], soon: t.soonAgain)
        case .still: EatSoonCard(items: t.useSoon, store: store)
        case .cook: if let c = t.cookToday { cookCard(c) }
        case .money: if let m = t.money { moneyCard(m) }
        case .context: if let c = t.context { contextCard(c) }
        }
    }

    private func saveOrder(_ keys: [TodayCardKey]) async {
        let old = model.today.map(movable) ?? []
        if let e = await model.saveOrder(keys, store: store) {
            toast = ToastMessage(text: e, isError: true)
        } else {
            toast = ToastMessage(text: L("Order saved"), actionTitle: L("Undo")) {
                Task {
                    _ = await model.saveOrder(old, store: store)
                    await reload()
                }
            }
            await reload()
        }
    }

    // MARK: small ways in (never a form on Heute)

    @ViewBuilder private func entries(_ t: TodayPayload) -> some View {
        let checkin = t.entries?.checkin == true && !app.isGuest
        let mind = t.entries?.mind == true && !app.isGuest
        if checkin || mind {
            FlowLayout(spacing: 8) {
                if checkin {
                    entryChip(L("What did you solve today?"), "checkmark.circle") { showCheckin = true }
                }
                if mind {
                    entryChip(L("Something on your mind?"), "lightbulb") { path.append(Push.mind) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func entryChip(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Theme.surface, in: Capsule())
                .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: header

    private var header: some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                if let until = model.today?.away?.me?.until {
                    // small easter egg: away, the app isn't "to Huus" – Low German for "not at home"
                    Text("Nich to Huus · " + LF("back on %@", AwayText.day(until)))
                        .font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Theme.primaryText)
                        .accessibilityLabel(L("Not at home") + ", " + LF("back on %@", AwayText.day(until)))
                } else {
                    Text(Date().formatted(.dateTime.weekday(.wide).day().month(.wide)))
                        .font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Theme.ink3)
                }
                Text(model.today?.greeting ?? defaultGreeting)
                    .font(Theme.title())
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                if let p = model.today?.platt { PlattLine(platt: p) }
                if let others = model.today?.away?.others, !others.isEmpty {
                    Text(LF("Away: %@", others.map { LF("%@ (until %@)", $0.name, AwayText.day($0.until)) }.joined(separator: ", ")))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
            }
            Spacer()
            if allows("/einkauf") {
                Button { app.requestAdd() } label: {
                    Image(systemName: "plus")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                        .frame(width: 40, height: 40)
                        .background(Theme.surface, in: Circle())
                        .overlay(Circle().stroke(Theme.line, lineWidth: 1))
                        .tapTarget()
                }
                .accessibilityLabel(L("Add to the list"))
            }
            Button { app.showSearch = true } label: {
                Image(systemName: "magnifyingglass")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: 40, height: 40)
                    .background(Theme.surface, in: Circle())
                    .overlay(Circle().stroke(Theme.line, lineWidth: 1))
                    .tapTarget()
            }
            .accessibilityLabel(L("Search"))
            Button(action: openSettings) {
                PersonAvatar(name: app.userName ?? "?", size: 40, api: store.api)
                    .tapTarget()
            }
            .accessibilityLabel(L("More"))
            .accessibilityHint(L("Settings, people, guests …"))
        }
        .padding(.top, Theme.Space.s4)
    }

    private var defaultGreeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let name = app.userName.map { ", \($0)" } ?? ""
        // German: the same Platt greeting the server sends, so nothing flips after loading
        if Locale.current.language.languageCode?.identifier == "de" {
            return ((18..<23).contains(h) ? "'n Avend" : "Moin") + name
        }
        switch h {
        case 0..<5: return L("Good night") + name
        case 5..<11: return L("Good morning") + name
        case 11..<17: return L("Hello") + name
        default: return L("Good evening") + name
        }
    }

    // MARK: the one context place

    @ViewBuilder private func contextCard(_ c: TodayPayload.TodayContext) -> some View {
        if c.kind == "pulse", let p = model.pulse, p.question != nil {
            TodayPulseCard(api: store.api, pulse: p) {
                model.pulseAnswered()
                toast = ToastMessage(text: L("Thanks – noted for this week."))
                Task { await reload() }
            }
        } else if c.kind == "start", let g = model.started, g.showChecklist == true {
            TodayChecklistCard(g: g, open: openChecklist, hide: { Task { await model.hideChecklist(store: store); await reload() } })
        } else if c.kind == "demo" {
            SampleNudgeCard()
        } else {
            Button { open(c) } label: {
                HStack(spacing: Theme.Space.s3) {
                    Image(systemName: Self.contextSymbol[c.kind] ?? "info.circle")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                        .frame(width: 36, height: 36)
                        .background(Theme.surface, in: Circle())
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.text).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                        if let d = c.detail { Text(d).font(.caption).foregroundStyle(Theme.ink2) }
                    }
                    Spacer(minLength: 0)
                    if c.path != nil { Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.ink3).accessibilityHidden(true) }
                }
                .padding(Theme.Space.s3)
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .background(["bins", "orders", "handover", "occasion"].contains(c.kind) ? Theme.warningSoft : Theme.infoSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private static let contextSymbol: [String: String] = [
        "occasion": "gift", "orders": "hand.raised", "handover": "arrow.left.arrow.right", "bins": "trash", "imports": "doc.text", "budget": "eurosign.circle",
        "demo": "flask", "trial": "hourglass", "week": "sparkles", "pulse": "questionmark.bubble", "start": "flag",
    ]

    private func open(_ c: TodayPayload.TodayContext) {
        switch c.kind {
        case "orders": path.append(Push.treats)
        case "week": path.append(Push.week)
        case "trial": app.showPaywall = true
        case "start": showFirstRun = true
        case "bins": openTab(.tasks)
        default: if let p = c.path { open(p) }
        }
    }

    private func open(_ target: String) {
        let p = target.split(separator: "?").first.map(String.init) ?? target
        if p.hasPrefix("/import") { path.append(Push.imports) }
        else if p.hasPrefix("/geld") || p.hasPrefix("/ausgaben") { openTab(.money) }
        else if p == "/einkauf/wuensche/schenken" { path.append(Push.giving) }
        else if p.hasPrefix("/einkauf/wuensche/"), let id = Int(p.dropFirst("/einkauf/wuensche/".count)) { path.append(Push.wishList(id)) }
        else if p.hasPrefix("/einkauf/wuensche") { path.append(Push.wishes) }
        else if p.hasPrefix("/einkauf") { openTab(.shopping) }
        else if p.hasPrefix("/bestand") { openTab(.stock) }
        else if p.hasPrefix("/aufgaben") { openTab(.tasks) }
        else if p.hasPrefix("/kochen") || p.hasPrefix("/rezepte") { openTab(.cooking) }
        else if p.hasPrefix("/bestellen") { path.append(Push.treats) }
        else if p.hasPrefix("/woche") { path.append(Push.week) }
        else if p.hasPrefix("/einstellungen") { openSettings() }
    }

    private func openChecklist(_ key: String) {
        switch key {
        case "home": showFirstRun = true
        case "invite": path.append(Push.invites)
        case "stock": openTab(app.moduleOn("stock") ? .stock : .shopping)
        case "phone": path.append(Push.notifications)
        case "recipe": openTab(.cooking)
        default: break
        }
    }

    // MARK: 2 · Liste (with "Bald wieder nötig")

    private func listCard(open: Int, recent: [TodayPayload.RecentChange], soon: [RhythmItem]) -> some View {
        Card(title: L("List"), systemImage: TodayCardKey.list.symbol) {
            if open > 0 {
                Button {
                    openTab(.shopping)
                } label: {
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(open)").font(Theme.number()).foregroundStyle(Theme.primaryText).numberTransition(Double(open))
                            Text(open == 1 ? L("thing on the list") : L("things on the list")).foregroundStyle(Theme.ink2)
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
                        }
                        ForEach(recent.filter { $0.checked != true }.prefix(3), id: \.stableId) { r in
                            HStack(alignment: .top, spacing: Theme.Space.s2) {
                                Circle().fill(Theme.primary).frame(width: 7, height: 7).padding(.top, 7).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(r.title).font(.subheadline).foregroundStyle(Theme.ink)
                                    if let o = r.origin ?? ServerDate.relative(r.at) { Text(o).font(.caption).foregroundStyle(Theme.ink3) }
                                }
                            }
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if !soon.isEmpty {
                if open > 0 { Divider() }
                Text(L("Needed again soon")).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                FlowLayout(spacing: 8) {
                    ForEach(soon) { r in
                        Button {
                            Task { if let m = await model.accept(r, store: store) { toast = ToastMessage(text: m) } }
                        } label: {
                            Label(r.name, systemImage: "plus")
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 12)
                                .frame(minHeight: 44)
                                .background(Theme.primarySoft, in: Capsule())
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(model.busyIds.contains(r.productId))
                        .accessibilityLabel(LF("Put %@ on the list", r.name))
                    }
                }
            }
            if open == 0 && soon.isEmpty {
                Text(L("The list is empty. Everyone in the household can add to it – it updates live."))
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
        }
    }

    // MARK: 4 · Heute kochen?

    private func cookCard(_ cook: TodayPayload.CookToday) -> some View {
        Card(title: cook.kind == "planned" ? L("Planned for today") : L("Cook today?"), systemImage: TodayCardKey.cook.symbol) {
            Button {
                if let rid = cook.recipeId { path.append(Push.recipe(rid, cook.planId)) } else { openTab(.cooking) }
            } label: {
                HStack(spacing: Theme.Space.s3) {
                    if let img = cook.image {
                        RemoteImage(url: store.api.imageURL(img), api: store.api, placeholder: "fork.knife")
                            .frame(width: 64, height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                    } else {
                        Image(systemName: "fork.knife").font(.title2).foregroundStyle(Theme.primaryText)
                            .frame(width: 64, height: 64)
                            .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            .accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(cook.title ?? "").font(.headline).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                        Text(cookLine(cook)).font(.caption).foregroundStyle(cook.kind != "planned" && cook.missing.isEmpty ? Theme.primaryText : Theme.ink2)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.ink3)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            AdaptiveButtonRow { _ in
                Button(L("More ideas")) { openTab(.cooking) }.buttonStyle(.bordered)
                if !cook.missing.isEmpty {
                    Button(cook.missing.count == 1 ? L("Put it on the list") : L("Put the missing on the list")) {
                        Task { if let m = await model.missingToList(cook, store: store) { toast = ToastMessage(text: m) } }
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.primary)
                }
            }
            .controlSize(.small)
            .frame(minHeight: 44)
        }
    }

    private func cookLine(_ cook: TodayPayload.CookToday) -> String {
        var parts: [String] = []
        if cook.kind == "planned" {
            parts.append((cook.why ?? []).joined(separator: " · "))
        } else if cook.missing.isEmpty {
            parts.append(L("Everything is at home"))
        } else {
            parts.append(LF("Missing: %@", cook.missing.map(\.name).joined(separator: ", ")))
        }
        if let t = cook.timeMin, t > 0 { parts.append(LF("%d min", Int(t))) }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    // MARK: Geld (off unless switched on: Einstellungen › Ich › Ruhe & Fokus)

    private func moneyCard(_ m: TodayPayload.TodayMoney) -> some View {
        Button {
            openTab(.money)
        } label: {
            Card(title: L("Money"), systemImage: TodayCardKey.money.symbol) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s5) {
                    VStack(alignment: .leading) {
                        Text(L("This week")).font(.caption).foregroundStyle(Theme.ink3)
                        Text(Money.format(m.week, currency: m.currency)).font(.title3.weight(.semibold))
                    }
                    VStack(alignment: .leading) {
                        Text(Date().formatted(.dateTime.month(.wide))).font(.caption).foregroundStyle(Theme.ink3)
                        Text(Money.format(m.month, currency: m.currency)).font(.title3.weight(.semibold))
                    }
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
                }
                .foregroundStyle(Theme.ink)
                if let budget = m.budgetAmount, budget > 0 {
                    let month = m.month ?? 0
                    let over = m.budgetState.map { $0 == "over" } ?? (month > budget)
                    VStack(alignment: .leading, spacing: 4) {
                        ProgressView(value: min(month / budget, 1))
                            .tint(over ? Theme.low : (m.budgetState == "near" ? Theme.warning : Theme.primary))
                            .accessibilityLabel(LF("%d %% of the budget", Int((min(month / budget, 1) * 100).rounded())))
                        Text(over
                             ? LF("%@ over the budget of %@", Money.format(month - budget, currency: m.currency), Money.format(budget, currency: m.currency))
                             : LF("%@ left of %@", Money.format(budget - month, currency: m.currency), Money.format(budget, currency: m.currency)))
                            .font(.caption).foregroundStyle(over ? Theme.low : Theme.ink2)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }
}

/// The Plattdeutsch saying under the greeting; a tap shows what it means.
private struct PlattLine: View {
    let platt: TodayPayload.Platt
    @State private var open = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                if reduceMotion { open.toggle() } else { withAnimation(.easeOut(duration: 0.2)) { open.toggle() } }
            } label: {
                Text("„\(platt.text)“")
                    .font(.subheadline.italic())
                    .foregroundStyle(Theme.ink2)
                    .underline(pattern: .dot, color: Theme.ink3)
                    .multilineTextAlignment(.leading)
                    .frame(minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityHint(L("Shows what it means"))
            .id(platt.id)
            if open {
                (Text(platt.meaning).bold().foregroundStyle(Theme.ink) + Text(" " + platt.note).foregroundStyle(Theme.ink2))
                    .font(.footnote)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
        }
    }
}
