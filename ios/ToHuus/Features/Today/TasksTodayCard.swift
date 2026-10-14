import SwiftUI

/// Heute › Aufgaben heute (web: pages/TasksToday.tsx): a calm ring "heute geschafft" and what is due today or
/// overdue – the household's and my own private tasks (the server filters what I may see). No points, no ranking.
struct TasksTodayCard: View {
    let api: APIClient
    /// changes when Heute reloads
    let refresh: Int
    @State private var tasks: [CareTask] = []
    @State private var toast: ToastMessage?

    private var today: String { ServerDate.day() }
    private var open: [CareTask] { tasks.filter { $0.state == "today" || $0.state == "overdue" } }
    private var doneToday: Int { tasks.filter { $0.lastDone.map { String($0.prefix(10)) } == today }.count }

    var body: some View {
        Group {
            let total = open.count + doneToday
            if total > 0 {
                Card(title: L("Tasks today"), systemImage: "checklist") {
                    HStack(spacing: Theme.Space.s3) {
                        TaskRing(done: doneToday, total: total)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(open.isEmpty ? L("All done for today.") : LF("%d of %d done today", doneToday, total))
                                .font(.subheadline.weight(.semibold))
                            Text(open.isEmpty ? L("Nothing else is due.") : L("Tick off what’s done – the next date sets itself."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    ForEach(open.prefix(4)) { t in
                        HStack(spacing: Theme.Space.s3) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    if t.isPrivate { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(Theme.ink3).accessibilityLabel(L("Only for me")) }
                                    Text(t.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                                }
                                Text([t.state == "overdue" ? L("overdue") : t.dueTime.map { LF("today %@", TaskTime.label($0)) } ?? L("due today"), t.place, t.doer?.name].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(t.state == "overdue" ? Theme.empty : Theme.ink3)
                            }
                            Spacer(minLength: 0)
                            Button { Task { await done(t) } } label: {
                                Label(L("Done"), systemImage: "checkmark").font(.caption.weight(.semibold))
                            }
                            .buttonStyle(.bordered)
                            .tint(Theme.primary)
                            .frame(minHeight: 44)
                            .accessibilityLabel(LF("Done: %@", t.name))
                        }
                    }
                    if open.count > 4 {
                        Text(LF("%d more", open.count - 4)).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
        .task(id: refresh) { await load() }
        .toast($toast)
    }

    private func load() async {
        if let d = try? await api.care() { tasks = d.tasks }
    }

    private func done(_ t: CareTask) async {
        do {
            let r = try await api.careDone(t.id)
            toast = ToastMessage(text: r.task.nextDue.map { LF("Done. Next time: %@", CareLabels.day($0)) } ?? L("Done."), actionTitle: L("Undo"), action: {
                Task {
                    try? await api.careUndo(t.id)
                    await load()
                }
            })
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// Progress ring – calm, no confetti
struct TaskRing: View {
    let done: Int
    let total: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let part = total > 0 ? Double(done) / Double(total) : 0
        ZStack {
            Circle().stroke(Theme.line, lineWidth: 6)
            Circle().trim(from: 0, to: part)
                .stroke(Theme.primary, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(reduceMotion ? nil : .easeOut(duration: 0.4), value: part)
            Text("\(done)/\(total)").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink)
        }
        .frame(width: 52, height: 52)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LF("%d of %d done today", done, total))
    }
}
