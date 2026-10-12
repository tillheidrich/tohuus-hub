import SwiftUI
import UIKit

/// Mehr › Mitteilungen: allow push on this iPhone, which events, quiet hours.
struct NotificationSettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var push = PushManager.shared
    @State private var prefs: NotifyPrefs?
    @State private var loading = false
    @State private var error: String?
    @State private var quiet = NotifyPrefs.QuietHours(enabled: false, from: "22:00", to: "07:00")
    @State private var quietSupported = false

    var body: some View {
        Form {
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
                if let e = push.lastError { Text(e).font(.footnote).foregroundStyle(Theme.empty) }
            } header: {
                Text(L("This iPhone"))
            } footer: {
                Text(L("Buttons right in the notification: “I'll get it” / “Can't do it” when someone asks for something extra on your trip, “Put it on the list” when something is probably due."))
            }

            if let prefs {
                Section {
                    ForEach(prefs.events) { e in
                        Toggle(e.title, isOn: Binding(get: { e.on }, set: { on in Task { await set(e.key, on) } }))
                            .disabled(e.locked || (prefs.household && !isAdmin))
                    }
                } header: {
                    Text(L("What should ToHuus tell you about?"))
                } footer: {
                    Text(prefs.household
                         ? L("These switches apply to the whole household (only admins can change them). Personal switches come with the next server update.")
                         : L("Only for you – the others decide for themselves."))
                }
            } else if loading {
                Section { ProgressView() }
            }

            if quietSupported {
                Section {
                    Toggle(L("Quiet hours"), isOn: Binding(get: { quiet.enabled }, set: { quiet.enabled = $0; saveQuiet() }))
                    if quiet.enabled {
                        DatePicker(L("From"), selection: time(\.from), displayedComponents: .hourAndMinute)
                        DatePicker(L("Until"), selection: time(\.to), displayedComponents: .hourAndMinute)
                    }
                } footer: {
                    Text(L("In this time ToHuus keeps quiet and collects what happened."))
                }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .navigationTitle(L("Notifications"))
        .task {
            await push.refreshAuthorization(registerIfAllowed: true)
            await load()
        }
    }

    private var isAdmin: Bool { app.activeHousehold?.role == "admin" }

    private func load() async {
        guard let api = app.api else { return }
        loading = true
        defer { loading = false }
        do {
            let p = try await api.notifyPrefs()
            prefs = p
            quietSupported = !p.household
            if let q = p.quietHours { quiet = q }
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func set(_ key: String, _ on: Bool) async {
        guard let api = app.api, var p = prefs, let i = p.events.firstIndex(where: { $0.key == key }) else { return }
        p.events[i].on = on
        prefs = p
        do {
            try await api.setNotifyPref(key, on: on, prefs: p)
            if p.household { await load() }
        } catch {
            self.error = APIError.from(error).localizedDescription
            await load()
        }
    }

    private func saveQuiet() {
        guard let api = app.api else { return }
        let q = quiet
        Task {
            do { try await api.setQuietHours(q) } catch { self.error = APIError.from(error).localizedDescription }
        }
    }

    /// "22:00" ⇄ Date for the pickers.
    private func time(_ kp: WritableKeyPath<NotifyPrefs.QuietHours, String>) -> Binding<Date> {
        Binding(get: {
            let parts = quiet[keyPath: kp].split(separator: ":").compactMap { Int($0) }
            return Calendar.current.date(bySettingHour: parts.first ?? 22, minute: parts.count > 1 ? parts[1] : 0, second: 0, of: Date()) ?? Date()
        }, set: { d in
            let c = Calendar.current.dateComponents([.hour, .minute], from: d)
            quiet[keyPath: kp] = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
            saveQuiet()
        })
    }
}
