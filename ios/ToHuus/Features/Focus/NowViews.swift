#if canImport(ActivityKit)
import ActivityKit
#endif
import Combine
import SwiftUI
import UserNotifications

// "Jetzt" – eine Sache nach der anderen (20 Oct 2026, docs/now.md; server lib/next-task.ts; web focus/Now.tsx).
// The server decides the order. One big card: picture, title, who, a big "Fertig", an optional timer ("Los" counts
// down the task's minutes, ends softly – no alarm sound) and how many come after it, never a list.
// While the timer runs, a Live Activity shows the title and the countdown on the lock screen and in the Dynamic Island.

/// one task of GET /api/tasks/next (and of the kid tablet's /api/kid/:token/tasks)
struct NowTask: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var emoji: String?
    var dueTime: String?
    /// overdue | today | promised | mine | open
    var level: String?
    var effortMin: Int?
    var doer: CareTask.Doer?
    var checklist: [CareTask.CheckItem]?
    var place: String?
}

/// GET /api/tasks/next → { next, after, queue, timer_min } – the kid tablet adds `view` (now | list) and, after
/// "done", `log_id` for the undo
struct NowQueue: Decodable, Sendable {
    var view: String?
    var next: NowTask?
    var after: Int?
    @Lossy var queue: [NowTask]
    var timerMin: Int?
    var logId: Int?
}

extension APIClient {
    func nextTasks() async throws -> NowQueue { try await get("api/tasks/next") }
    func kidTasks(token: String) async throws -> NowQueue { try await get("api/kid/\(token)/tasks") }
    func kidTaskDone(token: String, id: Int) async throws -> NowQueue { try await send("POST", "api/kid/\(token)/tasks/\(id)/done", json: [:], as: NowQueue.self) }
    func kidTaskUndo(token: String, id: Int, logId: Int) async throws -> NowQueue {
        try await send("POST", "api/kid/\(token)/tasks/\(id)/undo", json: ["log_id": logId], as: NowQueue.self)
    }
}

extension TaskTime {
    /// over already: an appointment of today whose time plus its length has passed – lists show it dimmed
    static func isPast(_ task: CareTask, now: Date = Date()) -> Bool {
        guard let start = start(task) else { return false }
        return start.addingTimeInterval(TimeInterval((task.durationMin ?? 60) * 60)) <= now
    }
}

// MARK: - Live Activity

/// Starts and ends the "Jetzt" Live Activity. Only while a timer runs; nothing happens when Live Activities are off.
@MainActor
enum TaskTimerLive {
    static func start(taskId: Int, title: String, emoji: String, endsAt: Date) {
        #if canImport(ActivityKit)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attrs = TaskTimerAttributes(taskId: taskId, title: title, emoji: emoji, startedAt: Date())
        do {
            let keep = try Activity.request(attributes: attrs, content: ActivityContent(state: .init(endsAt: endsAt), staleDate: endsAt), pushType: nil).id
            // one timer at a time: an older one (another task) ends
            Task { await endAll(except: keep) }
        } catch {
            Task { await ErrorLog.shared.record(kind: "app", message: "Live Activity (timer): \(error.localizedDescription)") }
        }
        #endif
    }

    static func end() {
        #if canImport(ActivityKit)
        Task { await endAll() }
        #endif
    }

    /// timers that ran out while the app was in the background
    static func endExpired() {
        #if canImport(ActivityKit)
        Task { await endAll(onlyExpired: true) }
        #endif
    }

    #if canImport(ActivityKit)
    nonisolated private static func endAll(onlyExpired: Bool = false, except: String? = nil) async {
        for a in Activity<TaskTimerAttributes>.activities where a.id != except && (!onlyExpired || a.content.state.endsAt <= Date()) {
            await a.end(nil, dismissalPolicy: .immediate)
        }
    }
    #endif
}

// MARK: - timer

/// "Los – 10 Min." starts a countdown with the task's minutes. The end is soft: a light haptic, a kind line and – in
/// the background – a quiet notification without sound. Stopping or "Fertig" ends it (and the Live Activity).
struct NowTimerView: View {
    let minutes: Int
    let taskId: Int
    let title: String
    var emoji: String = "✨"
    var big = false
    @State private var ends: Date?
    @State private var started = Date()
    @State private var over = false
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private let noteId = "now-timer"

    var body: some View {
        VStack(spacing: 8) {
            if let ends {
                ProgressView(timerInterval: started...max(started.addingTimeInterval(1), ends), countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    Text(timerInterval: Date()...max(Date(), ends), countsDown: true)
                        .font((big ? Font.title2 : .headline).monospacedDigit())
                }
                .tint(Theme.primary)
                .frame(maxWidth: 320)
                .accessibilityLabel(LF("Timer for %@", title))
                Button { stop() } label: { Label(L("Stop timer"), systemImage: "stop.fill") }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(maxWidth: 260)
            } else {
                Button { start() } label: { Label(LF("Go – %d min", minutes), systemImage: "play.fill") }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(maxWidth: 260)
                    .accessibilityLabel(LF("Start a %d minute timer", minutes))
                if over {
                    Text(L("Time’s up. Nice going – finish or stop, both are fine."))
                        .font(.subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                }
            }
        }
        .onReceive(tick) { _ in
            guard let e = ends, e <= Date() else { return }
            finish()
        }
        .onDisappear { if ends != nil { stop() } }
    }

    private func start() {
        let end = Date().addingTimeInterval(TimeInterval(minutes * 60))
        started = Date()
        ends = end
        over = false
        TaskTimerLive.start(taskId: taskId, title: title, emoji: emoji, endsAt: end)
        // in the background: a quiet note, no sound, no alarm
        let content = UNMutableNotificationContent()
        content.title = L("Time’s up")
        content.body = title
        content.sound = nil
        content.interruptionLevel = .passive
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert]) { _, _ in }
        center.add(UNNotificationRequest(identifier: noteId, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(minutes * 60), repeats: false))) { _ in }
    }

    private func stop() {
        ends = nil
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [noteId])
        TaskTimerLive.end()
    }

    private func finish() {
        stop()
        over = true
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        UIAccessibility.post(notification: .announcement, argument: L("Time’s up"))
    }
}

// MARK: - the card

/// One big card (Heute › "Nur eins" and the kid tablet).
struct NowCardView<Extra: View, Footer: View>: View {
    let task: NowTask
    var busy = false
    var timerMin: Int?
    var big = false
    var showLevel = true
    var tint: Color = Theme.primary
    let onDone: () -> Void
    @ViewBuilder var extra: () -> Extra
    @ViewBuilder var footer: () -> Footer
    @ScaledMetric(relativeTo: .largeTitle) private var emojiSize: CGFloat = 52

    private var meta: String {
        [showLevel ? Self.levelText(task) : nil, task.place, task.doer?.name].compactMap { $0 }.joined(separator: " · ")
    }

    static func levelText(_ t: NowTask) -> String {
        switch t.level {
        case "overdue": return L("could be done")
        case "today": return t.dueTime.map { LF("today %@", TaskTime.label($0)) } ?? L("today")
        case "promised": return L("you said you’d do it")
        default: return L("coming up")
        }
    }

    var body: some View {
        VStack(spacing: big ? Theme.Space.s4 : Theme.Space.s3) {
            Text(task.emoji ?? "✨").font(.system(size: big ? emojiSize * 1.7 : emojiSize)).accessibilityHidden(true)
            Text(task.name)
                .font(big ? .system(.largeTitle, design: .rounded, weight: .heavy) : .title2.weight(.bold))
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
            if !meta.isEmpty { Text(meta).font(big ? .title3 : .subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center) }
            if let step = task.checklist?.first(where: { !$0.done }) {
                Text(LF("Next step: %@", step.text)).font(.subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
            }
            Button(action: onDone) {
                Label(L("Done"), systemImage: "checkmark")
                    .font(big ? .title.weight(.bold) : .title3.weight(.bold))
                    .frame(maxWidth: big ? 420 : 320, minHeight: big ? 88 : 56)
                    .foregroundStyle(Theme.onPrimary)
                    .background(Theme.primary, in: RoundedRectangle(cornerRadius: big ? 28 : 18))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityLabel(LF("Done: %@", task.name))
            extra()
            if let m = timerMin { NowTimerView(minutes: m, taskId: task.id, title: task.name, emoji: task.emoji ?? "✨", big: big).id(task.id) }
            footer()
        }
        .padding(big ? Theme.Space.s6 : Theme.Space.s4)
        .frame(maxWidth: .infinity)
        .background(big ? Theme.surface : Theme.surface2, in: RoundedRectangle(cornerRadius: big ? 34 : 22))
    }
}

// MARK: - Heute › "Nur eins"

/// Heute with "Nur eins": the next task as one card; "Später" moves it to the end for this visit only (nothing is
/// stored); "+4 weitere" leaves the mode. Shopping and the other cards on Heute stay as they are.
struct OneThingTodayView: View {
    let api: APIClient
    let refresh: Int
    var onLeave: () -> Void
    @State private var data: NowQueue?
    @State private var busy = false
    @State private var cheer = false
    @State private var toast: ToastMessage?
    /// "Später" – for this app session only
    @MainActor static var later: [Int] = []
    @State private var bump = 0

    private var list: [NowTask] {
        let q = data?.queue ?? []
        _ = bump
        return q.filter { !Self.later.contains($0.id) } + Self.later.compactMap { id in q.first { $0.id == id } }
    }

    var body: some View {
        VStack(spacing: Theme.Space.s3) {
            if cheer {
                Text(L("Nicely done.")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primary).transition(.opacity)
            }
            if let t = list.first {
                NowCardView(task: t, busy: busy, timerMin: t.effortMin ?? data?.timerMin ?? FocusFlags.timerMin, onDone: { Task { await done(t) } }) {
                    if list.count > 1 {
                        Button {
                            Self.later.removeAll { $0 == t.id }
                            Self.later.append(t.id)
                            bump += 1
                        } label: { Label(L("Later"), systemImage: "arrow.uturn.down") }
                            .buttonStyle(.borderless)
                            .frame(minHeight: 44)
                            .disabled(busy)
                    }
                } footer: {
                    if list.count > 1 {
                        Button { onLeave() } label: { Text(LF("+%d more", list.count - 1)).font(.subheadline) }
                            .buttonStyle(.borderless)
                            .frame(minHeight: 44)
                            .accessibilityLabel(LF("Show all %d tasks again", list.count))
                    }
                }
            } else if data != nil {
                VStack(spacing: 4) {
                    Text("🌿").font(.largeTitle).accessibilityHidden(true)
                    Text(L("Nothing waiting right now.")).font(.subheadline.weight(.semibold))
                    Text(L("Enjoy the quiet.")).font(.caption).foregroundStyle(Theme.ink3)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Theme.Space.s3)
                .accessibilityElement(children: .combine)
            }
        }
        .task(id: refresh) { await load() }
        .toast($toast)
    }

    private func load() async {
        TaskTimerLive.endExpired()
        if let d = try? await api.nextTasks() { data = d }
    }

    private func done(_ t: NowTask) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.careDone(t.id)
            TaskTimerLive.end()
            Self.later.removeAll { $0 == t.id }
            Haptics.success()
            withAnimation { cheer = true }
            UIAccessibility.post(notification: .announcement, argument: L("Nicely done."))
            toast = ToastMessage(text: r.task.nextDue.map { LF("Done. Next time: %@", CareLabels.day($0)) } ?? L("Done."), actionTitle: L("Undo"), action: {
                Task {
                    try? await api.careUndo(t.id, logId: r.logId)
                    await load()
                }
            }, seconds: 10)
            await load()
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            withAnimation { cheer = false }
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

// MARK: - kid tablet

/// The kid tablet's "Zu tun": one big card with a big "Fertig", then a short "Super!" and the next one; undo for
/// 10 seconds; a calm "Alles geschafft" at the end. Parents can switch it to a list (Kinder-Einstellungen).
struct KidNowPanel: View {
    let api: APIClient
    let token: String
    let initial: NowQueue
    let reads: Bool
    let say: (String) -> Void
    @State private var local: NowQueue?
    @State private var busy = false
    @State private var cheer = false
    @State private var undo: (id: Int, logId: Int)?

    private var q: NowQueue { local ?? initial }

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Space.s4) {
                if cheer {
                    calm("🌟", L("Great, done!"), nil)
                } else if let next = q.next {
                    if q.view == "list" {
                        ForEach(q.queue) { t in listRow(t) }
                    } else {
                        NowCardView(task: next, busy: busy, timerMin: next.effortMin, big: true, showLevel: false, onDone: { Task { await done(next) } }) {
                            EmptyView()
                        } footer: {
                            if let n = q.after, n > 0 {
                                Button { say(LF("%d more after this", n)) } label: {
                                    Text(reads ? LF("%d more after this", n) : String(repeating: "•", count: min(n, 5)))
                                        .font(.title3).foregroundStyle(Theme.ink2)
                                }
                                .buttonStyle(.plain)
                                .frame(minHeight: 44)
                                .accessibilityLabel(LF("%d more after this", n))
                            }
                        }
                    }
                } else {
                    calm("🌿", L("All done for now."), L("Time to play."))
                }
                if undo != nil {
                    Button(L("Undo")) { Task { await takeBack() } }
                        .buttonStyle(SecondaryButtonStyle())
                        .frame(maxWidth: 240)
                }
            }
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
            .padding(.bottom, Theme.Space.s6)
        }
        .onChange(of: initial.queue.map(\.id)) { _, _ in local = nil }
    }

    private func calm(_ emoji: String, _ title: String, _ text: String?) -> some View {
        VStack(spacing: Theme.Space.s3) {
            Text(emoji).font(.system(size: 88)).accessibilityHidden(true)
            Text(title).font(.system(size: 34, weight: .heavy, design: .rounded)).multilineTextAlignment(.center)
            if let text { Text(text).font(.title3).foregroundStyle(Theme.ink2) }
        }
        .padding(.vertical, Theme.Space.s8)
        .accessibilityElement(children: .combine)
    }

    private func listRow(_ t: NowTask) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Text(t.emoji ?? "✨").font(.system(size: 40)).accessibilityHidden(true)
            Text(t.name).font(.title3.weight(.bold)).foregroundStyle(Theme.ink)
                .onTapGesture { say(t.name) }
            Spacer(minLength: 0)
            Button { Task { await done(t) } } label: {
                Image(systemName: "checkmark").font(.title.weight(.bold))
                    .foregroundStyle(Theme.onPrimary)
                    .frame(width: 72, height: 72)
                    .background(Theme.primary, in: RoundedRectangle(cornerRadius: 22))
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityLabel(LF("Done: %@", t.name))
        }
        .padding(Theme.Space.s4)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 26))
    }

    private func done(_ t: NowTask) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.kidTaskDone(token: token, id: t.id)
            TaskTimerLive.end()
            local = r
            Haptics.success()
            say(L("Great, done!"))
            withAnimation { cheer = true }
            if let id = r.logId { undo = (t.id, id) }
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            withAnimation { cheer = false }
            try? await Task.sleep(nanoseconds: 8_200_000_000)
            if undo?.logId == r.logId { withAnimation { undo = nil } }
        } catch {
            say(L("That didn’t work – try again"))
        }
    }

    private func takeBack() async {
        guard let u = undo else { return }
        undo = nil
        if let r = try? await api.kidTaskUndo(token: token, id: u.id, logId: u.logId) { local = r }
    }
}
