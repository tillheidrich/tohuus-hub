import SwiftUI

/// ToHuus in Apple Reminders and Calendar (web: shop/bridges.tsx CalDavCard, server: lib/caldav.ts): an app password
/// for a CalDAV account on the iPhone. Reminders then shows the shopping lists, "ToHuus · Aufgaben" and
/// "ToHuus · Nur für mich"; Calendar shows "ToHuus · Fällig". The password is shown once, stored hashed, revocable.
struct CalDavView: View {
    let api: APIClient
    @State private var passwords: [AppPassword] = []
    @State private var made: MadePassword?
    @State private var label = "iPhone"
    @State private var error: String?
    @State private var toast: ToastMessage?

    struct AppPassword: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var label: String
        var createdAt: String?
        var lastUsedAt: String?
    }

    struct MadePassword: Decodable, Sendable {
        var username: String
        var password: String
        var url: String
        var server: String
    }

    var body: some View {
        List {
            Section {
                Text(L("Apple Reminders, Nextcloud Tasks or Thunderbird show your shopping lists and your tasks (“ToHuus · Aufgaben”, “ToHuus · Nur für mich”) and can tick and add. Apple Calendar shows what is due in “ToHuus · Fällig”. One password for both."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            if let m = made {
                Section {
                    field(L("Server"), m.server)
                    field(L("User name"), m.username)
                    field(L("Password"), m.password)
                } header: { Text(L("Shown only now – copy it into the iPhone settings:")) }
                Section {
                    Text(L("On the iPhone: Settings › Apps › Reminders › Reminders Accounts › Add Account › Other."))
                    Text(L("“Add CalDAV Account”, then enter server, user name and password from above."))
                    Text(L("Open Reminders – your ToHuus lists appear under the new account."))
                    Text(L("For the calendar: Settings › Apps › Calendar › Calendar Accounts › Add Account › Other › “Add CalDAV Account”, with the same details."))
                    Button(L("Done")) { made = nil }
                }
                .font(.subheadline)
            } else {
                Section {
                    TextField(L("Device name"), text: $label)
                    Button(L("Create password")) { Task { await create() } }
                }
            }
            if !passwords.isEmpty {
                Section {
                    ForEach(passwords) { p in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.label)
                            Text(p.lastUsedAt.flatMap { ServerDate.relative($0) }.map { LF("last used %@", $0) } ?? L("not used yet"))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        .swipeActions {
                            Button(role: .destructive) { Task { await revoke(p) } } label: { Label(L("Revoke"), systemImage: "xmark") }
                        }
                    }
                } footer: { Text(L("Swipe to revoke a password.")) }
            }
        }
        .themedList()
        .navigationTitle(L("Reminders & Calendar"))
        .task { await load() }
        .toast($toast)
        .onDisappear { made = nil }
    }

    private func field(_ title: String, _ value: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).foregroundStyle(Theme.ink3)
                Text(value).font(.body.monospaced()).textSelection(.enabled)
            }
            Spacer()
            Button {
                // local only, gone after ten minutes – it is a password
                UIPasteboard.general.setItems([["public.utf8-plain-text": value]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(600)])
                toast = ToastMessage(text: L("Copied"))
            } label: { Image(systemName: "doc.on.doc") }
            .buttonStyle(.borderless)
            .accessibilityLabel(LF("Copy %@", title))
        }
    }

    private func load() async {
        do {
            passwords = try await api.get("api/caldav/passwords", as: Lossy<AppPassword>.self).wrappedValue
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func create() async {
        do {
            let name = label.trimmingCharacters(in: .whitespaces)
            made = try await api.send("POST", "api/caldav/passwords", json: ["label": String((name.isEmpty ? "iPhone" : name).prefix(60))], as: MadePassword.self)
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func revoke(_ p: AppPassword) async {
        do {
            _ = try await api.send("DELETE", "api/caldav/passwords/\(p.id)", as: Ignored.self)
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
