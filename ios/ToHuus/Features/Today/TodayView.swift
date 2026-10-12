import Observation
import SwiftUI

@MainActor
@Observable
final class TodayModel {
    private(set) var today: TodayPayload?
    private(set) var loading = false
    private(set) var error: String?
    private(set) var limited = false
    private(set) var busyIds: Set<Int> = []

    func load(_ store: ServerStore) async {
        loading = true
        defer { loading = false }
        do {
            today = try await store.api.today()
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
    }

    func accept(_ item: RhythmItem, store: ServerStore) async {
        busyIds.insert(item.productId)
        defer { busyIds.remove(item.productId) }
        do {
            try await store.api.acceptRhythm(item.productId)
            Haptics.success()
        } catch APIError.offline {
            // offline: put it on the list through the queue instead
            await store.addProduct(item.productId, name: item.name)
        } catch {
            self.error = APIError.from(error).localizedDescription
            return
        }
        today?.rhythm.removeAll { $0.productId == item.productId }
        store.touch("shopping")
        await store.refreshList()
    }

    func dismiss(_ item: RhythmItem, store: ServerStore) async {
        busyIds.insert(item.productId)
        defer { busyIds.remove(item.productId) }
        try? await store.api.dismissRhythm(item.productId)
        today?.rhythm.removeAll { $0.productId == item.productId }
    }

    func missingToList(_ recipeId: Int, store: ServerStore) async -> String? {
        do {
            let r = try await store.api.missingToList(recipeId)
            store.touch("shopping")
            await store.refreshList()
            return LF("%d things are on the list now.", r.added ?? 0)
        } catch {
            return APIError.from(error).localizedDescription
        }
    }
}

struct TodayView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    let openSettings: () -> Void
    let openTab: (MainTabView.Tab) -> Void
    @State private var model = TodayModel()
    @State private var toast: String?

    private var refreshKey: Int {
        store.revision("shopping") + store.revision("stock") + store.revision("recipes") + store.revision("imports")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    header
                    SyncBadge(online: store.isOnline, pending: store.pendingCount)
                    if let error = model.error { ErrorBanner(message: error) { Task { await model.load(store) } } }
                    if let t = model.today {
                        ForEach(t.notices) { n in noticeRow(n) }
                        if !t.rhythm.isEmpty { dueCard(t.rhythm) }
                        listCard(open: t.list?.open ?? store.list.openCount, recent: t.list?.recent ?? [])
                        if !t.stillHave.isEmpty { stillHaveCard(t.stillHave) }
                        if let cook = t.cookToday, cook.recipeId != nil || cook.title != nil { cookCard(cook) }
                        if let money = t.money { moneyCard(money) }
                    } else if model.limited || !store.isOnline {
                        listCard(open: store.list.openCount, recent: [])
                    } else if model.loading {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    }
                }
                .padding(.horizontal, Theme.Space.s4)
                .padding(.bottom, 96)
            }
            .refreshable { await model.load(store); await store.refreshList() }
            .canvasBackground()
            .toolbar(.hidden, for: .navigationBar)
            .task(id: refreshKey) { await model.load(store) }
            .overlay(alignment: .bottom) { toastView }
        }
    }

    // MARK: pieces

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(model.today?.greeting ?? defaultGreeting)
                    .font(Theme.title())
                    .foregroundStyle(Theme.ink)
                if let hh = model.today?.householdName ?? app.activeHousehold?.name {
                    Text(hh).font(.subheadline).foregroundStyle(Theme.ink2)
                }
            }
            Spacer()
            Button(action: openSettings) {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: 28))
                    .foregroundStyle(Theme.primaryText)
            }
            .accessibilityLabel(L("More"))
        }
        .padding(.top, Theme.Space.s4)
    }

    private var defaultGreeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let name = app.userName.map { ", \($0)" } ?? ""
        switch h {
        case 5..<11: return L("Good morning") + name
        case 11..<17: return L("Hello") + name
        default: return L("Good evening") + name
        }
    }

    private func noticeRow(_ n: Notice) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s2) {
            Image(systemName: "info.circle").foregroundStyle(Theme.info)
            Text(n.text).font(.subheadline)
        }
        .padding(Theme.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.infoSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
    }

    private func dueCard(_ items: [RhythmItem]) -> some View {
        Card(title: L("Probably due"), systemImage: "clock.arrow.circlepath") {
            Text(L("ToHuus remembers how often you buy these. Put them on the list?"))
                .font(.footnote).foregroundStyle(Theme.ink2)
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                    if !item.detail.isEmpty { Text(item.detail).font(.caption).foregroundStyle(Theme.ink3) }
                    HStack(spacing: Theme.Space.s2) {
                        Button {
                            Task { await model.accept(item, store: store) }
                        } label: {
                            Label(L("On the list"), systemImage: "plus")
                        }
                        .buttonStyle(.borderedProminent)
                        Button(L("Not now")) { Task { await model.dismiss(item, store: store) } }
                            .buttonStyle(.bordered)
                        if model.busyIds.contains(item.productId) { ProgressView() }
                    }
                    .font(.subheadline)
                    .controlSize(.small)
                }
                .padding(.vertical, 4)
                if item.id != items.last?.id { Divider() }
            }
        }
    }

    private func listCard(open: Int, recent: [TodayPayload.RecentChange]) -> some View {
        Button {
            openTab(.shopping)
        } label: {
            Card(title: L("Shopping list"), systemImage: "cart") {
                HStack(alignment: .firstTextBaseline) {
                    Text("\(open)").font(.system(size: 34, weight: .semibold, design: .rounded)).foregroundStyle(Theme.primaryText)
                    Text(open == 1 ? L("thing is missing") : L("things are missing")).foregroundStyle(Theme.ink2)
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
                }
                ForEach(recent.prefix(4), id: \.stableId) { r in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(r.name ?? "").font(.subheadline).foregroundStyle(Theme.ink)
                        Text([r.origin, ServerDate.relative(r.at)].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func stillHaveCard(_ items: [StillHaveItem]) -> some View {
        Card(title: L("You still have"), systemImage: "leaf") {
            ForEach(items.prefix(6)) { i in
                HStack {
                    Text(i.name).font(.subheadline)
                    Spacer()
                    if let d = ServerDate.shortDay(i.date) { StatusPill(text: d, status: "expiring") }
                }
            }
        }
    }

    private func cookCard(_ cook: TodayPayload.CookToday) -> some View {
        Card(title: L("Cook today"), systemImage: "fork.knife") {
            HStack(spacing: Theme.Space.s3) {
                if let img = cook.image {
                    RemoteImage(url: store.api.imageURL(img), api: store.api, placeholder: "fork.knife")
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(cook.title ?? "").font(.headline)
                    if cook.missing.isEmpty {
                        Text(L("Everything is at home.")).font(.caption).foregroundStyle(Theme.primaryText)
                    } else {
                        Text(LF("Missing: %@", cook.missing.map(\.name).joined(separator: ", ")))
                            .font(.caption).foregroundStyle(Theme.ink2)
                    }
                }
            }
            HStack {
                Button(L("See ideas")) { openTab(.cooking) }.buttonStyle(.bordered)
                if !cook.missing.isEmpty, let rid = cook.recipeId {
                    Button(L("Missing → list")) {
                        Task { toast = await model.missingToList(rid, store: store) }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .controlSize(.small)
        }
    }

    private func moneyCard(_ m: TodayPayload.TodayMoney) -> some View {
        Button {
            openTab(.money)
        } label: {
            Card(title: L("Money"), systemImage: "eurosign.circle") {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s5) {
                    VStack(alignment: .leading) {
                        Text(L("This week")).font(.caption).foregroundStyle(Theme.ink3)
                        Text(Money.format(m.week)).font(.title3.weight(.semibold))
                    }
                    VStack(alignment: .leading) {
                        Text(L("This month")).font(.caption).foregroundStyle(Theme.ink3)
                        Text(Money.format(m.month)).font(.title3.weight(.semibold))
                    }
                    Spacer()
                }
                .foregroundStyle(Theme.ink)
                if let budget = m.budget, budget > 0, let month = m.month {
                    ProgressView(value: min(month / budget, 1)) {
                        Text(LF("%@ of %@ budget", Money.format(month), Money.format(budget))).font(.caption)
                    }
                    .tint(month > budget ? Theme.low : Theme.primary)
                }
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var toastView: some View {
        if let toast {
            Text(toast)
                .font(.subheadline)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Theme.ink, in: Capsule())
                .foregroundStyle(Theme.canvas)
                .padding(.bottom, 90)
                .task {
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                    self.toast = nil
                }
        }
    }
}
