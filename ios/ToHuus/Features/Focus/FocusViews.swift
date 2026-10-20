import Combine
import SwiftUI
import UserNotifications

// Für Köpfe, in denen viel los ist (server: lib/focus.ts, docs/focus.md, web: focus/Focus.tsx).
// Sanfter Modus (personal), Eins nach dem anderen with a visible timer, kleine Schritte, Neu anfangen.
// No tracking, no streaks, no statistics.

/// GET/PUT /api/focus/prefs – personal, nobody else sees it
struct FocusPrefs: Codable, Sendable, Equatable {
    var gentle: Bool
    var todayMax: Int?
    var bundleHour: Int?
    var timerMin: Int
    /// "Nur eins" on Heute (docs/now.md) – optional, older servers don't send it
    var oneThing: Bool?
    /// the money card on Heute (Paket B) – off unless switched on; older servers don't send it
    var todayMoney: Bool?

    static let standard = FocusPrefs(gentle: false, todayMax: nil, bundleHour: nil, timerMin: 5, oneThing: false)
}

struct StepSuggestion: Decodable, Sendable {
    var steps: [String]
    var source: String?
}

struct FreshStartResult: Decodable, Sendable {
    var moved: Int
    var until: String?
}

extension APIClient {
    func focusPrefs() async throws -> FocusPrefs { try await get("api/focus/prefs") }
    func setFocusPrefs(_ body: [String: Any]) async throws -> FocusPrefs { try await send("PUT", "api/focus/prefs", json: body, as: FocusPrefs.self) }
    func suggestSteps(taskId: Int) async throws -> StepSuggestion { try await send("POST", "api/care/\(taskId)/steps/suggest", json: [:], as: StepSuggestion.self) }
    func suggestSteps(name: String, note: String?) async throws -> StepSuggestion {
        try await send("POST", "api/focus/steps", json: ["name": name, "note": note.map { $0 as Any } ?? NSNull()], as: StepSuggestion.self)
    }
    func freshStart(perDay: Int = 2) async throws -> FreshStartResult { try await send("POST", "api/care/fresh-start", json: ["per_day": perDay], as: FreshStartResult.self) }
}

/// The signed-in person's gentle mode, read by labels (CareLabels.due) – set when the prefs load.
enum FocusFlags {
    nonisolated(unsafe) static var gentle = false
    nonisolated(unsafe) static var todayMax: Int?
    nonisolated(unsafe) static var timerMin = 5
    nonisolated(unsafe) static var oneThing = false

    static func apply(_ p: FocusPrefs) {
        gentle = p.gentle
        todayMax = p.todayMax
        timerMin = p.timerMin
        oneThing = p.oneThing ?? false
    }
}

/// adds proposed steps a task doesn't have yet
func mergeSteps(_ have: [CareTask.CheckItem], _ steps: [String]) -> [CareTask.CheckItem] {
    have + steps.filter { s in !have.contains { $0.text.lowercased() == s.lowercased() } }.map { CareTask.CheckItem(text: $0, done: false) }
}

// MARK: - timer

/// A visible countdown ring: "just start" with a few minutes. A gentle signal at the end (local notification when
/// the app is in the background). No tracking.
struct FocusTimerView: View {
    let minutes: Int
    var label: String = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var total = 300
    @State private var left = 300
    @State private var ends: Date?
    @State private var rang = false
    @ScaledMetric(relativeTo: .largeTitle) private var ring: CGFloat = 150
    private let tick = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()
    private let noteId = "focus-timer"

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().stroke(Theme.line, lineWidth: 10)
                Circle()
                    .trim(from: 0, to: total > 0 ? CGFloat(left) / CGFloat(total) : 0)
                    .stroke(Theme.primary, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(reduceMotion ? nil : .linear(duration: 0.5), value: left)
                Text(String(format: "%d:%02d", left / 60, left % 60))
                    .font(.system(.largeTitle, design: .rounded, weight: .semibold))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
            }
            .frame(width: ring, height: ring)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(LF("%d minutes %d seconds left", left / 60, left % 60))
            HStack(spacing: 8) {
                if ends != nil {
                    Button { pause() } label: { Label(L("Pause"), systemImage: "pause.fill") }
                        .buttonStyle(SecondaryButtonStyle())
                } else {
                    Button { start() } label: { Label(left == total ? L("Just start") : L("Go on"), systemImage: "play.fill") }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(left == 0)
                }
            }
            HStack(spacing: 8) {
                ForEach([5, 10, 15, 25], id: \.self) { m in
                    Button { set(m) } label: {
                        Text(LF("%d min", m))
                            .font(.subheadline.weight(total == m * 60 ? .semibold : .regular))
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .background(Capsule().fill(total == m * 60 ? Theme.primary.opacity(0.15) : Theme.line.opacity(0.5)))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                        .accessibilityAddTraits(total == m * 60 ? .isSelected : [])
                }
            }
            if rang {
                Text(L("Time’s up. Well done for starting – stop or go on, both are fine."))
                    .font(.subheadline).multilineTextAlignment(.center).foregroundStyle(Theme.ink2)
            }
        }
        .onAppear { set(minutes) }
        .onReceive(tick) { _ in
            guard let ends else { return }
            left = max(0, Int(ends.timeIntervalSinceNow.rounded()))
            if left == 0 { finish() }
        }
        .onDisappear { if ends != nil { pause() } }
    }

    private func set(_ m: Int) {
        pause()
        total = m * 60
        left = m * 60
        rang = false
    }

    private func start() {
        let end = Date().addingTimeInterval(TimeInterval(left))
        ends = end
        rang = false
        let content = UNMutableNotificationContent()
        content.title = L("Time’s up")
        content.body = label.isEmpty ? L("Well done for starting.") : label
        content.sound = .default
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        center.add(UNNotificationRequest(identifier: noteId, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, TimeInterval(left)), repeats: false))) { _ in }
    }

    private func pause() {
        ends = nil
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [noteId])
    }

    private func finish() {
        ends = nil
        rang = true
        Haptics.success()
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [noteId])
        UIAccessibility.post(notification: .announcement, argument: L("Time’s up"))
    }
}

// MARK: - Eins nach dem anderen

/// One task at a time in the server's "Jetzt" order (GET /api/tasks/next, docs/now.md – no sorting here), on the same
/// card as Heute › "Nur eins": its next small step big, "Später" (this app session only, shared with "Nur eins"),
/// "Zu groß? Kleiner machen" and the timer, which starts with the task's own minutes (effort_min) or the default.
/// (web: FocusPage, /fokus)
struct FocusView: View {
    let api: APIClient
    var taskId: Int?
    @State private var data: NowQueue?
    /// the task opened with "Focus on this" when it isn't in the queue (e.g. weeks ahead)
    @State private var single: NowTask?
    @State private var prefs: FocusPrefs?
    @State private var busy = false
    @State private var toast: ToastMessage?
    @State private var error: String?
    /// "Später" (NowLater) changed – redraw
    @State private var bump = 0
    /// the pinned task is let go once it's done or put off (a recurring one comes back with a new date)
    @State private var unpinned = false

    private var list: [NowTask] {
        _ = bump
        return NowLater.ordered(data?.queue ?? [])
    }

    private var current: NowTask? {
        if let taskId, !unpinned {
            if let t = list.first(where: { $0.id == taskId }) { return t }
            if let single { return single }
        }
        return list.first
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if data == nil && error == nil {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if let t = current {
                    NowCardView(task: t, busy: busy, timerMin: nil, numbered: true, doneLabel: L("Done it"), onDone: { Task { await doneStep(t) } }) {
                        AdaptiveButtonRow { _ in
                            if list.contains(where: { $0.id != t.id }) {
                                Button(L("Later")) {
                                    NowLater.add(t.id)
                                    if t.id == taskId { unpinned = true }
                                    bump += 1
                                }
                                .buttonStyle(SecondaryButtonStyle())
                            }
                            Button { Task { await smaller(t) } } label: { Label(L("Too big? Make it smaller"), systemImage: "sparkles") }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                        .disabled(busy)
                    } footer: {
                        FocusTimerView(minutes: t.effortMin ?? data?.timerMin ?? prefs?.timerMin ?? FocusFlags.timerMin, label: t.name)
                            .id(t.id)
                            .frame(maxWidth: .infinity)
                        if let next = list.first(where: { $0.id != t.id }) {
                            Text(LF("After this: %@", next.name)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                } else {
                    EmptyStateView(systemImage: "checkmark.circle", title: L("Nothing is waiting for you."), message: L("Enjoy the quiet."))
                }
            }
            .padding()
        }
        .canvasBackground()
        .navigationTitle(L("Just one"))
        .assistantScreen("tasks")
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
    }

    private func load() async {
        do {
            let q = try await api.nextTasks()
            data = q
            if let taskId, !unpinned, !q.queue.contains(where: { $0.id == taskId }) {
                let c = try? await api.careTask(taskId)
                single = c.map { NowTask(id: $0.id, name: $0.name, emoji: nil, note: $0.note, dueTime: $0.dueTime, level: "mine", effortMin: $0.effortMin, doer: $0.doer, checklist: $0.checklist, place: $0.place) }
            } else { single = nil }
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
        if prefs == nil, let p = try? await api.focusPrefs() { prefs = p; FocusFlags.apply(p) }
    }

    private func doneStep(_ t: NowTask) async {
        busy = true
        defer { busy = false }
        do {
            var items = t.checklist ?? []
            var last = true
            if let i = items.firstIndex(where: { !$0.done }) {
                items[i].done = true
                try await api.saveCareTask(id: t.id, ["checklist": items.map { ["text": $0.text, "done": $0.done] as [String: Any] }])
                last = items.allSatisfy(\.done)
                if last { _ = try await api.careDone(t.id) }
            } else {
                _ = try await api.careDone(t.id)
            }
            if last {
                NowLater.forget(t.id)
                if t.id == taskId { unpinned = true }
            }
            toast = ToastMessage(text: last ? L("Done. Good.") : L("One step done."))
            Haptics.success()
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func smaller(_ t: NowTask) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.suggestSteps(taskId: t.id)
            let items = mergeSteps(t.checklist ?? [], r.steps)
            try await api.saveCareTask(id: t.id, ["checklist": items.map { ["text": $0.text, "done": $0.done] as [String: Any] }])
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

// MARK: - Neu anfangen

/// "Neu anfangen" with a short explanation first (web: FreshStartButton).
struct FreshStartButton: View {
    let api: APIClient
    let overdue: Int
    var onDone: (String) -> Void
    @State private var ask = false

    var body: some View {
        if overdue > 0 {
            Button { ask = true } label: { Label(L("Fresh start"), systemImage: "sunrise") }
                .confirmationDialog(L("Fresh start"), isPresented: $ask, titleVisibility: .visible) {
                    Button(L("Start fresh")) { Task { await go() } }
                    Button(L("Cancel"), role: .cancel) {}
                } message: {
                    Text(L("Everything that piled up moves to a fresh start: two things a day from today. Nothing is marked as done, nothing is counted.")
                         + "\n" + L("Only what you keep in mind, what you do, your own tasks and what nobody took on."))
                }
        }
    }

    private func go() async {
        do {
            let r = try await api.freshStart()
            onDone(r.moved > 0 ? LF("Fresh start: %d things spread over the next days.", r.moved) : L("Nothing to move – the rest is someone else’s."))
        } catch { onDone(APIError.from(error).localizedDescription) }
    }
}

// MARK: - settings

/// Mehr › Mein Konto: Ruhe & Fokus (web: FocusSettingsCard). Only this person sees it.
struct FocusSettingsSection: View {
    let api: APIClient
    @State private var p: FocusPrefs?
    @State private var error: String?

    var body: some View {
        Section {
            if let p {
                Toggle(isOn: Binding(get: { p.gentle }, set: { v in Task { await save(["gentle": v]) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Gentle mode"))
                        Text(L("No red, no counters. Things that are due say “could be done”.")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .tint(Theme.primary)
                Toggle(isOn: Binding(get: { p.todayMoney ?? false }, set: { v in Task { await save(["todayMoney": v]) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Money on Today"))
                        Text(L("This week and this month as a small card on Today. Off unless you switch it on.")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .tint(Theme.primary)
                Picker(L("On Today, at most"), selection: Binding(get: { p.todayMax ?? 0 }, set: { v in Task { await save(["todayMax": v == 0 ? NSNull() as Any : v as Any]) } })) {
                    Text("1").tag(1)
                    Text("3").tag(3)
                    Text("5").tag(5)
                    Text(L("No limit")).tag(0)
                }
                Picker(L("Task reminders"), selection: Binding(get: { p.bundleHour ?? -1 }, set: { v in Task { await save(["bundleHour": v < 0 ? NSNull() as Any : v as Any]) } })) {
                    Text(L("One by one, as usual")).tag(-1)
                    ForEach([7, 8, 9, 10, 12, 15, 17, 18, 19, 20], id: \.self) { h in Text(LF("Once a day at %d:00", h)).tag(h) }
                }
                Toggle(isOn: Binding(get: { p.oneThing ?? false }, set: { v in Task { await save(["oneThing": v]) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Just one"))
                        Text(L("Today shows only the next task – then the next one.")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .tint(Theme.primary)
                Picker(L("Timer starts with"), selection: Binding(get: { p.timerMin }, set: { v in Task { await save(["timerMin": v]) } })) {
                    ForEach([5, 10, 15, 25], id: \.self) { m in Text(LF("%d min", m)).tag(m) }
                }
            } else if error == nil {
                ProgressView()
            }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.empty) }
        } header: {
            Text(L("Calm & focus"))
        } footer: {
            Text(L("For heads with a lot going on – ADHD, autism or just a full week. Only you see these settings."))
        }
        .task {
            do {
                let x = try await api.focusPrefs()
                p = x
                FocusFlags.apply(x)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func save(_ body: [String: Any]) async {
        do {
            let x = try await api.setFocusPrefs(body)
            p = x
            FocusFlags.apply(x)
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
