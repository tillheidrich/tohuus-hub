import EventKit
import SwiftUI
import UIKit

// Kalender lesen (server: lib/calsync.ts, docs/calendar-sync.md, web: pages/CalendarSync.tsx).
// The phone reads only the calendars the person picked (EventKit, full access, asked only here). Bin collection
// titles are matched with the server's rules on the phone; only kind + day are sent. Other appointments never leave
// the phone – unless the person switches on the AI check, then titles and days of the next 30 days are sent once per
// "Vorschläge holen" and nothing is stored.
// Two ways: household tasks with a date can be written into an existing calendar; moving an entry there moves the
// task, deleting it there means ToHuus doesn't write it again. Private tasks go only into the calendar the person
// picks for them ("Deine privaten Aufgaben", off by default) – only their own, never anyone else's, mapped apart.

struct CalsyncData: Decodable, Sendable {
    struct Kind: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var name: String
        var patterns: [String] = []
        var next: String?
        var dates: Int = 0
        var taskId: Int?
        var off: Bool = false
        /// the next few collection days, the usual gap in days, and nil/"new"/"on"/"ignored"
        var upcoming: [String]?
        var rhythmDays: Int?
        var state: String?
        var id: String { key }
    }
    struct Settings: Decodable, Sendable {
        var offset: String
        var weeks: Int?
    }
    struct Window: Decodable, Sendable { var from: String; var to: String }
    struct AI: Decodable, Sendable {
        var consent: Bool
        var available: Bool
        var offReason: String?
    }
    var settings: Settings
    var lastSync: String?
    var horizonDays: Int?
    var horizonWeeks: Int?
    var window: Window?
    var rescanRequested: String?
    var disconnectedAt: String?
    @Lossy var kinds: [Kind]

    var weeks: Int { settings.weeks ?? horizonWeeks ?? 26 }
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
    /// switch a kind off: its task is deleted, a later read does not bring it back
    func calsyncIgnore(_ kind: String) async throws { _ = try await send("POST", "api/calsync/kinds/\(kind)/ignore", as: Ignored.self) }
    /// the ticked list: on → tasks, off → switched off
    func calsyncDecide(on: [String], off: [String]) async throws {
        _ = try await send("POST", "api/calsync/kinds", json: ["on": on, "off": off], as: Ignored.self)
    }
    func calsyncWeeks(_ weeks: Int) async throws {
        _ = try await send("PUT", "api/calsync/settings", json: ["weeks": weeks], as: Ignored.self)
    }
    /// all tasks from the calendar, all dates and choices go
    func calsyncDisconnect() async throws { _ = try await send("POST", "api/calsync/disconnect", as: Ignored.self) }
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
    /// when reading was set up on this phone – a "Kalender trennen" (from anywhere) after it ends reading here
    var connectedAt: Double?
    /// "Deine privaten Aufgaben": the signed-in person's own private tasks into a calendar of their choice (default off)
    var priv: PrivateWrite?

    /// what ToHuus wrote into one calendar and what the person deleted there
    struct WriteState: Codable, Equatable {
        /// task id → calendar item identifier of the entry ToHuus wrote
        var written: [String: String] = [:]
        /// task id → when ToHuus last wrote that entry (an entry changed later was changed by the person)
        var stamps: [String: Double] = [:]
        /// tasks whose entry the person deleted in the calendar – not written again
        var skipped: [Int] = []
    }
    /// kept apart from the household mapping; `owner` = the member it was set up for (another person → it stops)
    struct PrivateWrite: Codable, Equatable {
        var calendarId: String
        var owner: Int?
        var state = WriteState()
    }

    var active: Bool { !readIds.isEmpty || writeId != nil || priv != nil }

    var household: WriteState {
        get { WriteState(written: written, stamps: stamps, skipped: skipped) }
        set { written = newValue.written; stamps = newValue.stamps; skipped = newValue.skipped }
    }

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

    /// When the app becomes active: at most once an hour, only when the person set it up and allowed access –
    /// and right away when someone asked for a new read in the browser (or changed the weeks) or disconnected.
    func runIfDue(api: APIClient, household: String) async {
        let p = CalendarSyncPrefs.load(household)
        guard p.active, hasAccess else { return }
        if Date().timeIntervalSince1970 - p.lastRun <= 3600 {
            guard let data = try? await api.calsync() else { return }
            let asked = data.rescanRequested != nil && !p.readIds.isEmpty
            guard asked || Self.disconnected(data, p) else { return }
        }
        _ = try? await run(api: api, household: household)
    }

    /// "Kalender trennen" happened after this phone was set up
    static func disconnected(_ data: CalsyncData, _ p: CalendarSyncPrefs) -> Bool {
        guard let at = ServerDate.parse(data.disconnectedAt) else { return false }
        return (p.connectedAt ?? 0) < at.timeIntervalSince1970
    }

    /// Stop reading and writing on this phone and take ToHuus' own entries out of the calendar again.
    func forget(household: String) {
        var p = CalendarSyncPrefs.load(household)
        remove(p.written)
        remove(p.priv?.state.written ?? [:])
        p.readIds = []
        p.writeId = nil
        p.written = [:]
        p.stamps = [:]
        p.skipped = []
        p.priv = nil
        p.connectedAt = nil
        p.save(household)
    }

    /// Take ToHuus' own entries out of the calendar (wherever they are now).
    private func remove(_ written: [String: String]) {
        guard hasAccess, !written.isEmpty else { return }
        for (_, eid) in written {
            if let event = store.calendarItem(withIdentifier: eid) as? EKEvent { try? store.remove(event, span: .thisEvent, commit: false) }
        }
        try? store.commit()
    }

    /// Another calendar for the household's tasks: ToHuus' entries leave the old one, the next run writes them anew.
    func setHouseholdCalendar(_ id: String?, household: String) {
        var p = CalendarSyncPrefs.load(household)
        guard p.writeId != id else { return }
        remove(p.written)
        p.writeId = id
        p.household = .init()
        // a "Kalender trennen" from before this moment must not undo it (disconnected())
        if id != nil && p.connectedAt == nil { p.connectedAt = Date().timeIntervalSince1970 }
        p.save(household)
    }

    /// "Meine privaten Aufgaben eintragen in": nil = off. The old calendar loses ToHuus' private entries.
    func setPrivateCalendar(_ id: String?, household: String) {
        var p = CalendarSyncPrefs.load(household)
        guard p.priv?.calendarId != id else { return }
        remove(p.priv?.state.written ?? [:])
        p.priv = id.map { CalendarSyncPrefs.PrivateWrite(calendarId: $0) }
        if id != nil && p.connectedAt == nil { p.connectedAt = Date().timeIntervalSince1970 }
        p.save(household)
    }

    /// Switching to another household: this household's private entries leave the calendar (the choice stays,
    /// switching back writes them again). Signing out (`keepChoice: false`) also forgets the choice – the next
    /// person on this phone starts with it off.
    func forgetPrivate(household: String, keepChoice: Bool) {
        var p = CalendarSyncPrefs.load(household)
        guard let priv = p.priv else { return }
        remove(priv.state.written)
        if keepChoice {
            p.priv?.state.written = [:]
            p.priv?.state.stamps = [:]
        } else {
            p.priv = nil
        }
        p.save(household)
    }

    /// Signed out: private entries of every household on this phone go.
    func signedOut() {
        let keys = SharedConfig.defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix("calsync.") }
        for key in keys { forgetPrivate(household: String(key.dropFirst("calsync.".count)), keepChoice: false) }
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
        let data = try await api.calsync()
        // disconnected (here or in the browser) after this phone was set up: stop, take our entries out
        if Self.disconnected(data, p) {
            running = false
            forget(household: household)
            return result
        }

        // 1 – bins: the server's rules, matched here; only kind + day leave the phone
        let readCals = store.calendars(for: .event).filter { p.readIds.contains($0.calendarIdentifier) }
        if !readCals.isEmpty {
            let rules: [(String, NSRegularExpression)] = data.kinds.compactMap { k in
                guard let re = try? NSRegularExpression(pattern: k.patterns.joined(separator: "|"), options: [.caseInsensitive]) else { return nil }
                return (k.key, re)
            }
            // as far ahead as the household chose (Aufgaben › Kalender), the last day is end - 1
            let end = cal.date(byAdding: .day, value: data.horizonDays ?? data.weeks * 7, to: start)!
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
            try await api.calsyncDates(source: p.source, from: ServerDate.day(start), to: ServerDate.day(cal.date(byAdding: .day, value: -1, to: end)!), dates: dates)
            result.found = dates.count
        }

        // 2 – household tasks into an existing calendar, both ways; 3 – my own private tasks into the calendar I chose
        let houseTarget = p.writeId.flatMap { store.calendar(withIdentifier: $0) }.flatMap { $0.allowsContentModifications ? $0 : nil }
        let privTarget = p.priv.flatMap { store.calendar(withIdentifier: $0.calendarId) }.flatMap { $0.allowsContentModifications ? $0 : nil }
        if houseTarget != nil || privTarget != nil {
            let care = try await api.care()
            let dated = care.tasks.filter { $0.nextDue != nil && $0.extKind == nil }
            if let target = houseTarget {
                var state = p.household
                let tasks = dated.filter { !$0.isPrivate && !state.skipped.contains($0.id) }
                await write(tasks, into: target, state: &state, result: &result, api: api)
                p.household = state
            }
            if let target = privTarget, var priv = p.priv {
                if let me = care.me, priv.owner == nil || priv.owner == me {
                    // only mine – never anyone else's, even if a server ever sent them
                    priv.owner = me
                    let tasks = dated.filter { $0.isPrivate && $0.ownerUserId == me && !priv.state.skipped.contains($0.id) }
                    await write(tasks, into: target, state: &priv.state, result: &result, api: api)
                    p.priv = priv
                } else if care.me != nil {
                    // someone else is signed in now: take the other person's entries out and switch it off
                    remove(priv.state.written)
                    p.priv = nil
                }
            }
        }
        p.lastRun = Date().timeIntervalSince1970
        p.save(household)
        return result
    }

    /// Write tasks into one calendar and take over what the person changed there (date, time, duration).
    /// Deleted there → not written again; gone from `tasks` (done for good, no date, not mine any more) → entry removed.
    private func write(_ tasks: [CareTask], into target: EKCalendar, state: inout CalendarSyncPrefs.WriteState, result: inout SyncResult, api: APIClient) async {
        let ids = Set(tasks.map { String($0.id) })
        for task in tasks {
            let key = String(task.id)
            if let eid = state.written[key] {
                guard let event = store.calendarItem(withIdentifier: eid) as? EKEvent else {
                    // deleted in the calendar: the person doesn't want it there
                    state.written[key] = nil
                    state.stamps[key] = nil
                    state.skipped.append(task.id)
                    continue
                }
                let changedThere = (event.lastModifiedDate?.timeIntervalSince1970 ?? 0) > (state.stamps[key] ?? 0) + 2
                if changedThere {
                    let day = ServerDate.day(event.startDate)
                    let time: String? = event.isAllDay ? nil : Self.hhmm(event.startDate)
                    if day != task.nextDue || time != task.dueTime {
                        var body: [String: Any] = ["next_due": day, "due_time": time.map { $0 as Any } ?? NSNull()]
                        if !event.isAllDay, let end = event.endDate { body["duration_min"] = max(5, min(1440, Int(end.timeIntervalSince(event.startDate) / 60))) }
                        try? await api.saveCareTask(id: task.id, body)
                        result.moved += 1
                    }
                    state.stamps[key] = Date().timeIntervalSince1970
                } else if fill(event, from: task) {
                    _ = try? store.save(event, span: .thisEvent, commit: false)
                    state.stamps[key] = Date().timeIntervalSince1970
                    result.written += 1
                }
            } else {
                let event = EKEvent(eventStore: store)
                event.calendar = target
                guard fill(event, from: task) else { continue }
                event.url = URL(string: "tohuus://tasks/\(task.id)")
                event.notes = L("From ToHuus – move it here and the task moves too.")
                if (try? store.save(event, span: .thisEvent, commit: false)) != nil {
                    state.written[key] = event.calendarItemIdentifier
                    state.stamps[key] = Date().timeIntervalSince1970
                    result.written += 1
                }
            }
        }
        // done for good, archived or without a date any more: take ToHuus' own entry away again
        for (key, eid) in state.written where !ids.contains(key) {
            if let event = store.calendarItem(withIdentifier: eid) as? EKEvent { try? store.remove(event, span: .thisEvent, commit: false) }
            state.written[key] = nil
            state.stamps[key] = nil
        }
        try? store.commit()
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
    /// the ticked list of newly found kinds (all ticked until someone unticks)
    @State private var picked: Set<String> = []
    @State private var pickedFor: [String] = []
    @State private var confirmDisconnect = false
    private var sync: CalendarSync { CalendarSync.shared }
    private static let weekChoices = [2, 4, 8, 12, 16, 20, 26]

    private func rhythm(_ k: CalsyncData.Kind) -> String? {
        guard let d = k.rhythmDays else { return k.dates == 1 ? L("once so far") : nil }
        if (6...8).contains(d) { return L("every week") }
        let w = Int((Double(d) / 7).rounded())
        if w >= 2 && abs(d - w * 7) <= 2 { return LF("every %d weeks", w) }
        return LF("about every %d days", d)
    }

    /// EventKit has no public "shared" flag, so we warn where we know: the household's own calendar (tasks are
    /// written there for everyone) or one read for the household's bins (typically the shared family calendar).
    private var privateWarning: String? {
        guard let id = prefs.priv?.calendarId else { return nil }
        if id == prefs.writeId { return L("This is the household’s calendar, too – whoever shares it sees your private tasks there.") }
        if prefs.readIds.contains(id) { return L("You read this calendar for the household, so it is probably shared – others would see your private tasks there.") }
        return nil
    }

    private func sub(_ k: CalsyncData.Kind) -> String {
        [k.next.map { LF("next %@", ServerDate.shortDay($0) ?? $0) } ?? L("no date ahead"),
         rhythm(k),
         k.dates > 1 ? LF("%d dates found", k.dates) : nil].compactMap { $0 }.joined(separator: " · ")
    }

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
                            // fresh from disk: a run in the background may have written entries since the screen opened
                            prefs = CalendarSyncPrefs.load(household)
                            if on { prefs.readIds.removeAll { $0 == c.calendarIdentifier } } else { prefs.readIds.append(c.calendarIdentifier) }
                            if prefs.connectedAt == nil && !prefs.readIds.isEmpty { prefs.connectedAt = Date().timeIntervalSince1970 }
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
                    Text(LF("Only the calendars you tick. We read the next %d weeks.", data?.weeks ?? 26))
                }
            }

            if let d = data {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(LF("We read the next %d weeks.", d.weeks))
                        if let last = ServerDate.relative(d.lastSync) {
                            Text(LF("Last read %@", last) + (d.window.flatMap { ServerDate.shortDay($0.to) }.map { " · " + LF("up to %@", $0) } ?? ""))
                                .font(.footnote).foregroundStyle(Theme.ink2)
                        } else {
                            Text(L("Not read yet.")).font(.footnote).foregroundStyle(Theme.ink3)
                        }
                        if d.rescanRequested != nil {
                            Text(L("A new read was asked for – it happens on this iPhone with “Read again now” or the next time the app opens."))
                                .font(.footnote).foregroundStyle(Theme.ink3)
                        }
                    }
                    .padding(.vertical, 2)
                    Picker(L("How far ahead to read"), selection: Binding(get: { d.weeks }, set: { v in Task { await changeWeeks(v) } })) {
                        ForEach(Array(Set(Self.weekChoices + [d.weeks])).sorted(), id: \.self) { n in
                            Text(n == 26 ? LF("%d weeks", n) + " (" + L("recommended") + ")" : LF("%d weeks", n)).tag(n)
                        }
                    }
                } header: {
                    Text(L("Found in your calendar"))
                } footer: {
                    Text(L("Sperrmüll and the Christmas tree come rarely – with half a year you catch them, too."))
                }

                let fresh = d.kinds.filter { $0.state == "new" }
                if !fresh.isEmpty {
                    Section {
                        ForEach(fresh) { k in
                            let on = picked.contains(k.key)
                            Button {
                                if on { picked.remove(k.key) } else { picked.insert(k.key) }
                            } label: {
                                HStack {
                                    Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(on ? Theme.primaryText : Theme.ink3)
                                        .font(.title3)
                                        .accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(k.name).foregroundStyle(Theme.ink)
                                        Text(sub(k)).font(.caption).foregroundStyle(Theme.ink3)
                                    }
                                    Spacer()
                                }
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                        Button {
                            Task {
                                await act {
                                    try await api.calsyncDecide(on: fresh.map(\.key).filter { picked.contains($0) },
                                                                off: fresh.map(\.key).filter { !picked.contains($0) })
                                }
                                note = L("Done – unticked ones stay off.")
                            }
                        } label: {
                            Text(picked.isEmpty ? L("Take over none") : LF("Take over %d as tasks", fresh.filter { picked.contains($0.key) }.count))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent).tint(Theme.primary)
                        .frame(minHeight: 44)
                    } header: {
                        Text(L("Which should become tasks?"))
                    }
                }

                Section {
                    Picker(L("Remind about the bin"), selection: Binding(get: { d.settings.offset }, set: { v in Task { await act { try await api.calsyncOffset(v) } } })) {
                        Text(L("the evening before")).tag("evening")
                        Text(L("on the morning")).tag("morning")
                    }
                    ForEach(d.kinds.filter { $0.state == "on" || $0.state == "ignored" }) { k in
                        Toggle(isOn: Binding(get: { k.state == "on" }, set: { v in
                            Task {
                                await act { if v { try await api.calsyncRevive(k.key) } else { try await api.calsyncIgnore(k.key) } }
                                note = v ? L("On again") : L("Switched off – the task is gone and won’t come back with the next read.")
                            }
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(k.name)
                                Text(k.state == "ignored" ? L("switched off") + " · " + sub(k) : sub(k))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .tint(Theme.primary)
                        .frame(minHeight: 44)
                    }
                } header: {
                    Text(L("Bin collection"))
                } footer: {
                    Text(L("Each bin you keep becomes one task that follows the dates – with taking turns and “Mach ich” like every task. Switched off, its task is deleted and a new read doesn’t bring it back."))
                }
            }

            if access {
                Section {
                    Picker(L("Write tasks into"), selection: Binding(get: { prefs.writeId ?? "" }, set: { v in
                        sync.setHouseholdCalendar(v.isEmpty ? nil : v, household: household)
                        prefs = CalendarSyncPrefs.load(household)
                    })) {
                        Text(L("No calendar")).tag("")
                        ForEach(sync.calendars.filter(\.allowsContentModifications), id: \.calendarIdentifier) { c in
                            Text("\(c.title) · \(c.source.title)").tag(c.calendarIdentifier)
                        }
                    }
                } header: {
                    Text(L("Both ways"))
                } footer: {
                    Text(L("Household tasks with a date go into this calendar – private ones only into the calendar you pick for them below. Move an entry there and the task moves too. Delete it there and ToHuus doesn’t write it again."))
                }

                Section {
                    Picker(L("Write my private tasks into"), selection: Binding(get: { prefs.priv?.calendarId ?? "" }, set: { v in
                        sync.setPrivateCalendar(v.isEmpty ? nil : v, household: household)
                        prefs = CalendarSyncPrefs.load(household)
                    })) {
                        Text(L("Off")).tag("")
                        ForEach(sync.calendars.filter(\.allowsContentModifications), id: \.calendarIdentifier) { c in
                            Text("\(c.title) · \(c.source.title)").tag(c.calendarIdentifier)
                        }
                    }
                    if let warning = privateWarning {
                        Label(warning, systemImage: "exclamationmark.triangle")
                            .font(.footnote).foregroundStyle(Theme.ink2)
                    }
                } header: {
                    Text(L("Your private tasks"))
                } footer: {
                    Text(L("Only your own private tasks with a date, never anyone else’s. Pick a calendar only you see, like your personal iCloud calendar. Moving, deleting and done work as above."))
                }
            }

            if let d = data {
                Section {
                    Toggle(L("AI may match calendar entries with tasks"), isOn: Binding(get: { d.ai.consent }, set: { v in Task { await act { try await api.calsyncAI(v) } } }))
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
                        HStack { Label(L("Read again now"), systemImage: "arrow.triangle.2.circlepath"); if busy { Spacer(); ProgressView() } }
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

            if prefs.active || data?.lastSync != nil || (data?.kinds.contains { $0.state != nil } ?? false) {
                Section {
                    Button(role: .destructive) {
                        confirmDisconnect = true
                    } label: {
                        Label(L("Disconnect calendar and remove everything from it"), systemImage: "calendar.badge.minus")
                    }
                    .frame(minHeight: 44)
                    .disabled(busy)
                } footer: {
                    Text(L("You can connect it again any time – then ToHuus asks again what should become a task."))
                }
            }

            Section {
                NavigationLink { TasksToCalendarHelpView(api: api) } label: {
                    Label(L("How your tasks get into your calendar"), systemImage: "calendar.badge.plus")
                }
            }
        }
        .themedList()
        .navigationTitle(L("Calendar"))
        .confirmationDialog(L("Disconnect the calendar?"), isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button(L("Disconnect and remove"), role: .destructive) { Task { await disconnect() } }
            Button(L("Cancel"), role: .cancel) {}
        } message: {
            Text(L("Disconnect the calendar? All tasks that came from it are deleted, and the iPhone stops reading it. You can connect it again any time."))
        }
        .onChange(of: data?.kinds.filter { $0.state == "new" }.map(\.key) ?? []) { _, keys in
            if keys != pickedFor { pickedFor = keys; picked = Set(keys) }
        }
        .task {
            prefs = CalendarSyncPrefs.load(household)
            access = sync.hasAccess
            await load()
        }
        .refreshable { await load() }
    }

    /// run a change, reload, and keep the reason visible when it failed (the control jumps back)
    private func act(_ run: () async throws -> Void) async {
        var failed: String?
        do {
            try await run()
        } catch {
            failed = error.localizedDescription
        }
        await load()
        if let failed { error = failed }
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

    /// a new number of weeks: save it, then read again right away when this phone reads
    private func changeWeeks(_ weeks: Int) async {
        await act { try await api.calsyncWeeks(weeks) }
        if access && !prefs.readIds.isEmpty { await runNow() }
    }

    private func disconnect() async {
        busy = true
        defer { busy = false }
        do {
            try await api.calsyncDisconnect()
            sync.forget(household: household)
            prefs = CalendarSyncPrefs.load(household)
            suggestions = []
            note = L("Calendar disconnected")
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

/// "So kommen eure Aufgaben in euren Kalender" – the way back (web: TasksToCalendarHelp in pages/CalendarSync.tsx).
struct TasksToCalendarHelpView: View {
    let api: APIClient

    var body: some View {
        List {
            Section {
                Text(L("Apple Calendar (iPhone, Mac): set up “Reminders & Calendar” once. Tasks with a date then show in “ToHuus · Kalender”, and moving them there moves the task."))
                NavigationLink { CalDavView(api: api) } label: { Label(L("Reminders & Calendar"), systemImage: "checklist.checked") }
            } header: { Text(L("Apple Calendar")) }
            Section {
                Text(L("Google Calendar, Outlook and others: create a subscription link and add it there. Read-only, it updates about every hour."))
                NavigationLink { CalDavView(api: api) } label: { Label(L("Calendar subscription for Google, Outlook and others"), systemImage: "link") }
            } header: { Text(L("Google, Outlook")) }
            Section {
                Text(L("Into a calendar you already have (e.g. your family calendar): in the iPhone app under Aufgaben › Euren Kalender lesen › “Both ways”."))
                Text(L("Your private tasks into a calendar of your own (e.g. your personal iCloud calendar): in the iPhone app under Aufgaben › Euren Kalender lesen › “Your private tasks”. Only yours, never anyone else’s."))
            } header: { Text(L("Your own calendar")) }
            Section {
                Text(L("Just one task: open it and tap “Add to calendar”."))
            } footer: {
                Text(L("Private tasks only appear when you choose so, and only your own: in Apple Calendar in “ToHuus · Mein Kalender”, which only you see; in a subscription link only if you switch on “Include my private tasks” when you create it; on the iPhone in the calendar you pick for them. The bins from your calendar are not written back – they are in there already."))
            }
        }
        .font(.subheadline)
        .themedList()
        .navigationTitle(L("Into your calendar"))
    }
}
