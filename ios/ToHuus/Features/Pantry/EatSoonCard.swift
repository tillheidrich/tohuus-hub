import SwiftUI

/// "Das habt ihr noch" on Heute, with the actions per row: used up, still there, plan it.
/// Used up / still there answer the quick check for the place of the first batch (POST /api/fresh/check/:place),
/// so nothing goes on the list by itself; things only "probably at home" use /api/stock/used-up (which does).
struct EatSoonCard: View {
    let items: [StillHaveItem]
    let store: ServerStore
    @State private var places: [Int: Int] = [:]
    @State private var gone: Set<String> = []
    @State private var confirmed: Set<String> = []
    @State private var busy: Set<String> = []
    @State private var note: String?

    private var visible: [StillHaveItem] { Array(items.filter { !gone.contains($0.id) }.prefix(6)) }

    var body: some View {
        Card(title: L("You still have"), systemImage: "leaf") {
            if visible.isEmpty {
                Text(L("All taken care of.")).font(.subheadline).foregroundStyle(Theme.ink3)
            }
            ForEach(visible) { i in row(i) }
            if let note {
                Text(note).font(.caption).foregroundStyle(Theme.primaryText)
                    .task(id: note) { try? await Task.sleep(nanoseconds: 3_000_000_000); self.note = nil }
            }
        }
        .task(id: items.map(\.id).joined()) { await loadPlaces() }
    }

    private func row(_ i: StillHaveItem) -> some View {
        HStack(spacing: Theme.Space.s3) {
            ProductThumb(path: i.image, api: store.api, size: 40)
            // date under the name: long German names and large text never push it out of the card
            VStack(alignment: .leading, spacing: 3) {
                Text(i.name).font(.subheadline).foregroundStyle(Theme.ink).lineLimit(2)
                if let label = i.label ?? ServerDate.shortDay(i.date) {
                    if i.kind == "probably" {
                        Text(label).font(.caption).foregroundStyle(Theme.ink3)
                    } else {
                        StatusPill(text: label, status: (i.daysLeft ?? 1) < 0 ? "expired" : "expiring")
                    }
                }
                if confirmed.contains(i.id) {
                    Label(L("still there"), systemImage: "checkmark").font(.caption).foregroundStyle(Theme.primaryText)
                }
            }
            Spacer(minLength: 0)
            if busy.contains(i.id) {
                ProgressView().frame(width: 44, height: 44)
            } else {
                Menu {
                    Button { Task { await usedUp(i) } } label: { Label(L("Used up"), systemImage: "checkmark.circle") }
                    if i.kind != "probably" && i.productId.flatMap({ places[$0] }) != nil {
                        Button { Task { await stillThere(i) } } label: { Label(L("Still there"), systemImage: "hand.thumbsup") }
                    }
                    Menu {
                        Button(L("Today")) { Task { await plan(i, 0) } }
                        Button(L("Tomorrow")) { Task { await plan(i, 1) } }
                    } label: { Label(L("Plan it"), systemImage: "calendar.badge.plus") }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title3).foregroundStyle(Theme.primaryText)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(LF("What about %@?", i.name))
            }
        }
    }

    /// GET /api/fresh/today → product → place of its first batch
    private func loadPlaces() async {
        guard let r = try? await store.api.freshToday() else { return }
        var m: [Int: Int] = [:]
        for e in r.eatFirst { if let l = e.locationId { m[e.id] = l } }
        places = m
    }

    private func usedUp(_ i: StillHaveItem) async {
        guard let pid = i.productId else { return }
        busy.insert(i.id)
        defer { busy.remove(i.id) }
        do {
            if i.kind != "probably", let loc = places[pid] {
                try await store.api.checkAnswer(locationId: loc, productId: pid, action: "empty")
                note = LF("“%@” is used up.", i.name)
            } else {
                try await store.api.usedUp(pid)
                note = LF("“%@” is used up and on the list.", i.name)
                await store.refreshList()
            }
            Haptics.success()
            withAnimation { _ = gone.insert(i.id) }
            store.touch("stock")
        } catch { note = APIError.from(error).localizedDescription }
    }

    private func stillThere(_ i: StillHaveItem) async {
        guard let pid = i.productId, let loc = places[pid] else { return }
        busy.insert(i.id)
        defer { busy.remove(i.id) }
        do {
            try await store.api.checkAnswer(locationId: loc, productId: pid, action: "ok")
            Haptics.tick()
            confirmed.insert(i.id)
        } catch { note = APIError.from(error).localizedDescription }
    }

    private func plan(_ i: StillHaveItem, _ inDays: Int) async {
        busy.insert(i.id)
        defer { busy.remove(i.id) }
        let day = ServerDate.day(Calendar.current.date(byAdding: .day, value: inDays, to: Date()) ?? Date())
        do {
            try await store.api.planToEat(day: day, title: i.name)
            Haptics.success()
            note = inDays == 0 ? LF("“%@” is planned for today.", i.name) : LF("“%@” is planned for tomorrow.", i.name)
            store.touch("recipes")
        } catch { note = APIError.from(error).localizedDescription }
    }
}
