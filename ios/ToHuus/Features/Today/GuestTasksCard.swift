import SwiftUI

/// GET /api/guest-tasks → { tasks } – the tasks handed to this person (as doer, or standing in while someone is
/// away). For a permanent guest the only view of Aufgaben (docs/guests-and-permissions.md).
struct GuestTask: Decodable, Sendable, Identifiable, Hashable {
    struct CheckItem: Decodable, Sendable, Hashable { var text: String; var done: Bool? }
    struct StandIn: Decodable, Sendable, Hashable { var name: String?; var `for`: String?; var until: String? }
    var id: Int
    var name: String
    var note: String?
    var nextDue: String?
    var dueTime: String?
    /// none | ok | soon | today | overdue
    var state: String?
    var days: Int?
    var checklist: [CheckItem]?
    var place: String?
    var standIn: StandIn?
}

struct GuestTasksResponse: Decodable, Sendable {
    @Lossy var tasks: [GuestTask]
}

struct GuestTaskDone: Decodable, Sendable { var ok: Bool?; var message: String? }

extension APIClient {
    func guestTasks() async throws -> [GuestTask] { try await get("api/guest-tasks", as: GuestTasksResponse.self).tasks }
    /// POST /api/guest-tasks/:id/done → { ok, message } ("Erledigt – danke!")
    func guestTaskDone(_ id: Int) async throws -> GuestTaskDone { try await send("POST", "api/guest-tasks/\(id)/done", json: [:]) }
}

/// Heute for a permanent guest: "Deine Aufgaben hier" – what the household handed to them (Oma waters the plants),
/// with the checklist to read and one "Erledigt". Nothing shown when nothing is handed over.
struct GuestTasksCard: View {
    let api: APIClient
    let refresh: Int
    var onDone: (String) -> Void = { _ in }
    @State private var tasks: [GuestTask] = []
    @State private var busy: Set<Int> = []
    @State private var error: String?

    var body: some View {
        Group {
            if !tasks.isEmpty {
                Card(title: L("Your tasks here"), systemImage: "checklist") {
                    VStack(alignment: .leading, spacing: Theme.Space.s3) {
                        ForEach(tasks) { t in row(t) }
                        if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                    }
                }
            }
        }
        .task(id: refresh) { await load() }
    }

    private func row(_ t: GuestTask) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(alignment: .top, spacing: Theme.Space.s3) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.name).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                    let sub = [due(t), t.place, t.standIn.flatMap { s in s.for.map { LF("while %@ is away", $0) } }].compactMap { $0 }
                    if !sub.isEmpty { Text(sub.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink3) }
                }
                Spacer(minLength: 0)
                Button { Task { await done(t) } } label: {
                    Label(L("Done"), systemImage: "checkmark").font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
                .buttonStyle(.bordered).tint(Theme.primary)
                .disabled(busy.contains(t.id))
                .accessibilityLabel(LF("%@ done", t.name))
            }
            if let n = t.note, !n.isEmpty {
                Text(n).font(.subheadline).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
            if let items = t.checklist, !items.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, i in
                        Label(i.text, systemImage: i.done == true ? "checkmark.circle.fill" : "circle")
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, 2)
    }

    private func due(_ t: GuestTask) -> String? {
        guard let d = t.nextDue else { return nil }
        let day = t.state == "today" ? L("today") : (ServerDate.shortDay(d) ?? d)
        return t.dueTime.map { "\(day), \($0)" } ?? day
    }

    private func done(_ t: GuestTask) async {
        busy.insert(t.id)
        defer { busy.remove(t.id) }
        do {
            let r = try await api.guestTaskDone(t.id)
            Haptics.success()
            error = nil
            onDone(r.message ?? L("Done – thank you!"))
            await load()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func load() async {
        do {
            tasks = try await api.guestTasks()
            error = nil
        } catch {
            tasks = []
        }
    }
}
