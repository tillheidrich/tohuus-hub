import AudioToolbox
import Observation
import SwiftUI
import UIKit
import UserNotifications

/// Cook mode (web: pages/CookMode.tsx), made for the phone on the counter: one step per page, swipe or tap to go on,
/// big adjustable type, the screen stays on, the house note ("So machen wir das") and the ingredients to tick first,
/// appliance settings as chips, and timers found in the step text ("10 Min.", "1 Std.") that keep running across
/// steps – and ring as a notification when the phone is locked.
struct CookModeView: View {
    let store: ServerStore
    let recipeId: Int
    /// servings factor from the recipe page (amounts in the ingredient list follow it)
    var factor: Double = 1
    /// "Gekocht!" at the end – nil: logs it directly (kitchen mode)
    var onCooked: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var recipe: RecipeFull?
    @State private var note: String?
    @State private var lines: [String] = []
    @State private var error: String?
    @State private var page = 0
    @State private var ticked: Set<Int> = []
    @State private var showIngredients = false
    @State private var timers = CookTimers()
    @State private var confirmClose = false
    @State private var loggedCooked = false
    /// kitchen mode may already keep the screen on – restored when cook mode closes
    @State private var wasAwake = false
    @AppStorage("cook.textSize") private var textSize = 1
    @AppStorage("kitchen.keepAwake") private var keepOn = true

    private var steps: [RecipeFull.Step] { recipe?.steps ?? [] }
    /// page 0 = "before you start" (note + ingredients), then one page per step
    private var pages: Int { steps.count + 1 }

    var body: some View {
        NavigationStack {
            Group {
                if let r = recipe {
                    content(r)
                } else if let error {
                    VStack { ErrorBanner(message: error) { Task { await load() } }; Spacer() }.padding()
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .canvasBackground()
            .navigationTitle(recipe?.title ?? L("Cook mode"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { if timers.running.isEmpty { dismiss() } else { confirmClose = true } } label: {
                        Image(systemName: "xmark").font(.body.weight(.semibold))
                    }
                    .accessibilityLabel(L("Close"))
                    .keyboardShortcut(.cancelAction)
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { showIngredients = true } label: { Image(systemName: "basket") }
                        .accessibilityLabel(L("Ingredients"))
                    Menu {
                        Picker(L("Text size"), selection: $textSize) {
                            Text(L("Normal")).tag(0)
                            Text(L("Large")).tag(1)
                            Text(L("Very large")).tag(2)
                        }
                        Toggle(isOn: $keepOn) { Label(L("Screen stays on"), systemImage: "sun.max") }
                    } label: { Image(systemName: "textformat.size") }
                    .accessibilityLabel(L("Text size and screen"))
                }
            }
            .confirmationDialog(L("A timer is still running. Close cook mode anyway?"), isPresented: $confirmClose, titleVisibility: .visible) {
                Button(L("Close and stop the timers"), role: .destructive) { timers.cancelAll(); dismiss() }
                Button(L("Keep cooking"), role: .cancel) {}
            }
            .sheet(isPresented: $showIngredients) { ingredientsSheet }
        }
        .task { await load() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                timers.check()
            }
        }
        .onAppear { wasAwake = UIApplication.shared.isIdleTimerDisabled; keepAwake(true) }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = wasAwake }
        .onChange(of: scenePhase) { _, p in keepAwake(p == .active) }
        .onChange(of: keepOn) { _, _ in keepAwake(scenePhase == .active) }
        .onChange(of: page) { _, p in
            if p > 0, p <= steps.count { A11yTiming.announce(LF("Step %d of %d", p, steps.count) + ". " + steps[p - 1].text) }
        }
    }

    private func keepAwake(_ on: Bool) { UIApplication.shared.isIdleTimerDisabled = (on && keepOn) || (on && wasAwake) }

    private var stepFont: Font {
        switch textSize {
        case 0: return .title3
        case 2: return .largeTitle
        default: return .title
        }
    }

    // MARK: content

    private func content(_ r: RecipeFull) -> some View {
        VStack(spacing: 0) {
            progress
            if !timers.items.isEmpty { timerBar.padding(.horizontal, Theme.Space.s4).padding(.top, 8) }
            TabView(selection: $page) {
                startPage(r).tag(0)
                ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                    stepPage(i, s).tag(i + 1)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(reduceMotion ? nil : .default, value: page)
            footer
        }
    }

    private var progress: some View {
        HStack(spacing: 3) {
            ForEach(0..<pages, id: \.self) { i in
                Capsule()
                    .fill(i <= page ? Theme.primary : Theme.line)
                    .frame(height: 4)
            }
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.top, 6)
        .accessibilityElement()
        .accessibilityLabel(page == 0 ? L("Before you start") : LF("Step %d of %d", page, steps.count))
    }

    private func startPage(_ r: RecipeFull) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Text(L("Before you start")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primaryText)
                Text(r.title).font(Theme.title(30)).foregroundStyle(Theme.ink)
                if let note, !note.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(L("How we make it"), systemImage: "note.text").font(.subheadline.weight(.bold))
                        Text(note).font(.title3)
                    }
                    .padding(Theme.Space.s3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                }
                if !lines.isEmpty {
                    Text(L("Get everything ready – tap what you have out.")).font(.subheadline).foregroundStyle(Theme.ink2)
                    ingredientChecklist(big: true)
                }
                if steps.isEmpty {
                    Text(L("This recipe has no steps.")).font(.title3).foregroundStyle(Theme.ink2)
                }
            }
            .padding(Theme.Space.s4)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    private func ingredientChecklist(big: Bool) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { i, l in
                let on = ticked.contains(i)
                Button {
                    if on { ticked.remove(i) } else { ticked.insert(i); Haptics.tick() }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s3) {
                        Image(systemName: on ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(on ? Theme.primary : Theme.ink3)
                        Text(l).font(big ? .title3 : .body)
                            .strikethrough(on, color: Theme.ink3)
                            .foregroundStyle(on ? Theme.ink3 : Theme.ink)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
                Divider()
            }
        }
    }

    private func stepPage(_ i: Int, _ s: RecipeFull.Step) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Text((s.section.map { "\($0) · " } ?? "") + LF("Step %d of %d", i + 1, steps.count))
                    .font(.headline).foregroundStyle(Theme.primaryText)
                Text(s.text)
                    .font(stepFont)
                    .foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                let chips = CookTimers.deviceChips(s.tm)
                if !chips.isEmpty {
                    FlowLayout {
                        ForEach(chips, id: \.self) { c in
                            Text(c).font(.headline)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(Theme.surface2, in: Capsule())
                                .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                        }
                    }
                }
                let found = CookTimers.durations(in: s.text, tm: s.tm)
                if !found.isEmpty {
                    FlowLayout {
                        ForEach(found, id: \.self) { secs in
                            Button {
                                timers.start(label: LF("Step %d", i + 1) + " · " + (recipe?.title ?? ""), seconds: secs)
                                Haptics.tick()
                            } label: {
                                Label(LF("Timer %@", CookTimers.format(secs)), systemImage: "timer")
                                    .font(.headline)
                                    .padding(.horizontal, 14).frame(minHeight: 48)
                                    .background(Theme.mustard.opacity(0.25), in: Capsule())
                                    .foregroundStyle(Theme.ink)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint(L("Starts a timer that keeps running when you go on."))
                        }
                    }
                }
            }
            .padding(Theme.Space.s4)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    private var timerBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(timers.items) { t in
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        let left = t.remaining(at: ctx.date)
                        Menu {
                            if !t.done {
                                Button { timers.toggle(t.id) } label: {
                                    Label(t.paused ? L("Continue") : L("Pause"), systemImage: t.paused ? "play" : "pause")
                                }
                                Button { timers.add(t.id, 60) } label: { Label(L("1 minute more"), systemImage: "plus") }
                            }
                            Button(role: .destructive) { timers.cancel(t.id) } label: { Label(t.done ? L("Remove") : L("Stop"), systemImage: "xmark") }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: t.done ? "bell.fill" : t.paused ? "pause.fill" : "timer")
                                Text(t.done ? L("Done!") : CookTimers.format(left)).monospacedDigit()
                            }
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 12).frame(minHeight: 40)
                            .foregroundStyle(t.done ? Theme.onPrimary : Theme.ink)
                            .background(t.done ? Theme.clay : Theme.surface, in: Capsule())
                            .overlay(Capsule().stroke(Theme.line, lineWidth: t.done ? 0 : 1))
                        }
                        .accessibilityLabel(t.done ? LF("Timer %@ is done", CookTimers.format(t.total)) : LF("Timer, %@ left", CookTimers.format(left)))
                    }
                }
            }
        }
    }

    private var footer: some View {
        HStack(spacing: Theme.Space.s3) {
            Button { go(page - 1) } label: {
                Label(L("Back"), systemImage: "chevron.left").frame(maxWidth: .infinity, minHeight: 34)
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(page == 0)
            .keyboardShortcut(.leftArrow, modifiers: [])
            if page < pages - 1 {
                Button { go(page + 1) } label: {
                    Label(page == 0 ? L("Let’s go") : L("Next"), systemImage: "chevron.right")
                        .labelStyle(TrailingIconLabel())
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(PrimaryButtonStyle())
                .keyboardShortcut(.rightArrow, modifiers: [])
            } else {
                Button { Task { await finish() } } label: {
                    Label(loggedCooked ? L("Logged") : L("Cooked it!"), systemImage: "checkmark").frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(loggedCooked)
            }
        }
        .font(.title3.weight(.semibold))
        .padding(Theme.Space.s4)
        .background(Theme.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Divider() }
    }

    private func go(_ p: Int) {
        let n = max(0, min(pages - 1, p))
        if reduceMotion { page = n } else { withAnimation { page = n } }
    }

    private var ingredientsSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s3) {
                    if factor != 1 { Text(L("Amounts follow the servings you chose.")).font(.caption).foregroundStyle(Theme.ink3) }
                    if lines.isEmpty { Text(L("No ingredients yet.")).foregroundStyle(Theme.ink3) }
                    ingredientChecklist(big: false)
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(L("Ingredients"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { showIngredients = false } } }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: load & finish

    private func load() async {
        do {
            async let r = store.api.recipeFull(recipeId)
            async let v = store.api.recipeVariant(recipeId)
            let rec = try await r
            let variant = try? await v
            recipe = rec
            note = variant?.variant?.note
            let base: [String]
            if let vl = variant?.ingredients, !vl.isEmpty {
                base = vl.filter { ($0.change ?? "none") != "remove" }.map(\.text)
            } else {
                base = rec.ingredients.map(\.text)
            }
            lines = factor == 1 ? base : base.map { AmountScale.scale($0, factor) }
            error = nil
            if steps.isEmpty == false, note == nil, lines.isEmpty { page = 1 }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func finish() async {
        if let onCooked {
            timers.cancelAll()
            dismiss()
            onCooked()
            return
        }
        do {
            try await store.api.cooked(recipeId)
            loggedCooked = true
            Haptics.success()
            store.touch("recipes", "stock")
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// "Weiter ›" – icon after the title
struct TrailingIconLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) { configuration.title; configuration.icon }
    }
}

// MARK: - timers

@MainActor
@Observable
final class CookTimers {
    struct Item: Identifiable, Equatable {
        let id = UUID()
        var label: String
        var total: TimeInterval
        var ends: Date
        var pausedLeft: TimeInterval?
        var done = false
        var paused: Bool { pausedLeft != nil }
        func remaining(at now: Date) -> TimeInterval {
            if done { return 0 }
            if let pausedLeft { return pausedLeft }
            return max(0, ends.timeIntervalSince(now))
        }
    }

    private(set) var items: [Item] = []
    var running: [Item] { items.filter { !$0.done } }

    func start(label: String, seconds: Int) {
        let item = Item(label: label, total: TimeInterval(seconds), ends: Date().addingTimeInterval(TimeInterval(seconds)))
        items.append(item)
        schedule(item)
    }

    func toggle(_ id: UUID) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        if let left = items[i].pausedLeft {
            items[i].ends = Date().addingTimeInterval(left)
            items[i].pausedLeft = nil
            schedule(items[i])
        } else {
            items[i].pausedLeft = items[i].remaining(at: Date())
            unschedule(id)
        }
    }

    func add(_ id: UUID, _ secs: TimeInterval) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        if let left = items[i].pausedLeft { items[i].pausedLeft = left + secs } else {
            items[i].ends = items[i].ends.addingTimeInterval(secs)
            schedule(items[i])
        }
        items[i].total += secs
    }

    func cancel(_ id: UUID) {
        items.removeAll { $0.id == id }
        unschedule(id)
    }

    func cancelAll() {
        for t in items { unschedule(t.id) }
        items = []
    }

    /// called twice a second while cook mode is open
    func check() {
        let now = Date()
        for i in items.indices where !items[i].done && !items[i].paused && items[i].ends <= now {
            items[i].done = true
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            AudioServicesPlaySystemSound(1005)
            A11yTiming.announce(LF("Timer %@ is done", Self.format(items[i].total)))
        }
    }

    private func schedule(_ t: Item) {
        let secs = max(1, t.ends.timeIntervalSinceNow)
        let content = UNMutableNotificationContent()
        content.title = L("Timer done")
        content.body = t.label
        content.sound = .default
        let req = UNNotificationRequest(identifier: "cook-timer-\(t.id.uuidString)", content: content,
                                        trigger: UNTimeIntervalNotificationTrigger(timeInterval: secs, repeats: false))
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        center.add(req) { _ in }
    }

    private func unschedule(_ id: UUID) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["cook-timer-\(id.uuidString)"])
    }

    nonisolated static func format(_ secs: TimeInterval) -> String {
        let s = Int(secs.rounded())
        if s >= 3600 { return String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) }
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    nonisolated(unsafe) private static let durationRe = try! NSRegularExpression(
        pattern: #"(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|bis|to|or|oder)\s*(\d+(?:[.,]\d+)?))?\s*(stunden|stunde|std\.?|hours?|hrs?|h|minuten|minute|min\.?|mins?|sekunden|sek\.?|seconds?|secs?|s)(?![\p{L}])"#,
        options: [.caseInsensitive])

    /// "10 Min.", "1–2 Std.", "30 Sek." in the step text and the appliance time → seconds (the longer end of a range).
    nonisolated static func durations(in text: String, tm: JSONValue?) -> [Int] {
        var out: [Int] = []
        let sources = [text, tm?["time"]?.string ?? ""]
        for src in sources where !src.isEmpty {
            let ns = src as NSString
            for m in durationRe.matches(in: src, range: NSRange(location: 0, length: ns.length)) {
                func g(_ i: Int) -> String? { let r = m.range(at: i); return r.location == NSNotFound ? nil : ns.substring(with: r) }
                guard let a = g(1).flatMap({ Double($0.replacingOccurrences(of: ",", with: ".")) }) else { continue }
                let b = g(2).flatMap { Double($0.replacingOccurrences(of: ",", with: ".")) }
                let n = max(a, b ?? 0)
                let unit = (g(3) ?? "").lowercased()
                let mult: Double = unit.hasPrefix("h") || unit.hasPrefix("std") || unit.hasPrefix("stund") ? 3600
                    : unit.hasPrefix("s") ? 1 : 60
                let secs = Int(n * mult)
                // a bare "s" after a number is too ambiguous below 5 seconds; nothing over 8 hours
                guard secs >= 5, secs <= 8 * 3600, !out.contains(secs) else { continue }
                out.append(secs)
            }
        }
        return Array(out.prefix(3))
    }

    /// "Thermomix · 20 Min. · 100 °C · Stufe 1 · Linkslauf"
    nonisolated static func deviceChips(_ tm: JSONValue?) -> [String] {
        guard let o = tm?.object else { return [] }
        let speed = o["speed"]?.string.map { $0.replacingOccurrences(of: #"^(Stufe|Speed)\s*"#, with: "", options: [.regularExpression, .caseInsensitive]) }
        let parts = [o["time"]?.string, o["temp"]?.string, speed.map { LF("Speed %@", $0) }, o["mode"]?.string].compactMap { $0 }.filter { !$0.isEmpty }
        guard !parts.isEmpty else { return [] }
        return ([o["device"]?.string].compactMap { $0 }.filter { !$0.isEmpty }) + parts
    }
}
