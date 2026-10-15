import SwiftUI

/// Mein Konto › Angemeldete Geräte (web: AuthSettings.tsx Devices): the apps signed in with this account
/// (GET/DELETE /api/auth/app/devices – iPhone, iPad, Watch) and the browsers (GET/DELETE /api/auth/sessions,
/// POST /api/auth/sessions/others). Marking a browser as a shared family device stays in that browser – it is a
/// cookie of that device, the app has nothing to mark.
struct SignedInDevicesView: View {
    let api: APIClient
    @State private var apps: [AppDevice] = []
    @State private var browsers: [BrowserSession] = []
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var loaded = false
    @State private var confirmOthers = false

    private var others: Int { apps.filter { $0.current != true }.count + browsers.filter { $0.current != true }.count }

    var body: some View {
        List {
            if let error { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.empty) } }
            Section {
                ForEach(apps) { d in
                    row(symbol: d.label.contains("iPad") ? "ipad" : d.label.contains("Watch") ? "applewatch" : "iphone",
                        title: d.label,
                        sub: (d.lastUsedAt ?? d.createdAt).flatMap { ServerDate.relative($0) }.map { LF("active %@", $0) },
                        current: d.current == true)
                        .swipeActions {
                            if d.current != true {
                                Button(role: .destructive) { Task { await signOutApp(d) } } label: { Label(L("Sign out"), systemImage: "rectangle.portrait.and.arrow.right") }
                            }
                        }
                }
                if loaded, apps.isEmpty { Text(L("No app signed in.")).foregroundStyle(Theme.ink3) }
            } header: {
                Text(L("Apps"))
            }
            Section {
                ForEach(browsers) { s in
                    row(symbol: s.symbol,
                        title: (s.sharedName.map { "\($0) · " } ?? "") + s.label,
                        sub: browserSub(s),
                        current: s.current == true)
                        .swipeActions {
                            if s.current != true {
                                Button(role: .destructive) { Task { await signOutBrowser(s) } } label: { Label(L("Sign out"), systemImage: "rectangle.portrait.and.arrow.right") }
                            }
                        }
                }
                if loaded, browsers.isEmpty { Text(L("No browser signed in.")).foregroundStyle(Theme.ink3) }
            } header: {
                Text(L("Browsers"))
            } footer: {
                Text(L("Swipe to sign out a device. Don’t recognise one? Sign it out – and change your password if you use one."))
            }
            if others > 0 {
                Section {
                    Button(L("Sign out all other devices"), role: .destructive) { confirmOthers = true }
                }
            }
        }
        .themedList()
        .navigationTitle(L("Signed-in devices"))
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
        .confirmationDialog(L("Sign out all other devices?"), isPresented: $confirmOthers, titleVisibility: .visible) {
            Button(L("Sign out others"), role: .destructive) { Task { await signOutOthers() } }
        } message: {
            Text(L("This iPhone stays signed in. Everywhere else you sign in again."))
        }
    }

    private func row(symbol: String, title: String, sub: String?, current: Bool) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: symbol).font(.title3).foregroundStyle(Theme.ink2).frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let sub { Text(sub).font(.caption).foregroundStyle(Theme.ink3) }
            }
            Spacer()
            if current {
                Text(L("this device")).font(.caption.weight(.semibold)).foregroundStyle(Theme.primaryText)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func browserSub(_ s: BrowserSession) -> String {
        var parts: [String] = []
        if let m = s.methodLabel ?? s.method { parts.append(m) }
        if let seen = s.lastSeenAt.flatMap({ ServerDate.relative($0) }) { parts.append(LF("active %@", seen)) }
        else if let c = s.createdAt.flatMap({ ServerDate.relative($0) }) { parts.append(LF("signed in %@", c)) }
        if let ip = s.ip { parts.append(ip) }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        defer { loaded = true }
        do {
            apps = try await api.devices()
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
        browsers = (try? await api.browserSessions()) ?? []
    }

    private func signOutApp(_ d: AppDevice) async {
        do {
            try await api.revokeDevice(d.id.value)
            toast = ToastMessage(text: L("Signed out"))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func signOutBrowser(_ s: BrowserSession) async {
        do {
            _ = try await api.send("DELETE", "api/auth/sessions/\(s.id)", as: Ignored.self)
            toast = ToastMessage(text: L("Signed out"))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    /// Every other app and every browser – this iPhone stays.
    private func signOutOthers() async {
        var n = 0
        for d in apps where d.current != true {
            if (try? await api.revokeDevice(d.id.value)) != nil { n += 1 }
        }
        if browsers.contains(where: { $0.current != true }),
           let r = try? await api.send("POST", "api/auth/sessions/others", json: [:], as: JSONValue.self) {
            n += r["signedOut"]?.int ?? 0
        }
        toast = ToastMessage(text: LF("%d devices signed out", n))
        await load()
    }
}
