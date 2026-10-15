import EventKit
import SwiftUI
import UIKit

// Kalender lesen (server: lib/calsync.ts, docs/calendar-sync.md, web: pages/CalendarSync.tsx).
// The phone reads only the calendars the person picked (EventKit, full access, asked only here). Bin collection
// titles are matched with the server's rules on the phone; only kind + day are sent. Other appointments never leave
// the phone – unless the person switches on the AI check, then titles and days of the next 30 days are sent once per
// "Vorschläge holen" and nothing is stored.
// Two ways: household tasks with a date can be written into an existing calendar; moving an entry there moves the
// task, deleting it there means ToHuus doesn't write it again. Private tasks never go into a calendar from here.

struct CalsyncData: Decodable, Sendable {
    struct Kind: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var name: String
        var patterns: [String] = []
        var next: String?
        var dates: Int = 0
        var taskId: Int?
        var off: Bool = false
        var id: String { key }
    }
    struct Settings: Decodable, Sendable { var offset: String }
    struct AI: Decodable, Sendable {
        var consent: Bool
        var available: Bool
        var offReason: String?
    }
    var settings: Settings
    var lastSync: String?
    @Lossy var kinds: [Kind]
    var ai: AI
}

struct CalsyncSuggestion: Decodable, Sendable, Identifiable, Hashable {
    var title: String
    var day: String
    var time: String?
    var name: String
    var id: String { title + day }
}

private struct CalsyncSuggestions: Decodable, Sendable { @Lossy var suggestions: [CalsyncSuggestion] }

extension APIClient {
    /// GET /api/calsync – rules, next collection dates, the person's AI consent
    func calsync() async throws -> CalsyncData { try await get("api/calsync") }
    /// POST /api/calsync/dates – kind + day only
    func calsyncDates(source: String, from: String, to: String, dates: [(kind: String, day: String)]) async throws {
        _ = try await send("POST", "api/calsync/dates", json: [
            "source": source, "from": from, "to": to,
            "dates": dates.map { ["kind": $0.kind, "day": $0.day] },
        ], as: Ignored.self)
    }
    func calsyncOffset(_ offset: String) async throws {
        _ = try await send("PUT", "api/calsync/settings", json: ["offset": offset], as: Ignored.self)
    }
    func calsyncRevive(_ kind: String) async throws { _ = try await send("POST", "api/calsync/kinds/\(kind)/revive", as: Ignored.self) }
    func calsyncAI(_ consent: Bool) async throws { _ = try await send("PUT", "api/calsync/ai", json: ["consent": consent], as: Ignored.self) }
    func calsyncSuggest(_ events: [(title: String, day: String, time: String?)]) async throws -> [CalsyncSuggestion] {
        let body: [String: Any] = ["events": events.map { e -> [String: Any] in
            var x: [String: Any] = ["title": e.title, "day": e.day]
            if let t = e.time { x["time"] = t }
            return x
        }]
        let r: CalsyncSuggestions = try await send("POST", "api/calsync/suggest", json: body)
        return r.suggestions
    }
}

/// What the person chose on this phone, per household. Nothing of this goes to the server.
struct CalendarSyncPrefs: Codable, Equatable {
    var readIds: [String] = []
    var writeId: String?
    /// task id → calendar item identifier of the entry ToHuus wrote
    var written: [String: String] = [:]
    /// task id → when ToHuus last wrote that entry (an entry changed later was changed by the person)
    var stamps: [String: Double] = [:]
    /// tasks whose entry the person deleted in the calendar – not written again
    var skipped: [Int] = []
    /// a meaningless id for this phone's reading (two phones on one calendar dedupe by day on the server)
    var source = "ios-" + UUID().uuidString.lowercased()
    var lastRun: Double = 0

    var active: Bool { !readIds.isEmpty || writeId != nil }

    static func key(_ household: String) -> String { "calsync.\(household)" }
    static func load(_ household: String) -> CalendarSyncPrefs {
        guard let data = SharedConfig.defaults.data(forKey: key(household)),
              let p = try? JSONDecoder().decode(CalendarSyncPrefs.self, from: data) else { return CalendarSyncPrefs() }
        return p
    }
    func save(_ household: String) {
        if let data = try? JSONEncoder().encode(self) { SharedConfig.defaults.set(data, forKey: Self.key(household)) }
    }
}

@MainActor
final class CalendarSync {
    static let shared = CalendarSync()
    let store = EKEventStore()
    private var running = false

    var status: EKAuthorizationStatus { EKEventStore.authorizationStatus(for: .event) }
    var hasAccess: Bool { status == .fullAccess }

    func requestAccess() async -> Bool {
        (try? await store.requestFullAccessToEvents()) ?? false
    }

    var calendars: [EKCalendar] { hasAccess ? store.calendars(for: .event).sorted { ($0.source.title, $0.title) < ($1.source.title, $1.title) } : [] }

    /// When the app becomes active: at most once an hour, only when the person set it up and allowed access.
    func runIfDue(api: APIClient, household: String) async {
        let p = CalendarSyncPrefs.load(household)
        guard p.active, hasAccess, Date().timeIntervalSince1970 - p.lastRun > 3600 else { return }
        _ = try? await run(api: api, household: household)
    }

    struct SyncResult { var found = 0; var written = 0; var moved = 0 }

    /// Read the picked calendars (bins), then write household tasks into the chosen calendar and take over moves.
    @discardableResult
    func run(api: APIClient, household: String) async throws -> SyncResult {
        guard hasAccess, !running else { return SyncResult() }
        running = true
        defer { running = false }
        var p = CalendarSyncPrefs.load(household)
        var result = SyncResult()
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())

        // 1 – bins: the server's rules, matched here; only kind + day leave the phone
        let readCals = store.calendars(for: .event).filter { p.readIds.contains($0.calendarIdentifier) }
        if !readCals.isEmpty {
            let data = try await api.calsync()
            let rules: [(String, NSRegularExpression)] = data.kinds.compactMap { k in
                guard let re = try? NSRegularExpression(pattern: k.patterns.joined(separator: "|"), options: [.caseInsensitive]) else { return nil }
                return (k.key, re)
            }
            let end = cal.date(byAdding: .day, value: 120, to: start)!
            let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: readCals))
            var seen = Set<String>()
            var dates: [(kind: String, day: String)] = []
            for e in events {
                let title = e.title ?? ""
                let range = NSRange(title.startIndex..., in: title)
                guard let kind = rules.first(where: { $0.1.firstMatch(in: title, range: range) != nil })?.0 else { continue }
                let day = ServerDate.day(e.startDate)
                if seen.insert("\(kind)|\(day)").inserted { dates.append((kind, day)) }
            }
            try await api.calsyncDates(source: p.source, from: ServerDate.day(start), to: ServerDate.day(end), dates: dates)
            result.found = dates.count
        }

        // 2 – household tasks into an existing calendar, both ways
        if let wid = p.writeId, let target = store.calendar(withIdentifier: wid), target.allowsContentModifications {
            let tasks = try await api.care().tasks.filter { $0.nextDue != nil && $0.visibility != "private" && $0.extKind == nil && !p.skipped.contains($0.id) }
            let ids = Set(tasks.map { String($0.id) })
            for task in tasks {
                let key = String(task.id)
                if let eid = p.written[key] {
                    guard let event = store.calendarItem(withIdentifier: eid) as? EKEvent else {
                        // deleted in the calendar: the person doesn't want it there
                        p.written[key] = nil
                        p.stamps[key] = nil
                        p.skipped.append(task.id)
                        continue
                    }
                    let changedThere = (event.lastModifiedDate?.timeIntervalSince1970 ?? 0) > (p.stamps[key] ?? 0) + 2
                    if changedThere {
                        let day = ServerDate.day(event.startDate)
                        let time: String? = event.isAllDay ? nil : Self.hhmm(event.startDate)
                        if day != task.nextDue || time != task.dueTime {
                            var body: [String: Any] = ["next_due": day, "due_time": time.map { $0 as Any } ?? NSNull()]
                            if !event.isAllDay, let end = event.endDate { body["duration_min"] = max(5, min(1440, Int(end.timeIntervalSince(event.startDate) / 60))) }
                            try? await api.saveCareTask(id: task.id, body)
                            result.moved += 1
                        }
                        p.stamps[key] = Date().timeIntervalSince1970
                    } else if fill(event, from: task) {
                        _ = try? store.save(event, span: .thisEvent, commit: false)
                        p.stamps[key] = Date().timeIntervalSince1970
                        result.written += 1
                    }
                } else {
                    let event = EKEvent(eventStore: store)
                    event.calendar = target
                    guard fill(event, from: task) else { continue }
                    event.url = URL(string: "tohuus://tasks/\(task.id)")
                    event.notes = L("From ToHuus – move it here and the task moves too.")
                    if (try? store.save(event, span: .thisEvent, commit: false)) != nil {
                        p.written[key] = event.calendarItemIdentifier
                        p.stamps[key] = Date().timeIntervalSince1970
                        result.written += 1
                    }
                }
            }
            // done for good, archived or without a date any more: take ToHuus' own entry away again
            for (key, eid) in p.written where !ids.contains(key) {
                if let event = store.calendarItem(withIdentifier: eid) as? EKEvent { try? store.remove(event, span: .thisEvent, commit: false) }
                p.written[key] = nil
                p.stamps[key] = nil
            }
            try? store.commit()
        }
        p.lastRun = Date().timeIntervalSince1970
        p.save(household)
        return result
    }

    /// The next 30 days of the picked calendars for the AI check – titles, days, times. Bins are left out on the server.
    func upcoming(household: String) -> [(title: String, day: String, time: String?)] {
        let p = CalendarSyncPrefs.load(household)
        let cals = store.calendars(for: .event).filter { p.readIds.contains($0.calendarIdentifier) }
        guard hasAccess, !cals.isEmpty else { return [] }
        let start = Calendar.current.startOfDay(for: Date())
        let end = Calendar.current.date(byAdding: .day, value: 30, to: start)!
        return store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: cals))
            .filter { $0.url?.scheme != "tohuus" }
            .prefix(200)
            .map { (title: $0.title ?? "", day: ServerDate.day($0.startDate), time: $0.isAllDay ? nil : Self.hhmm($0.startDate)) }
    }

    /// Put the task's date into the entry; true when something changed.
    private func fill(_ event: EKEvent, from task: CareTask) -> Bool {
        let before = (event.title, event.startDate, event.endDate, event.isAllDay, event.location)
        event.title = task.name
        event.location = task.place
        if let start = TaskTime.start(task) {
            event.isAllDay = false
            event.startDate = start
            event.endDate = start.addingTimeInterval(Double(task.durationMin ?? 60) * 60)
        } else if let day = ServerDate.parse(task.nextDue) {
            event.isAllDay = true
            event.startDate = day
            event.endDate = day
        } else {
            return false
        }
        return before.0 != event.title || before.1 != event.startDate || before.2 != event.endDate || before.3 != event.isAllDay || before.4 != event.location
    }

    static func hhmm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

/// Aufgaben › Kalender
struct CalendarSyncView: View {
    let api: APIClient
    let household: String
    @State private var prefs = CalendarSyncPrefs()
    @State private var data: CalsyncData?
    @State private var access = false
    @State private var denied = false
    @State private var busy = false
    @State private var note: String?
    @State private var error: String?
    @State private var suggestions: [CalsyncSuggestion] = []
    @State private var asked = false
    private var sync: CalendarSync { CalendarSync.shared }

    var body: some View {
        List {
            Section {
                Text(L("ToHuus can read a calendar you already keep – your family calendar in iCloud, for example – and finds the bin collection in it. Only the kind and the day reach ToHuus; office days, doctor’s appointments and everything else stay on your iPhone."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                if !access {
                    Button {
                        Task {
                            access = await sync.requestAccess()
                            denied = !access
                        }
                    } label: { Label(L("Allow calendar access"), systemImage: "calendar.badge.checkmark") }
                        .frame(minHeight: 44)
                    if denied || sync.status == .denied || sync.status == .writeOnly {
                        Text(L("Access is off. You can allow it in the iPhone Settings › ToHuus › Calendars (“Full access”)."))
                            .font(.footnote).foregroundStyle(Theme.ink3)
                        Button(L("Open Settings")) {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                        .frame(minHeight: 44)
                    }
                }
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } } }

            if access {
                Section {
                    ForEach(sync.calendars, id: \.calendarIdentifier) { c in
                        let on = prefs.readIds.contains(c.calendarIdentifier)
                        Button {
                            if on { prefs.readIds.removeAll { $0 == c.calendarIdentifier } } else { prefs.readIds.append(c.calendarIdentifier) }
                            prefs.save(household)
                        } label: {
                            HStack {
                                Circle().fill(Color(cgColor: c.cgColor)).frame(width: 12, height: 12).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(c.title).foregroundStyle(Theme.ink)
                                    Text(c.source.title).font(.caption).foregroundStyle(Theme.ink3)
                                }
                                Spacer()
                                if on { Image(systemName: "checkmark").foregroundStyle(Theme.primaryText) }
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                } header: {
                    Text(L("Read these calendars"))
                } footer: {
                    Text(L("Only the calendars you tick. ToHuus looks 4 months ahead."))
                }
            }

            if let d = data {
                Section {
                    Picker(L("Remind about the bin"), selection: Binding(get: { d.settings.offset }, set: { v in Task { try? await api.calsyncOffset(v); await load() } })) {
                        Text(L("the evening before")).tag("evening")
                        Text(L("on the morning")).tag("morning")
                    }
                    ForEach(d.kinds.filter { $0.taskId != nil || $0.next != nil }) { k in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(k.name)
                                Text(k.off ? L("switched off") : k.next.map { LF("next collection %@", ServerDate.shortDay($0) ?? $0) } ?? L("no date ahead"))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer()
                            if k.off {
                                Button(L("Switch on again")) { Task { try? await api.calsyncRevive(k.key); await load() } }
                                    .buttonStyle(.bordered)
                            }
                        }
                        .frame(minHeight: 44)
                    }
                } header: {
                    Text(L("Bin collection"))
                } footer: {
                    Text(L("Each bin becomes one task that follows the dates – with taking turns and “Mach ich” like every task. Don’t want one? Archive the task."))
                }
            }

            if access {
                Section {
                    Picker(L("Write tasks into"), selection: Binding(get: { prefs.writeId ?? "" }, set: { v in prefs.writeId = v.isEmpty ? nil : v; prefs.save(household) })) {
                        Text(L("No calendar")).tag("")
                        ForEach(sync.calendars.filter(\.allowsContentModifications), id: \.calendarIdentifier) { c in
                            Text("\(c.title) · \(c.source.title)").tag(c.calendarIdentifier)
                        }
                    }
                } header: {
                    Text(L("Both ways"))
                } footer: {
                    Text(L("Household tasks with a date go into this calendar – never private ones. Move an entry there and the task moves too. Delete it there and ToHuus doesn’t write it again."))
                }
            }

            if let d = data {
                Section {
                    Toggle(L("AI may match calendar entries with tasks"), isOn: Binding(get: { d.ai.consent }, set: { v in Task { try? await api.calsyncAI(v); await load() } }))
                        .tint(Theme.primary)
                        .disabled(!d.ai.available && !d.ai.consent)
                    if d.ai.consent && access && !prefs.readIds.isEmpty {
                        Button {
                            Task { await suggest() }
                        } label: { Label(L("Get suggestions"), systemImage: "sparkles") }
                            .frame(minHeight: 44)
                            .disabled(busy)
                    }
                    if asked && suggestions.isEmpty && !busy {
                        Text(L("Nothing found that looks like a household task.")).font(.footnote).foregroundStyle(Theme.ink3)
                    }
                    ForEach(suggestions) { s in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(s.name).font(.subheadline.weight(.semibold))
                            Text("\(ServerDate.shortDay(s.day) ?? s.day)\(s.time.map { " · " + TaskTime.label($0) } ?? "") · \(s.title)")
                                .font(.caption).foregroundStyle(Theme.ink3)
                            HStack {
                                Button(L("Take over as a task")) { Task { await accept(s) } }.buttonStyle(.borderedProminent).tint(Theme.primary)
                                Button(L("No")) { suggestions.removeAll { $0 == s } }.buttonStyle(.bordered)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text(L("AI check"))
                } footer: {
                    Text(d.ai.available || d.ai.consent
                         ? L("Only for you and only with your OK: your iPhone sends the titles and days of the next 30 days of the calendars you picked to the language model (Mistral, via OpenRouter, USA). It suggests what is a household task, you decide. Nothing is stored. The bins don’t need AI.")
                         : L("AI is off in this household or for you."))
                }
            }

            if access && prefs.active {
                Section {
                    Button {
                        Task { await runNow() }
                    } label: {
                        HStack { Label(L("Sync now"), systemImage: "arrow.triangle.2.circlepath"); if busy { Spacer(); ProgressView() } }
                    }
                    .frame(minHeight: 44)
                    .disabled(busy)
                    if let note { Text(note).font(.footnote).foregroundStyle(Theme.ink2) }
                } footer: {
                    if let last = ServerDate.relative(data?.lastSync) {
                        Text(LF("Last read %@", last))
                    }
                }
            }
        }
        .themedList()
        .navigationTitle(L("Calendar"))
        .task {
            prefs = CalendarSyncPrefs.load(household)
            access = sync.hasAccess
            await load()
        }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            data = try await api.calsync()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func runNow() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await sync.run(api: api, household: household)
            prefs = CalendarSyncPrefs.load(household)
            note = [r.found > 0 ? LF("%d collection dates found", r.found) : L("No collection dates found."),
                    r.written > 0 ? LF("%d entries written", r.written) : nil,
                    r.moved > 0 ? LF("%d tasks moved", r.moved) : nil].compactMap { $0 }.joined(separator: " · ")
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func suggest() async {
        busy = true
        defer { busy = false }
        do {
            suggestions = try await api.calsyncSuggest(sync.upcoming(household: household))
            asked = true
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func accept(_ s: CalsyncSuggestion) async {
        var body: [String: Any] = ["name": s.name, "category": "house", "next_due": s.day]
        if let t = s.time { body["due_time"] = t }
        do {
            try await api.saveCareTask(id: nil, body)
            suggestions.removeAll { $0 == s }
            note = LF("“%@” is a task now.", s.name)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
