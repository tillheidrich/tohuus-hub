import SwiftUI

/// Heute › Aufgaben heute (web: pages/TasksToday.tsx): a calm ring "heute geschafft" and what is due today or
/// overdue – the household's and my own private tasks (the server filters what I may see). No points, no ranking.
struct TasksTodayCard: View {
    let api: APIClient
    /// changes when Heute reloads
    let refresh: Int
    @State private var tasks: [CareTask] = []
    @State private var toast: ToastMessage?
    /// "Nur eins" (docs/now.md): only the next task as one card – personal, saved on the server
    @State private var oneThing = FocusFlags.oneThing
    /// the tip about "Nur eins" was put away on this device
    @AppStorage("tip.oneThing") private var tipGone = false

    private var today: String { ServerDate.day() }
    private var open: [CareTask] { tasks.filter { $0.state == "today" || $0.state == "overdue" } }
    /// gentle mode (FocusViews.swift): at most N things, "wäre dran" instead of "überfällig"
    private var max: Int { FocusFlags.todayMax ?? 4 }
    private var doneToday: Int { tasks.filter { $0.lastDone.map { String($0.prefix(10)) } == today }.count }

    var body: some View {
        // a LoadSlot, not a Group: .task on an empty Group never runs, so the card would never load (Design/LoadSlot.swift)
        LoadSlot {
            let total = open.count + doneToday
            if total > 0 && oneThing {
                Card(title: L("Tasks today"), systemImage: "checklist") {
                    oneToggle
                    OneThingTodayView(api: api, refresh: refresh) { Task { await setOne(false) } }
                }
            } else if total > 0 {
                Card(title: L("Tasks today"), systemImage: "checklist") {
                    if open.count > 1 { oneToggle }
                    HStack(spacing: Theme.Space.s3) {
                        TaskRing(done: doneToday, total: total)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(open.isEmpty ? L("All done for today.") : FocusFlags.gentle ? L("One thing at a time is enough.") : LF("%d of %d done today", doneToday, total))
                                .font(.subheadline.weight(.semibold))
                            Text(open.isEmpty ? L("Nothing else is due.") : L("Tick off what’s done – the next date sets itself."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    if open.count >= 3 && !tipGone {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(L("A lot at once?")).font(.subheadline.weight(.semibold))
                                + Text(" ") + Text(L("With “Just one” you only see the next task – the rest waits.")).font(.subheadline)
                            HStack(spacing: Theme.Space.s2) {
                                Button(L("Try it")) { Task { await setOne(true) } }
                                    .buttonStyle(.bordered).tint(Theme.primary).frame(minHeight: 44)
                                Button(L("Not now")) { tipGone = true }
                                    .buttonStyle(.borderless).frame(minHeight: 44)
                            }
                        }
                        .padding(Theme.Space.s3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                    }
                    ForEach(open.prefix(max)) { t in
                        HStack(spacing: Theme.Space.s3) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    if t.isPrivate { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(Theme.ink3).accessibilityLabel(L("Only for me")) }
                                    Text(t.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                                }
                                Text([t.state == "overdue" ? (FocusFlags.gentle ? L("could be done") : L("overdue")) : t.dueTime.map { LF("today %@", TaskTime.label($0)) } ?? L("due today"), t.place, t.doer?.name].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(t.state == "overdue" && !FocusFlags.gentle ? Theme.empty : Theme.ink3)
                            }
                            // an appointment of today that is over: still there to tick off, but quieter
                            .opacity(TaskTime.isPast(t) ? 0.55 : 1)
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
                    if open.count > max {
                        if FocusFlags.gentle {
                            NavigationLink { FocusView(api: api) } label: { Label(L("One thing at a time"), systemImage: "scope").font(.caption) }
                        } else {
                            Text(LF("%d more", open.count - max)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            }
        }
        .task(id: refresh) { await load() }
        .toast($toast)
    }

    /// "Nur eins" on and off – a small chip at the top of the card
    private var oneToggle: some View {
        HStack {
            Spacer()
            Button { Task { await setOne(!oneThing) } } label: {
                Label(L("Just one"), systemImage: oneThing ? "checkmark.circle.fill" : "circle")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(Capsule().fill(oneThing ? Theme.primary.opacity(0.15) : Theme.line.opacity(0.5)))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityHint(L("Show only the next task"))
            .accessibilityAddTraits(oneThing ? .isSelected : [])
        }
    }

    private func setOne(_ on: Bool) async {
        do {
            let p = try await api.setFocusPrefs(["oneThing": on])
            FocusFlags.apply(p)
            oneThing = p.oneThing ?? false
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func load() async {
        if let p = try? await api.focusPrefs() {
            FocusFlags.apply(p)
            oneThing = p.oneThing ?? false
        }
        if let d = try? await api.care() { tasks = d.tasks }
    }

    private func done(_ t: CareTask) async {
        do {
            let r = try await api.careDone(t.id)
            toast = ToastMessage(text: r.task.nextDue.map { LF("Done. Next time: %@", CareLabels.day($0)) } ?? L("Done."), actionTitle: L("Undo"), action: {
                Task {
                    try? await api.careUndo(t.id, logId: r.logId)
                    await load()
                }
            })
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// Heute › Demnächst (web: pages/TasksToday.tsx TasksAheadCard): a calm look at tomorrow (Friday and Saturday: the
/// next two days) and at the bins by the evening they go out – "heute Abend rausstellen" from 17:00 comes first.
/// The server picks (lib/task-outlook.ts, GET /api/care › ahead); gentle mode shows fewer and never presses.
struct TasksAheadCard: View {
    let api: APIClient
    let refresh: Int
    @State private var data: CareData?
    @State private var toast: ToastMessage?

    private struct Row: Identifiable {
        let a: CareAhead
        let t: CareTask
        var id: Int { a.id }
    }
    private var rows: [Row] {
        guard let data else { return [] }
        let byId = Dictionary(data.tasks.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return data.ahead.compactMap { a in byId[a.id].map { Row(a: a, t: $0) } }
    }
    private var max: Int { FocusFlags.gentle ? min(2, FocusFlags.todayMax ?? 2) : 3 }

    var body: some View {
        // a LoadSlot, not a Group: .task on an empty Group never runs, so the card would never load (Design/LoadSlot.swift)
        LoadSlot {
            let rows = rows
            if !rows.isEmpty {
                Card(title: L("Coming up"), systemImage: "calendar") {
                    Text(L("So nothing catches you off guard.")).font(.caption).foregroundStyle(Theme.ink3)
                    ForEach(Array(rows.prefix(max))) { r in row(r.a, r.t) }
                    if rows.count > max && !FocusFlags.gentle {
                        Text(LF("%d more", rows.count - max)).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
        .task(id: refresh) { await load() }
        .toast($toast)
    }

    private func row(_ a: CareAhead, _ t: CareTask) -> some View {
        HStack(spacing: Theme.Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    if t.isPrivate { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(Theme.ink3).accessibilityLabel(L("Only for me")) }
                    Text(t.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                }
                Text([Self.label(a, dueTime: t.dueTime), t.place, t.doer?.name].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(a.now == true ? Theme.primary : Theme.ink3)
            }
            Spacer(minLength: 0)
            if a.when == "tonight" {
                Button { Task { await done(t) } } label: {
                    Label(L("Done"), systemImage: "checkmark").font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(Theme.primary)
                .frame(minHeight: 44)
                .accessibilityLabel(LF("Done: %@", t.name))
            }
        }
    }

    private static func weekday(_ s: String?) -> String {
        ServerDate.parse(s)?.formatted(.dateTime.weekday(.wide)) ?? "—"
    }

    /// "heute Abend rausstellen · Abfuhr Montag", "morgen fällig", "am Dienstag"
    static func label(_ a: CareAhead, dueTime: String?) -> String {
        if a.evening == true {
            let when = a.when == "tonight" ? L("tonight: put out") : a.when == "tomorrow" ? L("tomorrow evening: put out") : LF("%@ evening: put out", weekday(a.day))
            return a.pickup.map { "\(when) · \(LF("collection %@", weekday($0)))" } ?? when
        }
        if a.when == "tomorrow" { return dueTime.map { LF("tomorrow %@", TaskTime.label($0)) } ?? L("due tomorrow") }
        return LF("on %@", weekday(a.day))
    }

    private func load() async {
        if let p = try? await api.focusPrefs() { FocusFlags.apply(p) }
        if let d = try? await api.care() { data = d }
    }

    private func done(_ t: CareTask) async {
        do {
            let r = try await api.careDone(t.id)
            toast = ToastMessage(text: r.task.nextDue.map { LF("Done. Next time: %@", CareLabels.day($0)) } ?? L("Done."), actionTitle: L("Undo"), action: {
                Task {
                    try? await api.careUndo(t.id, logId: r.logId)
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
