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
    /// the person's own card order (GET /api/list/today-order)
    var order: [String] = []
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
        // the extras never block Heute
        if !guest, let o = try? await store.api.todayOrder() { order = o }
        pulse = guest ? nil : try? await store.api.pulse()
        started = admin ? try? await store.api.gettingStarted() : nil
    }

    func saveOrder(_ keys: [TodayCardKey], store: ServerStore) async -> String? {
        let old = order
        order = keys.map(\.rawValue)
        do {
            try await store.api.setTodayOrder(order)
            return nil
        } catch {
            order = old
            return APIError.from(error).localizedDescription
        }
    }

    func restoreOrder(_ old: [String], store: ServerStore) async {
        order = old
        try? await store.api.setTodayOrder(old)
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
        store.touch("shopping")
        await store.refreshList()
        return LF("%@ is on the shopping list", item.name)
    }

    func dismiss(_ item: RhythmItem, store: ServerStore) async -> String? {
        busyIds.insert(item.productId)
        defer { busyIds.remove(item.productId) }
        do {
            try await store.api.dismissRhythm(item.productId)
        } catch {
            return L("Couldn’t save")
        }
        today?.rhythm.removeAll { $0.productId == item.productId }
        return L("Okay – ToHuus asks again later.")
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

/// Heute (web: pages/Today.tsx): greeting, notices, the getting-started checklist, then the cards in the person's own
/// order – Fällig · Aufgaben · Liste · Das habt ihr noch · Heute kochen? · Geld · the weekly question. Each card hides
/// when it has nothing to say, except "Fällig", which then shows the three ways in.
struct TodayView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    let openSettings: () -> Void
    let openTab: (MainTabView.Tab) -> Void
    @State private var model = TodayModel()
    @State private var toast: ToastMessage?
    @State private var arranging = false
    @State private var showReceipt = false
    @State private var showPaperList = false
    @State private var showFirstRun = false
    @State private var path = NavigationPath()

    private enum Push: Hashable { case imports, invites, notifications, recipe(Int, Int?) }

    private var refreshKey: Int {
        store.revision("shopping") + store.revision("stock") + store.revision("recipes") + store.revision("imports")
    }

    private var guestLevel: String? { app.isGuest ? (app.guestLevel ?? "paused") : nil }
    private func allows(_ path: String) -> Bool { MoreAccess.guestAllows(guestLevel, path) }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    header
                    SyncBadge(online: store.isOnline, pending: store.pendingCount)
                    if let error = model.error { ErrorBanner(message: error) { Task { await reload() } } }
                    if let t = model.today {
                        notices(t)
                        if !app.isGuest { SampleNudgeCard() }
                        if let g = model.started, g.showChecklist == true, app.isAdmin || g.admin == true {
                            TodayChecklistCard(g: g, open: openChecklist, hide: { Task { await model.hideChecklist(store: store) } })
                        }
                        ForEach(shownCards(t)) { key in card(key, t) }
                        if canArrange && shownCards(t).count > 1 {
                            Button(L("Arrange cards")) { arranging = true }
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    } else if model.limited || !store.isOnline {
                        listCard(open: store.list.openCount, recent: [])
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
                case .invites: InvitesView(api: store.api)
                case .notifications: NotificationSettingsView()
                case .recipe(let id, let plan): RecipeDetailView(recipeId: id, store: store, planEntryId: plan)
                }
            }
            .sheet(isPresented: $arranging) {
                if let t = model.today {
                    TodayArrangeSheet(keys: shownCards(t)) { keys in Task { await saveOrder(keys) } }
                }
            }
            .sheet(isPresented: $showReceipt) { ReceiptCaptureView(store: store) }
            .sheet(isPresented: $showPaperList) { PaperListSheet(store: store) }
            .fullScreenCover(isPresented: $showFirstRun, onDismiss: { Task { await reload() } }) {
                FirstRunView(store: store)
            }
        }
    }

    private func reload() async { await model.load(store, guest: app.isGuest, admin: app.isAdmin) }

    private var canArrange: Bool { !app.isGuest }

    // MARK: cards in order

    private func available(_ key: TodayCardKey, _ t: TodayPayload) -> Bool {
        switch key {
        case .rhythm: return true
        case .tasks: return allows("/aufgaben")
        case .list: return allows("/einkauf")
        case .still: return !t.stillHave.isEmpty && app.moduleOn("stock")
        case .cook:
            guard let c = t.cookToday, c.recipeId != nil || c.title != nil else { return false }
            return app.moduleOn("cook") && allows("/kochen")
        case .money: return t.money != nil && app.moduleOn("money") && allows("/geld")
        case .pulse: return model.pulse?.question != nil && !app.isGuest
        }
    }

    private func shownCards(_ t: TodayPayload) -> [TodayCardKey] {
        TodayCardKey.sorted(TodayCardKey.allCases.filter { available($0, t) }, by: model.order)
    }

    @ViewBuilder private func card(_ key: TodayCardKey, _ t: TodayPayload) -> some View {
        switch key {
        case .rhythm: dueCard(t.rhythm)
        case .tasks:
            TodayOfferAsks(api: store.api, refresh: refreshKey)
            if !app.isGuest { WeekReviewTeaser(api: store.api, refresh: refreshKey) }
            TasksTodayCard(api: store.api, refresh: refreshKey)
            StarsCard(api: store.api, refresh: refreshKey)
            if !app.isGuest { ReviewTeaser(api: store.api, refresh: refreshKey) }
        case .list: listCard(open: t.list?.open ?? store.list.openCount, recent: t.list?.recent ?? [])
        case .still: EatSoonCard(items: t.stillHave, store: store)
        case .cook: if let c = t.cookToday { cookCard(c) }
        case .money: if let m = t.money { moneyCard(m) }
        case .pulse:
            if let p = model.pulse {
                TodayPulseCard(api: store.api, pulse: p) {
                    model.pulseAnswered()
                    toast = ToastMessage(text: L("Thanks – noted for this week."))
                }
            }
        }
    }

    private func saveOrder(_ keys: [TodayCardKey]) async {
        let old = model.order
        if let e = await model.saveOrder(keys, store: store) {
            toast = ToastMessage(text: e, isError: true)
        } else {
            toast = ToastMessage(text: L("Order saved"), actionTitle: L("Undo")) {
                Task { await model.restoreOrder(old, store: store) }
            }
        }
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
                if let hh = model.today?.householdName ?? app.activeHousehold?.name {
                    Text(hh).font(.subheadline).foregroundStyle(Theme.ink2)
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

    // MARK: notices

    @ViewBuilder private func notices(_ t: TodayPayload) -> some View {
        ForEach(Array(t.notices.prefix(3).enumerated()), id: \.offset) { i, n in
            let target = model.links.first { $0.text == n.text }?.target ?? model.links[safe: i]?.target
            let text = n.kind == "import" ? LF("Receipt “%@” is waiting for a quick look", n.text)
                : n.kind == "order" ? LF("%@ would love something", n.text) : n.text
            if let target, canOpen(target) {
                Button { open(target) } label: { noticeRow(text, link: true) }
                    .buttonStyle(.plain)
            } else {
                noticeRow(text, link: false)
            }
        }
    }

    private func noticeRow(_ text: String, link: Bool) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s2) {
            Image(systemName: "info.circle").foregroundStyle(Theme.info).accessibilityHidden(true)
            Text(text).font(.subheadline).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            if link { Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.ink3).accessibilityHidden(true) }
        }
        .padding(Theme.Space.s3)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(Theme.infoSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
    }

    private func canOpen(_ target: String) -> Bool {
        let p = target.split(separator: "?").first.map(String.init) ?? target
        return ["/import", "/geld", "/ausgaben", "/einkauf", "/bestand", "/kochen", "/rezepte"].contains { p == $0 || p.hasPrefix($0 + "/") }
    }

    private func open(_ target: String) {
        let p = target.split(separator: "?").first.map(String.init) ?? target
        if p.hasPrefix("/import") { path.append(Push.imports) }
        else if p.hasPrefix("/geld") || p.hasPrefix("/ausgaben") { openTab(.money) }
        else if p.hasPrefix("/einkauf") { openTab(.shopping) }
        else if p.hasPrefix("/bestand") { openTab(.pantry) }
        else if p.hasPrefix("/kochen") || p.hasPrefix("/rezepte") { openTab(.cooking) }
    }

    // MARK: getting started

    private func openChecklist(_ key: String) {
        switch key {
        case "home": showFirstRun = true
        case "invite": path.append(Push.invites)
        case "stock": if app.moduleOn("stock") { openTab(.pantry) } else { showReceipt = true }
        case "phone": path.append(Push.notifications)
        case "recipe": openTab(.cooking)
        default: break
        }
    }

    // MARK: 1 · Fällig

    private func dueCard(_ items: [RhythmItem]) -> some View {
        Card(title: L("Due"), systemImage: TodayCardKey.rhythm.symbol) {
            if items.isEmpty {
                TodayEntryLevels(shareReceipt: { showReceipt = true }, photoOfList: { showPaperList = true })
            } else {
                Text(L("ToHuus remembers how often you buy these. Put them on the list?"))
                    .font(.footnote).foregroundStyle(Theme.ink2)
                ForEach(items.prefix(3)) { item in dueRow(item) }
                if items.count > 3 {
                    Button {
                        openTab(.shopping)
                    } label: {
                        Label(LF("%d more suggestions on the shopping list", items.count - 3), systemImage: "arrow.right")
                            .font(.subheadline.weight(.semibold))
                    }
                    .frame(minHeight: 44)
                }
            }
        }
    }

    private func dueRow(_ item: RhythmItem) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(spacing: Theme.Space.s3) {
                ProductThumb(path: item.image, api: store.api, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                    if !item.detail.isEmpty { Text(item.detail).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2) }
                }
                Spacer(minLength: 0)
            }
            if model.busyIds.contains(item.productId) {
                ProgressView().frame(maxWidth: .infinity, minHeight: 44)
            } else {
                HStack(spacing: Theme.Space.s2) {
                    Button {
                        Task { if let m = await model.accept(item, store: store) { toast = ToastMessage(text: m) } }
                    } label: {
                        Label(L("Put on the list"), systemImage: "basket").frame(maxWidth: .infinity, minHeight: 36)
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.primary)
                    .accessibilityLabel(LF("Put %@ on the list", item.name))
                    Button {
                        Task { if let m = await model.dismiss(item, store: store) { toast = ToastMessage(text: m) } }
                    } label: {
                        Text(L("Still have it")).frame(maxWidth: .infinity, minHeight: 36)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel(LF("Still have %@", item.name))
                }
                .font(.subheadline.weight(.semibold))
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: 2 · Liste

    private func listCard(open: Int, recent: [TodayPayload.RecentChange]) -> some View {
        Button {
            openTab(.shopping)
        } label: {
            Card(title: L("List"), systemImage: TodayCardKey.list.symbol) {
                HStack(alignment: .firstTextBaseline) {
                    Text("\(open)").font(Theme.number()).foregroundStyle(Theme.primaryText).numberTransition(Double(open))
                    Text(open == 1 ? L("thing on the list") : L("things on the list")).foregroundStyle(Theme.ink2)
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
                }
                ForEach(recent.prefix(3), id: \.stableId) { r in
                    HStack(alignment: .top, spacing: Theme.Space.s2) {
                        Circle()
                            .fill(r.checked == true ? Theme.ink3 : Theme.primary)
                            .frame(width: 7, height: 7)
                            .padding(.top, 7)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.title).font(.subheadline).foregroundStyle(r.checked == true ? Theme.ink3 : Theme.ink)
                                .strikethrough(r.checked == true)
                            Text([r.checked == true ? L("ticked off") : nil, r.origin ?? ServerDate.relative(r.at)].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
                if open == 0 && recent.isEmpty {
                    Text(L("The list is empty. Everyone in the household can add to it – it updates live."))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
            }
        }
        .buttonStyle(.plain)
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
                        if let have = cook.probablyHave, !have.isEmpty {
                            Text(LF("Probably at home: %@", have.joined(separator: ", "))).font(.caption).foregroundStyle(Theme.ink3)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.ink3)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            HStack {
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

    // MARK: 5 · Geld

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
                if m.month == 0 {
                    Text(L("Share a receipt and ToHuus shows where the money for food and household goes."))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
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
