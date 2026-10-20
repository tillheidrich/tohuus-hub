import StoreKit
import SwiftUI

/// "Mehr": the profile row and the search, then the same groups as the web's Mehr (MoreSections → MoreMenu.swift,
/// shared/functions.json), then what only the App Store app needs (legal, version, error log) and Abmelden.
struct SettingsView: View {
    let store: ServerStore
    /// iPad sidebar: shown as an area, not as a sheet (no "Done")
    var embedded = false
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var devices: [AppDevice] = []
    @State private var email: String?
    @State private var confirmSignOut = false
    @State private var error: String?
    @State private var showWeb = false
    /// how deleting the account is confirmed (GET /api/cloud/me): password, Apple or a mail code
    @State private var hasPassword = true
    @State private var appleLinked = false
    @State private var showTour = false
    @State private var renaming = false
    @State private var newName = ""
    /// pushes inside Mehr: Einstellungen and its pages (value links, SettingsRoute)
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
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
                    Button {
                        // Mehr is itself a sheet: a second sheet from the root would never show (the row seemed dead) –
                        // close Mehr first, then open the search from the root
                        app.openSearch()
                    } label: {
                        Label(L("Find a setting or function"), systemImage: "magnifyingglass")
                    }
                    .foregroundStyle(Theme.ink2)
                }
                if let api = app.api { MoreSections(store: store, api: api) }
                // Einstellungen & Hilfe is the last group of MoreSections (shared/functions.json, Paket A): Einstellungen
                // (six pages, SettingsHome.swift), Hilfe (with the tour), So funktioniert ToHuus, Gut zu wissen, Alle Funktionen
                SampleDataSettingsSection()
                // Abo & Speicher: Einstellungen › Daten, Abo & Konto (PlanStorageView)
                Section(L("Legal")) {
                    Link(L("Privacy"), destination: Legal.privacy(app.instance))
                    if let i = app.instance?.legal?.imprint, let url = URL(string: i) { Link(L("Imprint"), destination: url) }
                    Link(L("Terms"), destination: Legal.terms(app.instance))
                    LabeledContent(L("Version"), value: ErrorLog.appVersion)
                    NavigationLink { ErrorLogView() } label: { Label(L("Error log"), systemImage: "ladybug") }
                    if let url = FeedbackMail.url(instance: app.instance, household: app.session?.householdId) {
                        Link(destination: url) { Label(L("Send feedback"), systemImage: "envelope") }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                Section {
                    Button(L("Sign out"), role: .destructive) { confirmSignOut = true }
                    // Konto löschen: Einstellungen › Daten, Abo & Konto › Deine Daten & Konto (AccountDataView)
                }
            }
            .themedList()
            .navigationTitle(L("More"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !embedded { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            }
            .settingsRoutes(store: store)
            .task { await load() }
            .onAppear {
                #if DEBUG
                // simulator screenshots: -debugSettings YES -debugSettingsPath ich (or haushalt/leute …)
                if let d = UserDefaults.standard.string(forKey: "debugSettingsPath") { app.requestedSettings = d }
                #endif
                openRequestedSettings()
            }
            .onChange(of: app.requestedSettings) { _, _ in openRequestedSettings() }
            .confirmationDialog(L("Sign out on this iPhone?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button(L("Sign out"), role: .destructive) { dismiss(); app.signOut() }
            } message: {
                Text(L("Changes that haven't been sent yet are lost."))
            }
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

    /// a deep link or a push for /einstellungen/<page>/<row> (AppModel.requestedSettings): straight there
    private func openRequestedSettings() {
        guard let target = app.requestedSettings else { return }
        app.requestedSettings = nil
        var p = NavigationPath()
        for r in SettingsRegistry.routes(for: target) { p.append(r) }
        path = p
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
