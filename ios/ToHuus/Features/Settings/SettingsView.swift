import SwiftUI

/// "Mehr": account, household, plan & storage, devices, sign out, delete account, legal, web settings.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var devices: [AppDevice] = []
    @State private var email: String?
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var error: String?
    @State private var showWeb = false

    var body: some View {
        NavigationStack {
            Form {
                Section(L("Account")) {
                    LabeledContent(L("Name"), value: app.userName ?? "–")
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
                Section(L("Plan & storage")) {
                    LabeledContent(L("Current plan"), value: app.billing?.planLabel ?? (app.isCloud ? L("Free") : L("Own server – everything included")))
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
                        Button(app.billing?.isPaid == true ? L("Manage plan") : L("See plans")) { app.showPaywall = true; dismiss() }
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
                    if let p = app.instance?.legal?.privacy, let url = URL(string: p) { Link(L("Privacy"), destination: url) }
                    if let i = app.instance?.legal?.imprint, let url = URL(string: i) { Link(L("Imprint"), destination: url) }
                    if let t = app.instance?.legal?.terms, let url = URL(string: t) { Link(L("Terms"), destination: url) }
                    LabeledContent(L("Version"), value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
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
            .navigationTitle(L("More"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task { await load() }
            .confirmationDialog(L("Sign out on this iPhone?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button(L("Sign out"), role: .destructive) { dismiss(); app.signOut() }
            } message: {
                Text(L("Changes that haven't been sent yet are lost."))
            }
            .confirmationDialog(L("Delete your account?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete account for good"), role: .destructive) { Task { await deleteAccount() } }
            } message: {
                Text(L("Households you are the only admin of are deleted with all their data. Other households keep their data, you just leave them. An active App Store subscription must be cancelled in your Apple Account settings."))
            }
            .sheet(isPresented: $showWeb) {
                if let api = app.api { WebSettingsView(api: api) }
            }
        }
    }

    private func bytes(_ b: Double) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .file)
    }

    private func load() async {
        await loadDevices()
        if app.isCloud, let me = try? await app.api?.cloudMe() { email = me.email }
        await app.refreshBilling()
    }

    private func loadDevices() async {
        if let d = try? await app.api?.devices() { devices = d }
    }

    private func deleteAccount() async {
        deleting = true
        defer { deleting = false }
        do {
            try await app.deleteAccount()
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
