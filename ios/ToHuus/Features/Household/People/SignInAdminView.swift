import SwiftUI

/// "Anmeldung" for admins of a self-hosted server: which ways to sign in are allowed, single sign-on, and how each
/// member signs in (reset link, sign out everywhere, remove a second factor, PIN or SSO link).
/// Web: pages/AuthSettings.tsx SignInAdmin, SsoSettings, MemberSheet. ToHuus Cloud accounts sign in with their own
/// account (passkey, e-mail code, Apple), so this screen is only linked when the server is self-hosted.
struct SignInAdminView: View {
    let api: APIClient
    let myUserId: Int?
    @State private var info: AuthPolicyInfo?
    @State private var members: [MemberAuth] = []
    @State private var pick: MemberAuth?
    @State private var error: String?
    @State private var toast: ToastMessage?

    var body: some View {
        List {
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            if let info {
                if info.breakGlass == true {
                    Section {
                        Label(L("AUTH_BREAK_GLASS is set: passwords work for everyone and two-step sign-in is not required. Remove it once you are back in."), systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Theme.warning)
                    }
                }
                policySection(info)
                Section {
                    NavigationLink {
                        SSOSettingsView(api: api, info: info) { Task { await load() } }
                    } label: {
                        LabeledContent(L("Single sign-on (OpenID Connect)"), value: info.sso?.enabled == true ? L("on") : L("off"))
                    }
                } footer: {
                    Text(L("Authentik, Keycloak, Authelia, Forgejo/Gitea, Nextcloud, Google, Microsoft Entra … Members then sign in with the account they already have."))
                }
                Section(L("How members sign in")) {
                    ForEach(members) { m in
                        Button { pick = m } label: { memberRow(m) }
                            .buttonStyle(.plain)
                    }
                }
            } else if error == nil {
                Section { ProgressView().frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
            }
        }
        .themedList()
        .navigationTitle(L("Ways to sign in"))
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $pick) { m in
            MemberAuthSheet(api: api, member: m, mail: info?.mail == true) { msg in
                toast = ToastMessage(text: msg)
                Task { await load() }
            }
        }
        .toast($toast)
    }

    private func policySection(_ info: AuthPolicyInfo) -> some View {
        let p = info.policy
        let mail = info.mail == true
        return Section {
            policyToggle(L("Passkeys"), L("Face ID, Touch ID, Windows Hello. The safest and quickest way."), p.passkeys == true, key: "passkeys")
            policyToggle(L("Sign-in link by e-mail"),
                         mail ? L("For members with a confirmed address. One-time link, 15 minutes, bound to the device that asked.")
                              : L("Needs SMTP on the server (SMTP_HOST, SMTP_FROM …)."),
                         p.magicLink == true && mail, key: "magicLink", disabled: !mail)
            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                Text(L("Passwords")).font(.body.weight(.semibold))
                Picker(L("Passwords"), selection: Binding(get: { p.passwordFor ?? "all" }, set: { v in Task { await setPasswordFor(v) } })) {
                    Text(L("Everyone")).tag("all")
                    Text(L("Admins only")).tag("admins")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Text(L("“Admins only” keeps a password as emergency access when SSO or e-mail are down.")).font(.caption).foregroundStyle(Theme.ink3)
            }
            .padding(.vertical, 4)
            policyToggle(L("Require two-step sign-in for admins"), L("Admins signing in with a password also need a code. Set it up for yourself first."), p.requireTotpAdmins == true, key: "requireTotpAdmins")
            policyToggle(L("PIN switch on shared devices"), L("Mark a tablet as shared under My account; members with a PIN can switch there."), p.pinSwitch == true, key: "pinSwitch")
            policyToggle(L("“New sign-in” alerts"), L("A member gets a push and an e-mail when their account is used on a new device."), p.newDeviceAlerts == true, key: "newDeviceAlerts")
        } header: { Text(L("Ways to sign in")) }
    }

    private func policyToggle(_ title: String, _ hint: String, _ on: Bool, key: String, disabled: Bool = false) -> some View {
        Toggle(isOn: Binding(get: { on }, set: { v in Task { await set(key, v) } })) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold))
                Text(hint).font(.caption).foregroundStyle(Theme.ink3)
            }
        }
        .disabled(disabled)
    }

    private func memberRow(_ m: MemberAuth) -> some View {
        HStack(spacing: Theme.Space.s3) {
            AvatarView(name: m.name, color: m.color, size: 36, api: api)
            VStack(alignment: .leading, spacing: 4) {
                Text(m.name + (m.id == myUserId ? " · " + L("you") : "")).foregroundStyle(Theme.ink)
                FlowLayout(spacing: 4) {
                    if let n = m.passkeys, n > 0 { StatusPill(text: n == 1 ? L("Passkey") : LF("%d passkeys", n), status: "ok") }
                    if m.email != nil { StatusPill(text: L("E-mail"), status: nil) }
                    if m.password == true { StatusPill(text: m.totp == true ? L("Password + code") : L("Password"), status: nil) }
                    if m.sso == true { StatusPill(text: "SSO", status: "info") }
                    if m.pin == true { StatusPill(text: "PIN", status: nil) }
                }
                Text(ServerDate.relative(m.lastSeen) ?? L("never signed in")).font(.caption).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3).accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        do {
            async let i = api.authPolicy()
            async let m = api.authMembers()
            info = try await i
            members = (try? await m) ?? []
            error = nil
        } catch APIError.server(let status, _) where status == 403 {
            error = L("Only admins can change how people sign in.")
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func set(_ key: String, _ value: Bool) async {
        await update { try await api.setAuthPolicy([key: value]) }
    }

    private func setPasswordFor(_ value: String) async {
        await update { try await api.setAuthPolicy(["passwordFor": value]) }
    }

    private func update(_ work: () async throws -> Void) async {
        do {
            try await work()
            toast = ToastMessage(text: L("Saved"))
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
        await load()
    }
}

/// Single sign-on with OpenID Connect (web: AuthSettings.tsx SsoSettings). PUT /api/auth/sso, POST /api/auth/sso/test.
struct SSOSettingsView: View {
    let api: APIClient
    let info: AuthPolicyInfo
    let saved: () -> Void
    @State private var enabled = false
    @State private var issuer = ""
    @State private var clientId = ""
    @State private var clientSecret = ""
    @State private var scopes = ""
    @State private var label = ""
    @State private var autoCreate = false
    @State private var defaultRole = "member"
    @State private var trustEmail = false
    @State private var test: (ok: Bool, text: String)?
    @State private var busy = false
    @State private var toast: ToastMessage?
    @State private var copied = false

    private var insecure: Bool {
        issuer.hasPrefix("http://") && issuer.range(of: #"^http://(localhost|127\.0\.0\.1)(:|/|$)"#, options: .regularExpression) == nil
    }

    var body: some View {
        Form {
            Section {
                Toggle(L("Show the SSO button"), isOn: $enabled)
            }
            if let uri = info.redirectUri {
                Section {
                    Text(uri).font(.footnote.monospaced()).textSelection(.enabled)
                    Button {
                        UIPasteboard.general.string = uri
                        copied = true
                    } label: { Label(copied ? L("Copied") : L("Copy"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                } header: { Text(L("Redirect URI (enter this at your provider)")) }
            }
            Section {
                TextField("https://auth.example.org/application/o/tohuus", text: $issuer)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.body.monospaced())
            } header: { Text(L("Issuer URL")) } footer: {
                if insecure { Text(L("Without https, tokens travel unencrypted. Only use this inside a trusted network.")).foregroundStyle(Theme.warning) }
            }
            Section {
                LabeledField(L("Client ID")) { TextField("", text: $clientId).textInputAutocapitalization(.never).autocorrectionDisabled() }
                LabeledField(L("Client secret")) { SecureField(L("empty for public clients"), text: $clientSecret) }
                LabeledField(L("Button text")) { TextField(L("Sign in with SSO"), text: $label) }
                LabeledField(L("Scopes")) { TextField("openid email profile", text: $scopes).textInputAutocapitalization(.never).autocorrectionDisabled() }
            }
            Section {
                Toggle(isOn: $autoCreate) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Create members on first sign-in"))
                        Text(L("Off: only people who already belong to the household get in (matched by linked account or confirmed e-mail). On: everyone your provider lets through becomes a member."))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                if autoCreate {
                    Picker(L("Role"), selection: $defaultRole) {
                        Text(L("as Member")).tag("member")
                        Text(L("as Admin")).tag("admin")
                    }
                    .pickerStyle(.segmented)
                }
                Toggle(isOn: $trustEmail) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Trust e-mail addresses without “verified” flag"))
                        Text(L("Some providers (e.g. Authentik with default mappings) don’t mark addresses as verified. Only turn this on if your provider checks addresses itself."))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
            }
            if let test {
                Section { Text(test.text).foregroundStyle(test.ok ? Theme.primaryText : Theme.empty) }
            }
            Section {
                Button(L("Test connection")) { Task { await runTest() } }.disabled(issuer.isEmpty || busy)
            }
        }
        .themedList()
        .navigationTitle(L("Single sign-on"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(L("Save")) { Task { await save() } }
                    .disabled(busy || (enabled && (issuer.isEmpty || clientId.isEmpty)))
            }
        }
        .onAppear {
            let s = info.sso
            enabled = s?.enabled ?? false
            issuer = s?.issuer ?? ""
            clientId = s?.clientId ?? ""
            clientSecret = s?.clientSecret ?? ""
            scopes = s?.scopes ?? ""
            label = s?.label ?? ""
            autoCreate = s?.autoCreate ?? false
            defaultRole = s?.defaultRole ?? "member"
            trustEmail = s?.trustEmail ?? false
        }
        .toast($toast)
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await api.saveSSO(["enabled": enabled, "issuer": issuer.trimmingCharacters(in: .whitespaces), "clientId": clientId.trimmingCharacters(in: .whitespaces),
                                   "clientSecret": clientSecret, "scopes": scopes.trimmingCharacters(in: .whitespaces), "label": label.trimmingCharacters(in: .whitespaces),
                                   "autoCreate": autoCreate, "defaultRole": defaultRole, "trustEmail": trustEmail])
            toast = ToastMessage(text: L("Saved"))
            saved()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func runTest() async {
        busy = true
        defer { busy = false }
        test = nil
        do {
            let r = try await api.testSSO(issuer: issuer.trimmingCharacters(in: .whitespaces))
            let iss = r["issuer"]?.string ?? issuer
            test = (true, r["pkce"]?.bool == true ? LF("Reached %@. Looks good.", iss) : LF("Reached %@, but it doesn’t announce PKCE (S256). It may still work.", iss))
        } catch {
            test = (false, APIError.from(error).localizedDescription)
        }
    }
}

/// A label above a field inside a Form row.
private struct LabeledField<Field: View>: View {
    let title: String
    let field: () -> Field
    init(_ title: String, @ViewBuilder field: @escaping () -> Field) {
        self.title = title
        self.field = field
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(Theme.ink3)
            field()
        }
    }
}

/// One member's sign-in (web: AuthSettings.tsx MemberSheet).
struct MemberAuthSheet: View {
    let api: APIClient
    let member: MemberAuth
    let mail: Bool
    let done: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var link: String?
    @State private var confirm: Confirm?
    @State private var error: String?
    @State private var busy = false
    @State private var copied = false

    enum Confirm: String, Identifiable { case signout, totp; var id: String { rawValue } }

    var body: some View {
        NavigationStack {
            Form {
                if let link {
                    Section {
                        VStack(spacing: Theme.Space.s3) {
                            Text(LF("Give %@ this link (or let them scan it). It works once and for 24 hours; it is shown only now.", member.name))
                                .font(.subheadline).foregroundStyle(Theme.ink2)
                            if let qr = QRCode.image(link) {
                                Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                                    .frame(width: 200, height: 200)
                                    .padding(Theme.Space.s3)
                                    .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                                    .accessibilityLabel(L("QR code of the reset link"))
                            }
                            Text(link).font(.caption.monospaced()).foregroundStyle(Theme.ink3).textSelection(.enabled)
                            ShareLink(item: link) { Label(L("Share"), systemImage: "square.and.arrow.up") }.buttonStyle(PrimaryButtonStyle())
                            Button {
                                UIPasteboard.general.string = link
                                copied = true
                            } label: { Label(copied ? L("Link copied") : L("Copy link"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                    }
                } else {
                    Section {
                        Text((member.sessions ?? 0) == 1 ? L("Signed in on one device.") : LF("Signed in on %d devices.", member.sessions ?? 0))
                        if let e = member.email { LabeledContent(L("E-mail"), value: e) }
                    }
                    Section {
                        if member.email != nil && mail {
                            Button { Task { await act(L("Reset link sent")) { _ = try await api.memberResetLink(member.id, deliver: "email") } } } label: {
                                Label(L("E-mail a password reset link"), systemImage: "envelope")
                            }
                        }
                        Button { Task { await makeLink() } } label: { Label(L("Create a reset link to hand over"), systemImage: "link") }
                        if (member.sessions ?? 0) > 0 {
                            Button { confirm = .signout } label: { Label(L("Sign out everywhere"), systemImage: "rectangle.portrait.and.arrow.right") }
                        }
                    }
                    if member.totp == true || member.pin == true || member.sso == true {
                        Section {
                            if member.totp == true {
                                Button(role: .destructive) { confirm = .totp } label: { Label(L("Turn off two-step sign-in"), systemImage: "lock.shield") }
                            }
                            if member.pin == true {
                                Button(role: .destructive) { Task { await act(L("PIN removed")) { try await api.memberRemoveFactor(member.id, "pin") } } } label: {
                                    Label(L("Remove PIN"), systemImage: "circle.grid.3x3")
                                }
                            }
                            if member.sso == true {
                                Button(role: .destructive) { Task { await act(L("Unlinked")) { try await api.memberRemoveFactor(member.id, "sso") } } } label: {
                                    Label(L("Unlink single sign-on"), systemImage: "person.badge.key")
                                }
                            }
                        }
                    }
                    if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                }
            }
            .themedList()
            .disabled(busy)
            .navigationTitle(member.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .confirmationDialog(confirm == .totp ? L("Turn off two-step sign-in") : L("Sign out everywhere"), isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { c in
                if c == .totp {
                    Button(L("Turn off two-step sign-in"), role: .destructive) { Task { await act(L("Two-step sign-in is off.")) { try await api.memberRemoveFactor(member.id, "totp") } } }
                } else {
                    Button(L("Sign out everywhere"), role: .destructive) { Task { await act(L("Signed out")) { try await api.memberSignOutEverywhere(member.id) } } }
                }
                Button(L("Cancel"), role: .cancel) {}
            } message: { c in
                Text(c == .totp ? LF("Turn off two-step sign-in for %@? Do this only if they lost their phone and recovery codes.", member.name) : LF("Sign %@ out on all devices?", member.name))
            }
        }
    }

    private func act(_ msg: String, _ work: () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do {
            try await work()
            done(msg)
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func makeLink() async {
        busy = true
        defer { busy = false }
        do { link = try await api.memberResetLink(member.id, deliver: "link") } catch { self.error = APIError.from(error).localizedDescription }
    }
}
