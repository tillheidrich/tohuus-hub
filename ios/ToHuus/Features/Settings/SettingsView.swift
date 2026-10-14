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
                Section(L("Account")) {
                    if app.isCloud {
                        Button {
                            newName = app.userName ?? ""
                            renaming = true
                        } label: {
                            LabeledContent(L("Name")) {
                                HStack(spacing: 6) {
                                    Text(app.userName ?? "–")
                                    Image(systemName: "pencil").font(.footnote).accessibilityHidden(true)
                                }
                            }
                        }
                        .foregroundStyle(Theme.ink)
                        .accessibilityHint(L("Change your name"))
                    } else {
                        LabeledContent(L("Name"), value: app.userName ?? "–")
                    }
                    if let email { LabeledContent(L("E-mail"), value: email) }
                    LabeledContent(L("Server"), value: app.isCloud ? L("ToHuus Cloud") : (app.session?.serverURL.host() ?? ""))
                }
                Section(L("Household")) {
                    if app.households.count > 1 {
                        Picker(L("Active household"), selection: Binding(
                            get: { app.activeHousehold?.id.value ?? "" },
                            set: { id in if let h = app.households.first(where: { $0.id.value == id }) { app.switchHousehold(h) } }
                        )) {
                            ForEach(app.households) { h in Text(h.name ?? h.id.value).tag(h.id.value) }
                        }
                    } else {
                        LabeledContent(L("Household"), value: app.activeHousehold?.name ?? "–")
                    }
                }
                if let api = app.api { MoreSections(store: store, api: api) }
                Section {
                    NavigationLink { NotificationSettingsView() } label: { Label(L("Notifications"), systemImage: "bell") }
                    NavigationLink { StoreArrivalView(store: store) } label: { Label(L("Hint in the shop"), systemImage: "location") }
                    NavigationLink { AISettingsView() } label: {
                        LabeledContent {
                            if app.aiLocked { Image(systemName: "lock.fill").foregroundStyle(Theme.ink3) }
                            else { Text(app.aiOn ? L("on") : L("off")) }
                        } label: { Label(L("With or without AI"), systemImage: "sparkles") }
                    }
                    NavigationLink { ListDisplaySettingsView() } label: { Label(L("How the list looks"), systemImage: "textformat.size") }
                    AppearancePicker()
                }
                Section(L("Knowing")) {
                    Button { showTour = true } label: { Label(L("Take the tour"), systemImage: "map") }
                    NavigationLink { HowItWorksView() } label: { Label(L("How ToHuus works"), systemImage: "lightbulb") }
                    NavigationLink { FactsView() } label: { Label(L("Good to know"), systemImage: "book") }
                    NavigationLink { HelpListView() } label: { Label(L("Help"), systemImage: "questionmark.circle") }
                    NavigationLink { ErrorLogView() } label: { Label(L("Error log"), systemImage: "ladybug") }
                }
                SampleDataSettingsSection()
                Section(L("Plan & storage")) {
                    LabeledContent(L("Current plan"), value: app.billing?.planLabel ?? (app.isCloud ? L("Free") : L("Own server – everything included")))
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
                        Button(app.billing?.isPaid == true ? L("Manage plan") : L("See plans")) { app.showPaywall = true; if !embedded { dismiss() } }
                        if app.billing?.source == "apple" || app.billing?.isPaid == true {
                            Button(L("Manage subscription")) {
                                // Apple's sheet; the plain link when it can't be shown (e.g. the subscription is on another Apple account)
                                if UIApplication.shared.connectedScenes.first is UIWindowScene { manageSubscriptions = true }
                                else if let u = URL(string: app.billing?.manageUrl ?? "https://apps.apple.com/account/subscriptions") { UIApplication.shared.open(u) }
                            }
                        }
                    }
                }
                Section {
                    ForEach(devices) { d in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(d.label)
                                if let u = ServerDate.relative(d.lastUsedAt ?? d.createdAt) { Text(u).font(.caption).foregroundStyle(Theme.ink3) }
                            }
                            Spacer()
                            if d.current == true { Text(L("this device")).font(.caption).foregroundStyle(Theme.primaryText) }
                        }
                        .swipeActions {
                            if d.current != true {
                                Button(role: .destructive) {
                                    Task { try? await app.api?.revokeDevice(d.id.value); await loadDevices() }
                                } label: { Label(L("Sign out"), systemImage: "xmark") }
                            }
                        }
                    }
                } header: {
                    Text(L("Signed-in apps"))
                } footer: {
                    if !devices.isEmpty { Text(L("Swipe to sign out a device.")) }
                }
                Section {
                    Button(L("More settings in the web app")) { showWeb = true }
                } footer: {
                    Text(L("Guests, displays, Home Assistant and other rare settings live in the web app."))
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
