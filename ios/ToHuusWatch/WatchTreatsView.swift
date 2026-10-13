import SwiftUI
import WatchKit

/// "Bring mir was" on the wrist (13 Oct 2026): what the others asked for, with "Bring ich" and "Gebracht" – the
/// moment you get up from the sofa, the phone is often elsewhere. Asking for something stays on the iPhone and with
/// "Sprechen". Needs a direct session (the requests are not part of the list the iPhone hands over).
struct WatchTreatsView: View {
    @Environment(WatchStore.self) private var store
    @State private var requests: [TreatOrder] = []
    @State private var mine: [TreatOrder] = []
    @State private var loaded = false
    @State private var failed = false
    @State private var busy: Int?

    var body: some View {
        List {
            if store.api == nil {
                Text(L("Open ToHuus on your iPhone once – the watch takes the sign-in from there."))
                    .font(.footnote).foregroundStyle(.secondary)
            } else if failed {
                Label(L("Not reachable right now."), systemImage: "wifi.exclamationmark")
                    .font(.footnote).foregroundStyle(.secondary)
            } else if loaded && requests.isEmpty && mine.isEmpty {
                Label(L("Nobody is asking for anything right now."), systemImage: "heart")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if !requests.isEmpty {
                Section(L("Asked of you")) {
                    ForEach(requests) { o in request(o) }
                }
            }
            if !mine.isEmpty {
                Section(L("You asked for")) {
                    ForEach(mine) { o in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(o.itemsText).font(.footnote)
                            Text(status(o)).font(.caption2).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .navigationTitle(L("Bring me something"))
        .task { await load() }
        .refreshable { await load() }
    }

    private func request(_ o: TreatOrder) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(o.itemsText).font(.body.weight(.semibold))
            if let who = o.forName ?? o.guestName {
                Text(who).font(.caption2).foregroundStyle(.secondary)
            }
            if let note = o.note, !note.isEmpty {
                Text(note).font(.caption2).foregroundStyle(.secondary)
            }
            if o.status == "new" {
                Button(L("I’ll bring it")) { Task { await answer(o, "accepted") } }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy == o.id)
            } else if o.status == "accepted" {
                Button(L("Brought it")) { Task { await answer(o, "done") } }
                    .buttonStyle(.bordered)
                    .disabled(busy == o.id)
            }
        }
        .padding(.vertical, 2)
    }

    private func status(_ o: TreatOrder) -> String {
        switch o.status {
        case "accepted": return o.byName.map { LF("%@ brings it", $0) } ?? L("On its way")
        case "done": return L("Brought")
        case "declined": return o.reason ?? L("Not right now")
        default: return L("Asked")
        }
    }

    private func load() async {
        guard let api = store.api else { return }
        do {
            async let r = api.treatRequests()
            async let m = api.myTreats()
            let (asked, own) = try await (r, m)
            requests = asked.filter { $0.status == "new" || $0.status == "accepted" }
            // what I asked for and is not settled yet (brought ones disappear once thanked)
            mine = Array(own.filter { $0.status != "done" || $0.thankedAt == nil }.prefix(5))
            failed = false
        } catch {
            failed = true
        }
        loaded = true
    }

    private func answer(_ o: TreatOrder, _ status: String) async {
        guard let api = store.api else { return }
        busy = o.id
        defer { busy = nil }
        do {
            try await api.answerTreat(o.id, status: status)
            WKInterfaceDevice.current().play(.success)
            await load()
        } catch {
            WKInterfaceDevice.current().play(.failure)
            failed = true
        }
    }
}
