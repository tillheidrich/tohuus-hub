import SwiftUI

// Wer macht was (server: lib/habits.ts, docs/who-does-what.md, web: pages/WhoDoesWhat.tsx).
// Learned from what happens anyway: "macht meistens Sam". Names, no numbers, alphabetical. A judgement about the
// balance only when everyone agreed to compare – weighed by what each person carries, not by how often.

struct WhoDoesWhatData: Decodable, Sendable {
    struct Doing: Decodable, Sendable, Hashable, Identifiable {
        var kind: String
        var key: String
        var label: String
        var taskId: Int?
        var id: String { key }
    }
    struct Person: Decodable, Sendable, Identifiable, Hashable {
        var userId: Int
        var name: String
        var color: String?
        var me: Bool = false
        @Lossy var does: [Doing]
        var id: Int { userId }
    }
    struct Open: Decodable, Sendable, Hashable { var taskId: Int; var name: String }
    struct Proposal: Decodable, Sendable, Hashable, Identifiable {
        var taskId: Int
        var name: String
        var userId: Int
        var userName: String
        var id: Int { taskId }
    }
    struct Balance: Decodable, Sendable, Hashable { var state: String; var name: String? }
    /// "Du machst das seit Wochen" – only the viewer's own: tasks they did the last 6 times in a row
    struct Carrying: Decodable, Sendable, Hashable, Identifiable {
        var taskId: Int
        var name: String
        var times: Int?
        var id: Int { taskId }
    }
    @Lossy var people: [Person]
    @Lossy var open: [Open]
    @Lossy var proposals: [Proposal]
    var compare: Bool = false
    var balance: Balance?
    @Lossy var carrying: [Carrying]
}

struct CookSuggestion: Decodable, Sendable, Hashable {
    var entryId: Int
    var day: String
    var userId: Int
    var name: String
    var color: String?
    /// weekday | lately
    var why: String
}

private struct CookSuggestions: Decodable, Sendable { @Lossy var suggestions: [CookSuggestion] }

extension APIClient {
    /// GET /api/habits – who usually does what
    func whoDoesWhat() async throws -> WhoDoesWhatData { try await get("api/habits") }
    /// POST /api/habits/proposals/:id – write the habit down (accept) or never ask again
    func habitProposal(_ taskId: Int, accept: Bool) async throws {
        _ = try await send("POST", "api/habits/proposals/\(taskId)", json: ["accept": accept], as: Ignored.self)
    }
    /// POST /api/habits/carrying/:id/dismiss – "Passt so", never asked again for this task
    func habitCarryingDismiss(_ taskId: Int) async throws {
        _ = try await send("POST", "api/habits/carrying/\(taskId)/dismiss", json: [:], as: Ignored.self)
    }
    /// GET /api/habits/cook – who probably cooks the open meals (a suggestion only)
    func cookSuggestions(from: String, to: String) async throws -> [CookSuggestion] {
        let r: CookSuggestions = try await get("api/habits/cook", query: [URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to)])
        return r.suggestions
    }
    /// POST /api/care/:id/offer { to_user_id } – nil withdraws the question
    func careOffer(_ id: Int, to: Int?) async throws {
        _ = try await send("POST", "api/care/\(id)/offer", json: ["to_user_id": to.map { $0 as Any } ?? NSNull()], as: Ignored.self)
    }
    func careOfferAnswer(_ id: Int, accept: Bool) async throws {
        _ = try await send("POST", "api/care/\(id)/offer/answer", json: ["accept": accept], as: Ignored.self)
    }
}

/// Aufgaben: who usually does what, habits to write down, what nobody does regularly.
struct WhoDoesWhatSection: View {
    let api: APIClient
    let refresh: Int
    var onOpen: (Int) -> Void = { _ in }
    var onChanged: () -> Void = {}
    @State private var data: WhoDoesWhatData?
    @State private var error: String?
    @State private var loader = LoadTrigger()

    var body: some View {
        // loads from the body: in a List there is no invisible view to hang a .task on (Design/LoadSlot.swift)
        let _ = loader.run(id: refresh) { data = try? await api.whoDoesWhat() }
        if let d = data, d.people.contains(where: { !$0.does.isEmpty }) || !d.proposals.isEmpty {
            Section {
                ForEach(d.proposals) { p in
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        Text(d.people.first(where: { $0.userId == p.userId })?.me == true
                             ? LF("You usually do “%@”. Write it down like that?", p.name)
                             : LF("%@ usually does “%@”. Write it down like that?", p.userName, p.name)).font(.subheadline)
                        HStack {
                            Button(L("Yes, like that")) { Task { await answer(p, true) } }
                                .buttonStyle(.borderedProminent).tint(Theme.primary)
                            Button(L("Leave it open")) { Task { await answer(p, false) } }
                                .buttonStyle(.bordered)
                        }
                    }
                    .padding(.vertical, 4)
                }
                ForEach(d.people.filter { !$0.does.isEmpty }) { p in
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        HStack(spacing: Theme.Space.s2) {
                            PersonDot(name: p.name, color: p.color, size: 26)
                            Text(p.me ? L("You") : p.name).font(.subheadline.weight(.semibold))
                        }
                        FlowTags(items: p.does.map(\.label))
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }
                if !d.open.isEmpty {
                    Text(LF("Nobody does these regularly yet: %@", d.open.prefix(5).map(\.name).joined(separator: ", ") + (d.open.count > 5 ? " …" : "")))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
                if let b = d.balance {
                    Text(b.state == "even" ? L("Spread quite evenly right now – everyone carries their part.")
                                           : LF("A lot is with %@ right now. Would someone like to take something over?", b.name ?? ""))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
            } header: {
                Text(L("Who does what"))
            } footer: {
                Text(L("ToHuus notices who usually does what – from what happens anyway. No points, no ranking."))
            }
        }
    }

    private func answer(_ p: WhoDoesWhatData.Proposal, _ accept: Bool) async {
        do {
            try await api.habitProposal(p.taskId, accept: accept)
            data = try? await api.whoDoesWhat()
            error = nil
            onChanged()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Labels that wrap onto the next line instead of running off the edge.
struct FlowTags: View {
    let items: [String]
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { ForEach(items, id: \.self) { tag($0) } }
            VStack(alignment: .leading, spacing: 6) { ForEach(items, id: \.self) { tag($0) } }
        }
    }
    private func tag(_ s: String) -> some View {
        Text(s).font(.footnote)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Theme.surface2, in: Capsule())
            .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
    }
}

/// "Sam fragt: Übernimmst du „Müll raus“?" – on Aufgaben and Heute, only for the person asked.
struct OfferAsks: View {
    let api: APIClient
    let tasks: [CareTask]
    let me: Int?
    var onChanged: () -> Void = {}
    @State private var error: String?

    var body: some View {
        let mine = tasks.filter { $0.offer?.to.id == me && me != nil }
        if !mine.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s3) {
                ForEach(mine) { t in
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        Label(LF("%@ asks: will you take over “%@”?", t.offer?.by?.name ?? "", t.name), systemImage: "hand.raised")
                            .font(.subheadline)
                        HStack {
                            Button(L("Yes, I’ll take it")) { Task { await answer(t, true) } }
                                .buttonStyle(.borderedProminent).tint(Theme.primary)
                            Button(L("Rather not")) { Task { await answer(t, false) } }
                                .buttonStyle(.bordered)
                        }
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
            }
        }
    }

    private func answer(_ t: CareTask, _ accept: Bool) async {
        do {
            try await api.careOfferAnswer(t.id, accept: accept)
            error = nil
            onChanged()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Heute: the questions to me, as a small card (nothing when there is none).
struct TodayOfferAsks: View {
    let api: APIClient
    let refresh: Int
    @State private var data: CareData?

    var body: some View {
        LoadSlot {
            if let d = data, d.tasks.contains(where: { $0.offer?.to.id == d.me && d.me != nil }) {
                Card(title: L("Hand over"), systemImage: "hand.raised") {
                    OfferAsks(api: api, tasks: d.tasks, me: d.me) { Task { data = try? await api.care() } }
                }
            }
        }
        .task(id: refresh) { data = try? await api.care() }
    }
}

/// Task detail: "Abgeben an …" – ask another member to take it over.
struct OfferSection: View {
    let api: APIClient
    let task: CareTask
    let me: Int
    var onChanged: () -> Void = {}
    @State private var members: [Member] = []
    @State private var asked: String?
    @State private var error: String?
    @State private var loader = LoadTrigger()

    var body: some View {
        // loads from the body: in a List there is no invisible view to hang a .task on (Design/LoadSlot.swift)
        let _ = loader.run { members = (try? await api.members()) ?? [] }
        if !task.isPrivate, members.contains(where: { $0.id != me }) {
            Section {
                if task.doer == nil, let u = task.usual {
                    LabeledContent(L("Usually does it"), value: u.userId == me ? L("You") : u.name)
                }
                if let o = task.offer, asked == nil {
                    Text(LF("Asked %@ – waiting for an answer.", o.to.name)).font(.subheadline).foregroundStyle(Theme.ink2)
                    if o.by?.id == me {
                        Button(L("Withdraw"), role: .destructive) { Task { await offer(nil) } }
                    }
                } else if let asked {
                    Text(LF("Asked %@", asked)).font(.subheadline).foregroundStyle(Theme.ink2)
                } else {
                    ForEach(members.filter { $0.id != me && $0.kind != "guest" }) { m in
                        Button { Task { await offer(m) } } label: {
                            Label(LF("To %@", m.name), systemImage: "arrow.left.arrow.right")
                        }
                        .frame(minHeight: 44)
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
            } header: {
                Text(L("Hand over"))
            } footer: {
                Text((task.rotation ?? []).isEmpty ? L("From now on they do it – if they say yes.") : L("Your place in the turn goes to them – if they say yes."))
            }
        }
    }

    private func offer(_ m: Member?) async {
        do {
            try await api.careOffer(task.id, to: m?.id)
            asked = m?.name
            error = nil
            onChanged()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
