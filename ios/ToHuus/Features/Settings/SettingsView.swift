import StoreKit
import SwiftUI

/// "Mehr": account, household, the same groups as the web's Mehr (MoreSections), settings, plan & storage, devices,
/// sign out, delete account, legal, web settings.
struct SettingsView: View {
    let store: ServerStore
    /// iPad sidebar: shown as an area, not as a sheet (no "Done")
    var embedded = false
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var devices: [AppDevice] = []
    @State private var email: String?
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var error: String?
    @State private var showWeb = false
    @State private var manageSubscriptions = false
    /// how deleting the account is confirmed (GET /api/cloud/me): password, Apple or a mail code
    @State private var hasPassword = true
    @State private var appleLinked = false
    @State private var showTour = false
    @State private var renaming = false
    @State private var newName = ""

    var body: some View {
        NavigationStack {
            Form {
                // profile row: my account, security, devices (UX benchmark 2.3)
                Section {
                    if let api = app.api {
                        NavigationLink { MyAccountView(api: api) } label: {
                            HStack(spacing: Theme.Space.s3) {
                                PersonAvatar(name: app.userName ?? "?", size: 44, api: api)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(app.userName ?? "–").font(.headline)
                                    Text([app.activeHousehold?.name, email].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(Theme.ink3)
                                }
                            }
                        }
                        .accessibilityHint(L("Name, e-mail, password and security"))
                    }
                    Button { app.showSearch = true } label: {
                        Label(L("Find a setting or function"), systemImage: "magnifyingglass")
                    }
                    .foregroundStyle(Theme.ink2)
                }
                if let api = app.api { MoreSections(store: store, api: api) }
                Section(L("Settings")) {
                    if let api = app.api, !app.isGuest {
                        NavigationLink { HouseholdBasicsView(api: api) } label: { Label(L("Household settings"), systemImage: "house") }
                        NavigationLink { PlacesSettingsView(api: api) } label: { Label(L("Places & categories"), systemImage: "square.grid.2x2") }
                    }
                    NavigationLink { ConnectionsView() } label: {
                        LabeledContent {
                            Text(app.isCloud ? L("ToHuus Cloud") : (app.session?.serverURL.host() ?? ""))
                        } label: { Label(L("Servers & households"), systemImage: "server.rack") }
                    }
                    NavigationLink { NotificationSettingsView() } label: { Label(L("Notifications"), systemImage: "bell") }
                    NavigationLink { StoreArrivalView(store: store) } label: { Label(L("Hint in the shop"), systemImage: "location") }
                    NavigationLink { AISettingsView() } label: {
                        LabeledContent {
                            if app.aiLocked { Image(systemName: "lock.fill").foregroundStyle(Theme.ink3) }
                            else { Text(app.aiOn ? L("on") : L("off")) }
                        } label: { Label(L("With or without AI"), systemImage: "sparkles") }
                    }
                    NavigationLink { ListDisplaySettingsView() } label: { Label(L("How the list looks"), systemImage: "textformat.size") }
                    if let api = app.api, !app.isGuest {
                        NavigationLink { StartModeView(api: api, isAdmin: app.isAdmin) } label: { Label(L("What should be tracked?"), systemImage: "checklist") }
                        LunchboxSettingsLink(api: api)
                        NavigationLink { DataSettingsView(api: api) } label: { Label(L("Data & backups"), systemImage: "externaldrive") }
                    }
                    AppearancePicker()
                }
                Section(L("Help")) {
                    NavigationLink { HelpCenterView(store: store) } label: { Label(L("Help"), systemImage: "questionmark.circle") }
                    Button { showTour = true } label: { Label(L("Take the tour"), systemImage: "map") }
                    NavigationLink { HowItWorksView() } label: { Label(L("How ToHuus works"), systemImage: "lightbulb") }
                    NavigationLink { FactsView() } label: { Label(L("Good to know"), systemImage: "book") }
                    NavigationLink { ErrorLogView() } label: { Label(L("Error log"), systemImage: "ladybug") }
                }
                SampleDataSettingsSection()
                Section(L("Plan & storage")) {
                    LabeledContent(L("Current plan"), value: app.billing?.planLabel ?? (app.isCloud ? L("Free – without AI") : L("Own server – everything included")))
                    if let b = app.billing, b.isPaid {
                        if let r = ServerDate.parse(b.renewsAt) {
                            LabeledContent(L("Renews on"), value: r.formatted(date: .abbreviated, time: .omitted))
                        } else if let e = ServerDate.parse(b.expiresAt) {
                            LabeledContent(L("Ends on"), value: e.formatted(date: .abbreviated, time: .omitted))
                        }
                        if b.period == "yearly" {
                            Toggle(L("E-mail me 3 days before it renews"), isOn: Binding(
                                get: { b.reminder?.bool ?? b.reminder?["enabled"]?.bool ?? false },
                                set: { on in Task { _ = try? await app.api?.send("PATCH", "api/billing/reminder", json: ["enabled": on], as: Ignored.self); await app.refreshBilling() } }))
                        }
                    }
                    if let used = app.billing?.assistantUsed {
                        LabeledContent(L("Assistant this month"), value: app.billing?.assistantLimit.map { "\(used) / \($0)" } ?? "\(used)")
                    }
                    if let used = app.billing?.storageUsedBytes {
                        let limit = app.billing?.storageLimitBytes
                        VStack(alignment: .leading) {
                            LabeledContent(L("Storage"), value: limit.map { "\(bytes(used)) / \(bytes($0))" } ?? bytes(used))
                            if let limit, limit > 0 { ProgressView(value: min(used / limit, 1)).tint(used > limit * 0.9 ? Theme.low : Theme.primary) }
                        }
                    }
                    if app.purchasesAvailable {
                        Button(app.billing?.isPaid == true ? L("Manage plan") : L("See plans")) { app.openPaywall("settings"); if !embedded { dismiss() } }
                        if app.billing?.source == "apple" || app.billing?.isPaid == true {
                            Button(L("Manage subscription")) {
                                // Apple's sheet; the plain link when it can't be shown (e.g. the subscription is on another Apple account)
                                if UIApplication.shared.connectedScenes.first is UIWindowScene { manageSubscriptions = true }
                                else if let u = URL(string: app.billing?.manageUrl ?? "https://apps.apple.com/account/subscriptions") { UIApplication.shared.open(u) }
                            }
                        }
                    }
                }
                Section(L("Legal")) {
                    Link(L("Privacy"), destination: Legal.privacy(app.instance))
                    if let i = app.instance?.legal?.imprint, let url = URL(string: i) { Link(L("Imprint"), destination: url) }
                    Link(L("Terms"), destination: Legal.terms(app.instance))
                    LabeledContent(L("Version"), value: ErrorLog.appVersion)
                    if let url = FeedbackMail.url(instance: app.instance, household: app.session?.householdId) {
                        Link(destination: url) { Label(L("Send feedback"), systemImage: "envelope") }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                Section {
                    Button(L("Sign out"), role: .destructive) { confirmSignOut = true }
                    if app.isCloud {
                        Button(role: .destructive) {
                            confirmDelete = true
                        } label: {
                            HStack { Text(L("Delete account")); if deleting { Spacer(); ProgressView() } }
                        }
                    }
                }
            }
            .themedList()
            .navigationTitle(L("More"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !embedded { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            }
            .task { await load() }
            .confirmationDialog(L("Sign out on this iPhone?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button(L("Sign out"), role: .destructive) { dismiss(); app.signOut() }
            } message: {
                Text(L("Changes that haven't been sent yet are lost."))
            }
            .accountDeletion(isPresented: $confirmDelete, hasPassword: hasPassword, appleLinked: appleLinked,
                             onError: { error = $0 }, onDeleted: { dismiss() })
            .manageSubscriptionsSheet(isPresented: $manageSubscriptions)
            .sheet(isPresented: $showWeb) {
                if let api = app.api { WebSettingsView(api: api) }
            }
            .sheet(isPresented: $showTour) { AppTourView() }
            .alert(L("Your name"), isPresented: $renaming) {
                TextField(L("Name"), text: $newName)
                    .textContentType(.name)
                    .submitLabel(.done)
                Button(L("Cancel"), role: .cancel) {}
                Button(L("Save")) {
                    let name = String(newName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
                    guard !name.isEmpty else { return }
                    Task {
                        do {
                            let skipped = try await app.rename(to: name)
                            if !skipped.isEmpty { error = LF("In %@ someone already has this name, there it stays as it was.", skipped.joined(separator: ", ")) }
                        } catch { self.error = error.localizedDescription }
                    }
                }
            } message: {
                Text(L("This is how the others in your household see you."))
            }
        }
    }

    private func bytes(_ b: Double) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .file)
    }

    private func load() async {
        await loadDevices()
        if app.isCloud, let me = try? await app.api?.cloudMe() {
            email = me.email
            hasPassword = me.hasPassword
            appleLinked = me.appleLinked
        }
        await app.refreshSamples()
        await app.refreshBilling()
    }

    private func loadDevices() async {
        if let d = try? await app.api?.devices() { devices = d }
    }

}
