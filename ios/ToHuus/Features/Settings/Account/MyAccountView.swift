import SwiftUI

/// Mehr › Mein Konto & Sicherheit (web: Settings › Mein Konto, pages/AuthSettings.tsx MyAccount): name, how you can
/// sign in, passkeys, e-mail address, password, two-step sign-in (self-hosted), single sign-on, PIN for the family
/// tablet, signed-in devices. ToHuus Cloud keeps password and passkeys on the account (routes/cloud.ts); e-mail
/// changes, two-step sign-in, PIN and SSO are self-hosted only, like on the web.
struct MyAccountView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var info: AccountInfo?
    @State private var cloudEmail: String?
    @State private var userId: Int?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var loading = true

    // name
    @State private var renaming = false
    @State private var newName = ""
    // e-mail
    @State private var editingEmail = false
    @State private var newEmail = ""
    @State private var confirmRemoveEmail = false
    // password
    @State private var showPassword = false
    // two-step sign-in
    @State private var totpSetup: TotpSetup?
    @State private var recoveryCodes: RecoveryCodes?
    @State private var pendingCodes: [String]?
    @State private var disablingTotp = false
    @State private var totpCode = ""
    // passkeys
    @State private var runner = AuthorizationRunner()
    @State private var passkeyBusy = false
    @State private var askPasskeyPassword = false
    @State private var passkeyPassword = ""
    @State private var askPasskeyCode = false
    @State private var passkeyCode = ""
    @State private var passkeyCodeMessage = ""
    @State private var renamingPasskey: AccountInfo.Passkey?
    @State private var passkeyName = ""
    @State private var removingPasskey: AccountInfo.Passkey?
    @State private var showRenamePasskey = false
    @State private var showRemovePasskey = false
    // PIN
    @State private var settingPin = false
    @State private var pin = ""
    // SSO
    @State private var linkingSSO = false

    struct RecoveryCodes: Identifiable { let id = UUID(); var codes: [String] }

    var body: some View {
        List {
            if let error { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.empty) } }
            if let a = info {
                summary(a)
                nameSection
                if a.passkeysAllowed { passkeySection(a) }
                emailSection(a)
                passwordSection(a)
                if !app.isCloud { totpSection(a) }
                if !app.isCloud, let sso = a.sso { ssoSection(sso) }
                if !app.isCloud, a.policy?.pinSwitch == true { pinSection(a) }
                if !app.isGuest { FocusSettingsSection(api: api) }
                Section {
                    NavigationLink { SignedInDevicesView(api: api) } label: {
                        Label(L("Signed-in devices"), systemImage: "laptopcomputer.and.iphone")
                    }
                    if !app.isCloud, a.isAdmin {
                        NavigationLink { SignInAdminView(api: api, myUserId: userId) } label: {
                            Label(L("Ways to sign in"), systemImage: "person.badge.key")
                        }
                    }
                } footer: {
                    Text(L("Don’t recognise one? Sign it out – and change your password if you use one."))
                }
            } else if loading {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            }
        }
        .themedList()
        .navigationTitle(L("My account"))
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
        // name
        .alert(L("Your name"), isPresented: $renaming) {
            TextField(L("Name"), text: $newName).textContentType(.name)
            Button(L("Cancel"), role: .cancel) {}
            Button(L("Save")) { Task { await saveName() } }
        } message: { Text(L("This is how the others in your household see you.")) }
        // e-mail
        .alert(L("E-mail address"), isPresented: $editingEmail) {
            TextField("name@example.org", text: $newEmail)
                .keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button(L("Cancel"), role: .cancel) {}
            Button(L("Send confirmation")) { Task { await sendEmail() } }
        } message: { Text(L("We send a link to this address. The address counts once you open it.")) }
        .confirmationDialog(L("Remove this address? Sign-in links and password resets by e-mail stop working."), isPresented: $confirmRemoveEmail, titleVisibility: .visible) {
            Button(L("Remove"), role: .destructive) { Task { await run("DELETE", "api/auth/me/email", done: L("Removed")) } }
        }
        // password
        .sheet(isPresented: $showPassword) {
            if let a = info {
                PasswordChangeSheet(api: api, hasPassword: a.hasPassword == true, minLength: app.instance?.passwordMin ?? (app.isCloud ? 10 : 8), accountName: a.name ?? app.userName ?? "") { text in
                    toast = ToastMessage(text: text)
                    Task { await load() }
                }
            }
        }
        // two-step sign-in
        .sheet(item: $totpSetup, onDismiss: {
            // the codes sheet only after the set-up sheet is gone (two sheets at once don't present)
            if let c = pendingCodes { recoveryCodes = RecoveryCodes(codes: c); pendingCodes = nil }
        }) { s in
            TotpSetupSheet(api: api, setup: s) { codes in
                pendingCodes = codes
                Task { await load() }
            }
        }
        .sheet(item: $recoveryCodes) { r in RecoveryCodesSheet(codes: r.codes) }
        .alert(L("Turn off two-step sign-in"), isPresented: $disablingTotp) {
            TextField(L("Code"), text: $totpCode).textContentType(.oneTimeCode).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button(L("Cancel"), role: .cancel) { totpCode = "" }
            Button(L("Turn off"), role: .destructive) { Task { await disableTotp() } }
        } message: { Text(L("Type a current code from your app – or a recovery code.")) }
        // passkeys
        .alert(L("Add passkey"), isPresented: $askPasskeyPassword) {
            SecureField(L("Password"), text: $passkeyPassword).textContentType(.password)
            Button(L("Cancel"), role: .cancel) { passkeyPassword = "" }
            Button(L("Continue")) { Task { await addPasskey(password: passkeyPassword) } }
        } message: { Text(L("A passkey signs you in to all your households. Please confirm with your password.")) }
        .alert(L("Code from the e-mail"), isPresented: $askPasskeyCode) {
            TextField(L("6-digit code"), text: $passkeyCode).keyboardType(.numberPad).textContentType(.oneTimeCode)
            Button(L("Cancel"), role: .cancel) { passkeyCode = "" }
            Button(L("Continue")) { Task { await addPasskey(code: passkeyCode) } }
        } message: { Text(passkeyCodeMessage) }
        .alert(L("Rename passkey"), isPresented: $showRenamePasskey, presenting: renamingPasskey) { p in
            TextField(L("Name"), text: $passkeyName)
            Button(L("Cancel"), role: .cancel) {}
            Button(L("Save")) { Task { await renamePasskey(p) } }
        }
        .confirmationDialog(
            LF("Remove the passkey “%@”? Also delete it from the device’s password manager.", removingPasskey?.name ?? L("Passkey")),
            isPresented: $showRemovePasskey,
            titleVisibility: .visible,
            presenting: removingPasskey
        ) { p in
            Button(L("Remove"), role: .destructive) { Task { await run("DELETE", "api/auth/passkeys/\(p.id)", done: L("Passkey removed")) } }
        }
        // PIN
        .alert(L("Choose a PIN (4–6 digits)"), isPresented: $settingPin) {
            SecureField(L("PIN"), text: $pin).keyboardType(.numberPad)
            Button(L("Cancel"), role: .cancel) { pin = "" }
            Button(L("Save PIN")) { Task { await savePin() } }
        } message: { Text(L("On a device marked as shared (e.g. the kitchen tablet), tap your picture and type your PIN to switch. Works only there.")) }
        // SSO: the provider's sign-in runs in the web view, signed in with a one-time link (WebSettingsView.swift)
        .sheet(isPresented: $linkingSSO, onDismiss: { Task { await load() } }) {
            NavigationStack {
                WebPageView(api: api, path: "/api/auth/oidc/start?link=1", title: L("Single sign-on"))
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { linkingSSO = false } } }
            }
        }
    }

    // MARK: sections

    private func summary(_ a: AccountInfo) -> some View {
        let ways = a.ways
        return Section {
            HStack(alignment: .top, spacing: Theme.Space.s3) {
                Image(systemName: ways.isEmpty ? "exclamationmark.shield" : "checkmark.shield")
                    .font(.title2).foregroundStyle(ways.isEmpty ? Theme.warning : Theme.primaryText)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Theme.Space.s1) {
                    Text(ways.isEmpty ? L("No way to sign in is set up yet.") : LF("You can sign in with: %@", ways.joined(separator: " · ")))
                        .font(.subheadline.weight(.semibold))
                    if ways.count == 1 {
                        Text(L("Add a second way, so a lost phone or a forgotten password doesn’t lock you out."))
                            .font(.footnote).foregroundStyle(Theme.ink2)
                    }
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private var nameSection: some View {
        Section {
            Button {
                newName = app.userName ?? info?.name ?? ""
                renaming = true
            } label: {
                LabeledContent(L("Your name")) {
                    HStack(spacing: 6) {
                        Text(info?.name ?? app.userName ?? "–")
                        Image(systemName: "pencil").font(.footnote).accessibilityHidden(true)
                    }
                }
            }
            .foregroundStyle(Theme.ink)
            .accessibilityHint(L("Change your name"))
            LabeledContent(L("Server"), value: app.isCloud ? L("ToHuus Cloud") : (api.baseURL.host() ?? ""))
        } footer: {
            Text(L("This is how the others in your household see you."))
        }
    }

    private func passkeySection(_ a: AccountInfo) -> some View {
        let canCreate = PasskeyHosts.canCreate(for: api.baseURL)
        return Section {
            ForEach(a.passkeys) { p in
                HStack(spacing: Theme.Space.s3) {
                    Image(systemName: "person.badge.key").foregroundStyle(Theme.ink2).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name ?? L("Passkey"))
                        Text(passkeySub(p)).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .swipeActions {
                    Button(role: .destructive) { removingPasskey = p; showRemovePasskey = true } label: { Label(L("Remove"), systemImage: "trash") }
                    Button { passkeyName = p.name ?? ""; renamingPasskey = p; showRenamePasskey = true } label: { Label(L("Rename"), systemImage: "pencil") }
                }
                .contextMenu {
                    Button { passkeyName = p.name ?? ""; renamingPasskey = p; showRenamePasskey = true } label: { Label(L("Rename"), systemImage: "pencil") }
                    Button(role: .destructive) { removingPasskey = p; showRemovePasskey = true } label: { Label(L("Remove"), systemImage: "trash") }
                }
            }
            if canCreate {
                Button {
                    Task { await startPasskey(a) }
                } label: {
                    HStack {
                        Label(L("Add passkey"), systemImage: "plus.circle")
                        if passkeyBusy { Spacer(); ProgressView() }
                    }
                }
                .disabled(passkeyBusy)
            } else if let web = try? api.url("einstellungen", query: [URLQueryItem(name: "tab", value: "account")]) {
                Link(destination: web) {
                    HStack {
                        Label(L("Add a passkey in Safari"), systemImage: "safari")
                        Spacer()
                        Image(systemName: "arrow.up.right").font(.footnote).foregroundStyle(Theme.ink3)
                    }
                }
            }
        } header: {
            Text(L("Passkeys"))
        } footer: {
            if canCreate {
                Text(L("Sign in with Face ID or Touch ID – nothing to type, nothing to phish. Swipe to rename or remove."))
            } else {
                Text(LF("Apple lets the app create passkeys only for ToHuus Cloud. For %@ add one in Safari under My account › Passkeys. Swipe to rename or remove.", api.baseURL.host() ?? L("this server")))
            }
        }
    }

    private func passkeySub(_ p: AccountInfo.Passkey) -> String {
        var s = p.lastUsedAt.flatMap { ServerDate.relative($0) }.map { LF("last used %@", $0) }
            ?? p.createdAt.flatMap { ServerDate.relative($0) }.map { LF("added %@", $0) } ?? ""
        if p.synced { s += (s.isEmpty ? "" : " · ") + L("synced") }
        return s
    }

    @ViewBuilder private func emailSection(_ a: AccountInfo) -> some View {
        Section {
            if app.isCloud {
                LabeledContent(L("E-mail"), value: cloudEmail ?? a.email ?? "–")
            } else if a.mail != true {
                Text(L("E-mail is not set up on this server (SMTP). Ask whoever runs ToHuus Hub."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            } else {
                if let e = a.email {
                    Label(e, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Theme.ink)
                        .swipeActions { Button(role: .destructive) { confirmRemoveEmail = true } label: { Label(L("Remove"), systemImage: "trash") } }
                }
                if let p = a.emailPending {
                    Text(LF("Waiting for confirmation: %@", p)).font(.subheadline).foregroundStyle(Theme.ink2)
                }
                Button(a.email == nil ? L("Add e-mail address") : L("Change e-mail address")) {
                    newEmail = a.email ?? ""
                    editingEmail = true
                }
                if a.email != nil {
                    Button(L("Remove address"), role: .destructive) { confirmRemoveEmail = true }
                }
            }
        } header: {
            Text(L("E-mail address"))
        } footer: {
            Text(app.isCloud ? L("The address you sign in with. Only you and the admins see it.")
                             : L("For sign-in links, a forgotten password and “new sign-in” alerts. Only you and the admins see it."))
        }
    }

    private func passwordSection(_ a: AccountInfo) -> some View {
        Section {
            if a.passwordOff {
                Text(L("Passwords are switched off in this household – you sign in another way."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            } else {
                Button(a.hasPassword == true ? L("Change password") : L("Set a password")) { showPassword = true }
            }
        } header: {
            Text(L("Password"))
        } footer: {
            if !a.passwordOff {
                Text(a.hasPassword == true
                     ? (app.isCloud ? L("Changing it signs out your browsers. The apps stay signed in – you can sign them out under Signed-in devices.") : L("Changing it signs out your other devices."))
                     : L("You don’t have a password yet."))
            }
        }
    }

    private func totpSection(_ a: AccountInfo) -> some View {
        Section {
            if a.totp == true {
                LabeledContent(L("Status"), value: L("on"))
                Button(L("Turn off"), role: .destructive) { totpCode = ""; disablingTotp = true }
            } else {
                Button(L("Set up two-step sign-in")) { Task { await beginTotp() } }
            }
            if a.policy?.requireTotpAdmins == true, a.isAdmin, a.totp != true {
                Label(L("Admins in this household need two-step sign-in for password sign-ins."), systemImage: "exclamationmark.triangle")
                    .font(.subheadline).foregroundStyle(Theme.warning)
            }
        } header: {
            Text(L("Two-step sign-in"))
        } footer: {
            Text(a.totp == true
                 ? LF("On. Password sign-ins also need a code from your authenticator app. %d recovery codes left.", a.recoveryLeft ?? 0)
                 : L("Optional: password sign-ins also ask for a 6-digit code from an authenticator app (e.g. Aegis, 2FAS, Google Authenticator, 1Password)."))
        }
    }

    private func ssoSection(_ sso: AccountInfo.SSO) -> some View {
        let label = sso.label ?? "SSO"
        return Section {
            if sso.linked == true {
                Button(L("Unlink"), role: .destructive) { Task { await run("DELETE", "api/auth/me/sso", done: L("Unlinked")) } }
            } else {
                Button { linkingSSO = true } label: { Label(L("Link account"), systemImage: "link") }
            }
        } header: {
            Text(L("Single sign-on"))
        } footer: {
            Text(sso.linked == true ? LF("Linked. “%@” on the sign-in screen signs you in.", label)
                                    : LF("Link your account at %@ once – after that, one tap signs you in.", label))
        }
    }

    private func pinSection(_ a: AccountInfo) -> some View {
        Section {
            Button(a.pin == true ? L("Change PIN") : L("Set a PIN")) { pin = ""; settingPin = true }
            if a.pin == true {
                Button(L("Remove PIN"), role: .destructive) { Task { await run("DELETE", "api/auth/me/pin", done: L("PIN removed")) } }
            }
        } header: {
            Text(L("PIN for the family tablet"))
        } footer: {
            Text(L("On a device marked as shared (e.g. the kitchen tablet), tap your picture and type your PIN to switch. Works only there."))
        }
    }

    // MARK: actions

    private func load() async {
        defer { loading = false }
        do {
            info = try await api.accountInfo()
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
        if app.isCloud {
            cloudEmail = (try? await api.cloudMe())?.email
        } else if userId == nil {
            userId = (try? await api.me())?.actor?["userId"]?.int
        }
    }

    /// Simple calls that end in a toast and a reload.
    private func run(_ method: String, _ path: String, json: [String: Any]? = nil, done: String) async {
        do {
            _ = try await api.send(method, path, json: json, as: Ignored.self)
            toast = ToastMessage(text: done)
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func saveName() async {
        let name = String(newName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
        guard !name.isEmpty else { return }
        do {
            if app.isCloud {
                let skipped = try await app.rename(to: name)
                toast = ToastMessage(text: skipped.isEmpty ? L("Saved") : LF("Saved. In %@ someone already has this name, there it stays as it was.", skipped.joined(separator: ", ")))
            } else {
                guard let userId else { throw APIError.notFound }
                _ = try await api.send("PATCH", "api/users/\(userId)", json: ["name": name], as: Ignored.self)
                toast = ToastMessage(text: L("Saved"))
            }
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func sendEmail() async {
        let e = newEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard e.contains("@") else { toast = ToastMessage(text: L("That doesn’t look like an e-mail address."), isError: true); return }
        await run("POST", "api/auth/me/email", json: ["email": e], done: L("Confirmation sent – check your inbox."))
    }

    private func beginTotp() async {
        do {
            totpSetup = try await api.send("POST", "api/auth/me/totp/setup", json: [:], as: TotpSetup.self)
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func disableTotp() async {
        let code = totpCode.trimmingCharacters(in: .whitespaces)
        totpCode = ""
        guard code.count >= 6 else { return }
        await run("POST", "api/auth/me/totp/disable", json: ["code": code], done: L("Two-step sign-in is off."))
    }

    private func savePin() async {
        let p = pin.filter(\.isNumber)
        pin = ""
        guard (4...6).contains(p.count) else { toast = ToastMessage(text: L("The PIN needs 4 to 6 digits."), isError: true); return }
        await run("PUT", "api/auth/me/pin", json: ["pin": p], done: L("PIN saved"))
    }

    private func renamePasskey(_ p: AccountInfo.Passkey) async {
        let n = passkeyName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        await run("PATCH", "api/auth/passkeys/\(p.id)", json: ["name": String(n.prefix(60))], done: L("Saved"))
    }

    /// ToHuus Cloud: confirm first (password, or a code from a mail); self-hosted servers go straight on.
    private func startPasskey(_ a: AccountInfo) async {
        if app.isCloud, a.confirm == "password" {
            passkeyPassword = ""
            askPasskeyPassword = true
        } else {
            await addPasskey()
        }
    }

    private func addPasskey(password: String? = nil, code: String? = nil) async {
        passkeyBusy = true
        defer { passkeyBusy = false; passkeyPassword = ""; passkeyCode = "" }
        switch await api.passkeyRegistrationOptions(password: password, code: code) {
        case .options(let options):
            do {
                let r = try await runner.registerPasskey(options: options)
                try await api.savePasskey(r, name: APIClient.passkeyDeviceName)
                toast = ToastMessage(text: L("Passkey saved"))
                await load()
            } catch {
                if !AuthorizationRunner.cancelled(error) {
                    toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
                }
            }
        case .needPassword:
            askPasskeyPassword = true
        case .needCode:
            passkeyCodeMessage = L("We sent you an e-mail with a 6-digit code. Type it in to add the passkey.")
            askPasskeyCode = true
        case .failed(let m):
            toast = ToastMessage(text: m, isError: true)
        }
    }
}
