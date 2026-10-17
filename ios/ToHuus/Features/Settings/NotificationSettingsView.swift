import SwiftUI
import UIKit

/// GET /api/notify/prefs (web: pages/NotifyMine.tsx) – what reaches this person on which channel, plus quiet hours,
/// "only when I'm home", what the lock screen may show and the mail switch.
struct MyNotifyPrefs: Decodable, Sendable {
    @Lossy var events: [Row]
    var quiet: Quiet?
    var preview: String?
    var mailOff: Bool?
    var channels: Channels?

    struct Row: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var label: String?
        var apns: Bool?
        var push: Bool?
        var digest: Bool?
        var homeOnly: Bool?
        var id: String { key }
        var title: String { label ?? NotifyPrefs.title(for: key) }

        func on(_ col: Col) -> Bool {
            switch col {
            case .apns: return apns ?? false
            case .push: return push ?? false
            case .digest: return digest ?? false
            }
        }

        mutating func set(_ col: Col, _ v: Bool) {
            switch col {
            case .apns: apns = v
            case .push: push = v
            case .digest: digest = v
            }
        }
    }

    enum Col: String, CaseIterable, Sendable {
        case apns, push, digest
    }

    struct Quiet: Codable, Sendable, Equatable {
        var from: String
        var to: String
    }

    struct Channels: Decodable, Sendable {
        var apns: Apns?
        var push: Devices?
        var digest: Digest?
        struct Apns: Decodable, Sendable { var configured: Bool?; var devices: Int? }
        struct Devices: Decodable, Sendable { var devices: Int? }
        struct Digest: Decodable, Sendable { var email: Bool? }
    }
}

/// Mehr › Mitteilungen: allow push on this iPhone; per event iPhone / browser / e-mail summary / only at home;
/// quiet hours, lock screen text, mails, private shopping. Links to the household routing and the extra channels.
struct NotificationSettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var push = PushManager.shared
    /// personal choices (current servers)
    @State private var mine: MyNotifyPrefs?
    /// older servers: only the household matrix (push column)
    @State private var legacy: NotifyPrefs?
    @State private var tripPrivate: Bool?
    /// browsers with web push for this person (GET /api/push/devices) – removable here
    @State private var browsers: [JSONValue] = []
    @State private var loading = false
    @State private var error: String?
    @State private var testResult: String?

    var body: some View {
        Form {
            iphoneSection
            if let mine {
                personalSections(mine)
            } else if let legacy {
                legacySections(legacy)
            } else if loading {
                Section { ProgressView() }
            }
            if let tripPrivate {
                Section {
                    Toggle(isOn: Binding(get: { tripPrivate }, set: { v in Task { await setTripPrivate(v) } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("My shopping stays private"))
                            Text(L("Nobody sees when you shop, and nobody is told.")).font(.footnote).foregroundStyle(Theme.ink3)
                        }
                    }
                    .tint(Theme.primary)
                }
            }
            if !browsers.isEmpty {
                Section {
                    ForEach(Array(browsers.enumerated()), id: \.offset) { _, d in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(d["label"]?.string ?? L("Device"))
                            Text(ServerDate.relative(d["last_ok_at"]?.string).map { LF("last delivered %@", $0) }
                                 ?? ServerDate.relative(d["created_at"]?.string).map { LF("added %@", $0) } ?? "")
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        .swipeActions {
                            Button(role: .destructive) { Task { await removeBrowser(d) } } label: { Label(L("Remove"), systemImage: "trash") }
                        }
                    }
                } header: {
                    Text(L("Browsers with push"))
                } footer: {
                    Text(L("Push in the web app is switched on in the browser itself. Swipe to remove a browser."))
                }
            }
            if let api = app.api, !app.isGuest {
                CheckinSettingSection(api: api)
                Section {
                    NavigationLink { HouseholdNotifyView(api: api) } label: {
                        Label(L("For the whole household"), systemImage: "house")
                    }
                    NavigationLink { ChannelsView(api: api) } label: {
                        Label(L("Telegram, Gotify & Matrix"), systemImage: "paperplane")
                    }
                } footer: {
                    Text(L("Shared channels: Home Assistant, ntfy, webhooks, Telegram and the household e-mail address. Phones and browsers follow each person’s own choice above."))
                }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("Notifications"))
        .refreshable { await load() }
        .task {
            await push.refreshAuthorization(registerIfAllowed: true)
            await load()
        }
    }

    // MARK: this iPhone

    private var apnsConfigured: Bool? { mine?.channels?.apns?.configured ?? legacy?.apnsConfigured }

    @ViewBuilder private var iphoneSection: some View {
        Section {
            switch push.state {
            case .allowed:
                Label(L("Notifications are on for this iPhone."), systemImage: "bell.badge")
                    .foregroundStyle(Theme.primaryText)
            case .denied:
                Label(L("Notifications are switched off in the iPhone settings."), systemImage: "bell.slash")
                Button(L("Open iPhone settings")) {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                }
            default:
                Button {
                    Task { await push.enable() }
                } label: {
                    Label(L("Allow notifications"), systemImage: "bell")
                }
            }
            if !push.serverSupportsAPNs {
                Text(L("Your server can't send iPhone notifications yet. It will once it is updated."))
                    .font(.footnote).foregroundStyle(Theme.ink3)
            }
            if apnsConfigured == false {
                Text(L("The server has no key for iPhone notifications yet, so none arrive. The household's admin or the ToHuus team can fix this."))
                    .font(.footnote).foregroundStyle(Theme.empty)
            }
            if push.state == .allowed && apnsConfigured != false {
                Button(L("Send a test notification")) { Task { await testPush() } }
                if let testResult { Text(testResult).font(.footnote).foregroundStyle(Theme.ink3) }
            }
            if let e = push.lastError { Text(e).font(.footnote).foregroundStyle(Theme.empty) }
        } header: {
            Text(L("This iPhone"))
        } footer: {
            Text(L("Buttons right in the notification: “I'll get it” / “Can't do it” when someone asks for something extra on your trip, “Put it on the list” when something is probably due."))
        }
    }

    // MARK: personal (current servers)

    @ViewBuilder private func personalSections(_ p: MyNotifyPrefs) -> some View {
        Section {
            ForEach(p.events) { row in
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Text(row.title).font(Theme.rowFont).foregroundStyle(Theme.ink)
                    FlowLayout(spacing: 6) {
                        ForEach(MyNotifyPrefs.Col.allCases, id: \.self) { col in
                            IxToggleChip(title: colTitle(col), systemImage: colIcon(col), on: row.on(col),
                                         a11yLabel: "\(row.title): \(colTitle(col))") {
                                Task { await flip(row, col) }
                            }
                        }
                        IxToggleChip(title: L("Only at home"), systemImage: "house", on: row.homeOnly ?? false,
                                     a11yLabel: "\(row.title): \(L("Only at home"))") {
                            Task { await flipHome(row) }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text(L("What reaches me where"))
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                Text(L("Only you decide what reaches you. Few things are on to start with."))
                ForEach(MyNotifyPrefs.Col.allCases, id: \.self) { col in
                    if let h = hint(col, p) { Text("\(colTitle(col)): \(h)") }
                }
                Text(L("“Only at home” needs the iPhone app or Home Assistant to know where you are; until then everything comes."))
            }
        }

        Section {
            Toggle(L("Quiet hours"), isOn: Binding(get: { p.quiet != nil }, set: { on in
                let q: MyNotifyPrefs.Quiet? = on ? .init(from: "22:00", to: "07:00") : nil
                Task { await save(["quiet": q.map { ["from": $0.from, "to": $0.to] as Any } ?? NSNull()]) { $0.quiet = q } }
            }))
            .tint(Theme.primary)
            if let q = p.quiet {
                DatePicker(L("From"), selection: quietBinding(q, from: true), displayedComponents: .hourAndMinute)
                DatePicker(L("Until"), selection: quietBinding(q, from: false), displayedComponents: .hourAndMinute)
            }
        } footer: {
            Text(L("No phone or browser messages – the summary waits anyway."))
        }

        Section {
            Picker(L("On the lock screen"), selection: Binding(get: { p.preview ?? "full" }, set: { v in
                Task { await save(["preview": v]) { $0.preview = v } }
            })) {
                Text(L("Show the text")).tag("full")
                Text(L("Only “Something new”")).tag("generic")
            }
            .pickerStyle(.segmented)
        } header: {
            Text(L("On the lock screen"))
        }

        if let off = p.mailOff {
            Section {
                Toggle(L("Mails from ToHuus"), isOn: Binding(get: { !off }, set: { on in
                    Task { await save(["mailOff": !on]) { $0.mailOff = !on } }
                }))
                .tint(Theme.primary)
            } footer: {
                Text(off
                     ? L("Off: no summaries or reminders by mail. Sign-in links and security notices still come.")
                     : L("Summaries and reminders by mail, as chosen above. Every such mail has a link to unsubscribe."))
            }
        }
    }

    private func colTitle(_ c: MyNotifyPrefs.Col) -> String {
        switch c {
        case .apns: return "iPhone"
        case .push: return L("Browser")
        case .digest: return L("E-mail")
        }
    }

    private func colIcon(_ c: MyNotifyPrefs.Col) -> String {
        switch c {
        case .apns: return "iphone"
        case .push: return "desktopcomputer"
        case .digest: return "envelope"
        }
    }

    private func hint(_ c: MyNotifyPrefs.Col, _ p: MyNotifyPrefs) -> String? {
        switch c {
        case .apns:
            if p.channels?.apns?.configured == false { return L("not set up on this server") }
            return (p.channels?.apns?.devices ?? 1) > 0 ? nil : L("open the iPhone app once")
        case .push:
            return (p.channels?.push?.devices ?? 0) > 0 ? nil : L("switch it on in the web app")
        case .digest:
            return p.channels?.digest?.email == true ? L("summary once a day") : L("summary – needs a confirmed address")
        }
    }

    private func quietBinding(_ q: MyNotifyPrefs.Quiet, from: Bool) -> Binding<Date> {
        Binding(get: { IxTime.date(from ? q.from : q.to, fallback: from ? "22:00" : "07:00") }, set: { d in
            var next = q
            if from { next.from = IxTime.string(d) } else { next.to = IxTime.string(d) }
            let final = next
            Task { await save(["quiet": ["from": final.from, "to": final.to]]) { $0.quiet = final } }
        })
    }

    // MARK: older servers

    @ViewBuilder private func legacySections(_ prefs: NotifyPrefs) -> some View {
        Section {
            ForEach(prefs.events) { e in
                Toggle(e.title, isOn: Binding(get: { e.on }, set: { on in Task { await setLegacy(e.key, on) } }))
                    .disabled(e.locked || (prefs.household && !app.isAdmin))
                    .tint(Theme.primary)
            }
        } header: {
            Text(L("What should ToHuus tell you about?"))
        } footer: {
            Text(prefs.household
                 ? L("These switches apply to the whole household (only admins can change them). Personal switches come with the next server update.")
                 : L("Only for you – the others decide for themselves."))
        }
    }

    // MARK: actions

    private func load() async {
        guard let api = app.api else { return }
        loading = true
        defer { loading = false }
        do {
            mine = try await api.get("api/notify/prefs", as: MyNotifyPrefs.self)
            legacy = nil
            error = nil
        } catch APIError.notFound {
            mine = nil
            legacy = try? await api.notifyPrefs()
        } catch APIError.server(let status, _) where status == 400 {
            // a shared device or an account without a member row: nothing personal to set
            mine = nil
            legacy = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
        browsers = (try? await api.ixRaw("api/push/devices"))?.array ?? []
        if !app.isGuest, let p = try? await api.get("api/shop/trips/privacy", as: JSONValue.self) {
            tripPrivate = p["private"]?.bool ?? false
        }
    }

    /// PUT /api/notify/prefs with an optimistic local change; on failure the server's state comes back.
    private func save(_ body: [String: Any], _ change: (inout MyNotifyPrefs) -> Void) async {
        guard let api = app.api, var p = mine else { return }
        change(&p)
        mine = p
        do {
            _ = try await api.ixRawSend("PUT", "api/notify/prefs", json: body)
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
            await load()
        }
    }

    private func flip(_ row: MyNotifyPrefs.Row, _ col: MyNotifyPrefs.Col) async {
        let v = !row.on(col)
        Haptics.tick()
        await save(["events": [row.key: [col.rawValue: v]]]) { p in
            if let i = p.events.firstIndex(where: { $0.key == row.key }) { p.events[i].set(col, v) }
        }
    }

    private func flipHome(_ row: MyNotifyPrefs.Row) async {
        guard let p = mine else { return }
        let keys = p.events.filter { $0.key == row.key ? !($0.homeOnly ?? false) : ($0.homeOnly ?? false) }.map(\.key)
        Haptics.tick()
        await save(["homeOnly": keys]) { p in
            if let i = p.events.firstIndex(where: { $0.key == row.key }) { p.events[i].homeOnly = !(row.homeOnly ?? false) }
        }
    }

    private func setLegacy(_ key: String, _ on: Bool) async {
        guard let api = app.api, var p = legacy, let i = p.events.firstIndex(where: { $0.key == key }) else { return }
        p.events[i].on = on
        legacy = p
        do {
            try await api.setNotifyPref(key, on: on, prefs: p)
        } catch {
            self.error = APIError.from(error).localizedDescription
            legacy = try? await api.notifyPrefs()
        }
    }

    private func removeBrowser(_ d: JSONValue) async {
        guard let api = app.api, let id = d["id"]?.int else { return }
        do {
            _ = try await api.ixRawSend("DELETE", "api/push/devices/\(id)")
            browsers = (try? await api.ixRaw("api/push/devices"))?.array ?? []
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func setTripPrivate(_ v: Bool) async {
        guard let api = app.api else { return }
        tripPrivate = v
        do {
            _ = try await api.send("PUT", "api/shop/trips/privacy", json: ["private": v], as: Ignored.self)
        } catch {
            self.error = APIError.from(error).localizedDescription
            tripPrivate = !v
        }
    }

    private func testPush() async {
        guard let api = app.api else { return }
        do {
            let n = try await api.sendTestPush()
            testResult = n > 0 ? L("Sent – it should arrive in a few seconds.") : L("No iPhone of yours is registered yet. Close and reopen the app, then try again.")
        } catch {
            testResult = APIError.from(error).localizedDescription
        }
    }
}
