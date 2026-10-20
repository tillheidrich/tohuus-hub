import AuthenticationServices
import SwiftUI
import Vision

/// First screen of the App Store app: brand, one-line promise, ToHuus Cloud ("Konto erstellen", "Anmelden", Sign in
/// with Apple), other servers/accounts already on this iPhone, and "Eigener Server" for a self-hosted ToHuus (address,
/// password, browser sign-in or the QR code from the web app – decision 14 Oct 2026). Privacy and terms at the bottom.
/// `adding`: shown as a sheet from Mehr › Server & Haushalte to add another server or account.
struct StartView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var adding = false
    @State private var path: [Step] = []
    @State private var error: String?
    @State private var saved: [SavedConnection] = []
    @State private var opening: String?
    @State private var scanning = false
    @State private var connecting = false
    @State private var startStore: ObjectIdentifier?

    enum Step: Hashable {
        case signIn
        /// "Konto erstellen" – `code`: an access code to fill in, `apple`: Sign in with Apple needed one (beta gate)
        case signUp(code: String = "", apple: Bool = false)
        case code
        /// "Eigener Server", optionally with an address (a scanned QR code that only carries the address)
        case ownServer(String = "")
        /// an invitation link (JoinInviteView)
        case invite(String = "")
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: Theme.Space.s6) {
                    header
                    if let notice = app.notice, !adding {
                        Text(notice).font(.subheadline).foregroundStyle(Theme.info)
                            .padding(Theme.Space.s3).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.infoSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    }
                    if !saved.isEmpty && !adding { savedSection }
                    VStack(spacing: Theme.Space.s3) {
                        // a new Apple ID during the beta (signup mode "invite") needs an access code: on to "Konto
                        // erstellen", code first, then "Mit Apple fortfahren" there (tester feedback 18 Oct 2026)
                        AppleSignInButton(kind: .signIn, error: $error, onNeedsCode: inviteOnly ? {
                            error = nil
                            path.append(.signUp(apple: true))
                        } : nil)
                        Button(L("Create account")) { path.append(.signUp()) }
                            .buttonStyle(PrimaryButtonStyle())
                        Button(L("Sign in")) { path.append(.signIn) }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    if let error { ErrorBanner(message: error) }
                    if inviteOnly { BetaNote() }
                    VStack(spacing: Theme.Space.s2) {
                        if inviteOnly {
                            Button { path.append(.signUp()) } label: {
                                Label(L("I have an access code"), systemImage: "key").frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.bordered)
                        }
                        Button { path.append(.invite()) } label: {
                            Label(L("I have an invitation"), systemImage: "envelope.open").frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.bordered)
                    }
                    .font(.subheadline.weight(.semibold))
                    if cloudInstance?.betaGift == nil {
                        Text(L("14 days with everything, without payment details. Then Free, unless you choose a plan."))
                            .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                    }
                    ownServerSection
                    LegalLinks()
                }
                .padding(Theme.Space.s5)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .canvasBackground()
            .navigationDestination(for: Step.self) { step in
                switch step {
                case .signIn: SignInView(path: $path)
                case .signUp(let code, let apple): SignUpView(initialCode: code, afterApple: apple)
                case .code: EmailCodeView()
                case .ownServer(let a): OwnServerView(initialAddress: a)
                case .invite(let l):
                    JoinInviteView(initialLink: l) { code in
                        // an access code pasted as an "invitation": straight to "Konto erstellen" with it
                        path = [.signUp(code: code)]
                    }
                }
            }
            .toolbar {
                if adding { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            }
            .sheet(isPresented: $scanning) {
                ScannerSheet(title: L("Scan QR code"), symbologies: [.qr]) { code in Task { await scanned(code) } }
            }
            .overlay { if connecting { connectingOverlay } }
            // adding from Mehr: once the new server/account is active, the sheet goes
            .onChange(of: app.store.map { ObjectIdentifier($0) }) { _, new in if adding, new != startStore { dismiss() } }
            .onAppear {
                saved = app.savedConnections
                startStore = app.store.map { ObjectIdentifier($0) }
            }
            .task { _ = try? await app.loadInstance(app.cloudServer) }
            #if DEBUG
            .onAppear {
                let d = UserDefaults.standard
                if d.string(forKey: "debugStartSignup") != nil || d.bool(forKey: "debugStartSignUp") { path = [.signUp()] }
                else if d.bool(forKey: "debugStartSignIn") { path = [.signIn] }
                else if d.bool(forKey: "debugStartCode") { path = [.code] }
                else if d.bool(forKey: "debugStartOwnServer") { path = [.ownServer(d.string(forKey: "debugOwnServer") ?? "")] }
            }
            #endif
        }
        .onDisappear {
            // adding was cancelled: the active server's instance again (the cloud's was loaded for the sign-up)
            guard adding, let s = app.session, !s.isCloud, app.store.map({ ObjectIdentifier($0) }) == startStore else { return }
            Task { _ = try? await app.loadInstance(s.serverURL) }
        }
    }

    /// the beta gate and the trial note belong to ToHuus Cloud (app.instance may already be another server's)
    private var cloudInstance: InstanceInfo? { app.instance?.isCloud == false ? nil : app.instance }
    /// ToHuus Cloud lets new accounts in only with an access code (GET /api/instance → signupMode "invite")
    private var inviteOnly: Bool { cloudInstance?.signupMode == "invite" }

    /// Other servers/accounts this iPhone is still signed in to – one tap back in.
    private var savedSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Text(L("On this iPhone")).font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3)
                .textCase(.uppercase)
            ForEach(saved) { c in
                Button {
                    Task {
                        opening = c.id
                        if !(await app.openSaved(c)) { error = L("This sign-in has expired. Please sign in again."); saved = app.savedConnections }
                        opening = nil
                    }
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: c.isCloud ? "cloud" : "server.rack")
                            .foregroundStyle(Theme.primaryText)
                            .frame(width: 36, height: 36)
                            .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(c.title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                            if !c.subtitle.isEmpty { Text(c.subtitle).font(.caption).foregroundStyle(Theme.ink2) }
                        }
                        Spacer(minLength: 0)
                        if opening == c.id { ProgressView() } else { Image(systemName: "chevron.right").foregroundStyle(Theme.ink3) }
                    }
                    .padding(Theme.Space.s3)
                    .frame(minHeight: 56)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(opening != nil)
                .accessibilityLabel(LF("Continue with %@", [c.title, c.subtitle].filter { !$0.isEmpty }.joined(separator: ", ")))
                .contextMenu {
                    Button(role: .destructive) {
                        ConnectionVault.remove(id: c.id)
                        saved = app.savedConnections
                    } label: { Label(L("Remove from this iPhone"), systemImage: "trash") }
                }
            }
        }
    }

    /// Self-hosted ToHuus: a quiet second path below the cloud buttons.
    private var ownServerSection: some View {
        VStack(spacing: Theme.Space.s3) {
            HStack(spacing: Theme.Space.s3) {
                Rectangle().fill(Theme.line).frame(height: 1)
                Text(L("Running ToHuus yourself?")).font(.footnote).foregroundStyle(Theme.ink3).fixedSize()
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            .accessibilityElement(children: .combine)
            HStack(spacing: Theme.Space.s3) {
                Button {
                    path.append(.ownServer())
                } label: {
                    Label(L("Own server"), systemImage: "server.rack").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                Button {
                    scanning = true
                } label: {
                    Label(L("Scan QR code"), systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
            .font(.subheadline.weight(.semibold))
            Text(L("Everything is included on your own server. The QR code is in the web app under Settings › Me › Sign-in & security."))
                .font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
        }
        .padding(.top, Theme.Space.s2)
    }

    private var connectingOverlay: some View {
        VStack(spacing: Theme.Space.s3) {
            ProgressView()
            Text(L("Connecting …")).font(.subheadline).foregroundStyle(Theme.ink2)
        }
        .padding(Theme.Space.s6)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .accessibilityElement(children: .combine)
    }

    /// A QR code from the web app (tohuus://connect…) – or a plain address, which opens "Eigener Server".
    private func scanned(_ text: String) async {
        // an invitation's QR code (web: Einladen › QR)
        if JoinInviteView.parse(text) != nil {
            scanning = false
            path.append(.invite(text))
            return
        }
        guard let link = ConnectLink(text: text) else {
            if text.contains("."), AppModel.normalise(text) != nil, !text.lowercased().hasPrefix("tohuus:") {
                path.append(.ownServer(text))
            } else {
                error = L("This QR code isn’t from ToHuus. In the web app: Settings › Me › Sign-in & security › “Connect the iPhone app”.")
            }
            return
        }
        connecting = true
        defer { connecting = false }
        error = nil
        do {
            try await app.connect(link)
            Haptics.success()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private var header: some View {
        VStack(spacing: Theme.Space.s3) {
            BrandMark(size: 72)
                .padding(.top, adding ? Theme.Space.s4 : Theme.Space.s10)
                .accessibilityHidden(true)
            Text("ToHuus").font(Theme.title(34)).foregroundStyle(Theme.ink)
            Text(L("ToHuus remembers what’s missing at home."))
                .font(.title3).foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, Theme.Space.s4)
    }
}

/// Privacy policy and terms (instance links, else the ToHuus site) – shown on the start screen and the paywall.
struct LegalLinks: View {
    @Environment(AppModel.self) private var app
    /// the paywall also lists Apple's standard licence agreement (App Review 3.1.2)
    var withAppleEULA = false

    var body: some View {
        HStack(spacing: Theme.Space.s4) {
            Link(L("Privacy"), destination: Legal.privacy(app.instance))
            Link(L("Terms"), destination: Legal.terms(app.instance))
            if withAppleEULA { Link(L("Terms of Use (EULA)"), destination: SharedConfig.termsURL) }
        }
        .font(.footnote)
        .frame(maxWidth: .infinity)
    }
}

enum Legal {
    private static var german: Bool { Locale.current.language.languageCode?.identifier == "de" }
    static func privacy(_ i: InstanceInfo?) -> URL {
        i?.legal?.privacy.flatMap(URL.init(string:))
            ?? SharedConfig.siteURL.appendingPathComponent(german ? "de/datenschutz.html" : "privacy.html")
    }

    static func terms(_ i: InstanceInfo?) -> URL {
        i?.legal?.terms.flatMap(URL.init(string:))
            ?? SharedConfig.siteURL.appendingPathComponent(german ? "de/nutzungsbedingungen.html" : "terms.html")
    }
}

/// Apple's own button (black on light, white on dark), with the nonce handling.
struct AppleSignInButton: View {
    enum Kind { case signIn, signUp }
    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var scheme
    let kind: Kind
    @Binding var error: String?
    /// beta gate and "Wo kauft ihr meistens ein?" – used only when Apple creates a new account
    var betaCode: String?
    var stores: [String]?
    /// start screen during the beta: a new Apple ID was refused for lack of an access code – go and ask for it
    var onNeedsCode: (() -> Void)?
    @State private var nonce = ""
    @State private var busy = false

    var body: some View {
        SignInWithAppleButton(kind == .signIn ? .signIn : .continue) { req in
            nonce = AppleNonce.make()
            req.requestedScopes = [.fullName, .email]
            req.nonce = AppleNonce.sha256(nonce)
        } onCompletion: { result in
            switch result {
            case .success(let auth):
                guard let cred = AppleCredential(auth) else {
                    error = L("Sign in with Apple didn’t work. Please try again.")
                    return
                }
                let n = nonce
                Task { await finish(cred, nonce: n) }
            case .failure(let e):
                if !AuthorizationRunner.cancelled(e) { error = L("Sign in with Apple didn’t work. Please try again.") }
            }
        }
        .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
        .frame(height: 50)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
        .disabled(busy)
        .overlay { if busy { ProgressView().tint(scheme == .dark ? .black : .white) } }
    }

    private func finish(_ cred: AppleCredential, nonce: String) async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.signInWithApple(cred, nonce: nonce, betaCode: betaCode, stores: stores)
        } catch {
            let e = APIError.from(error)
            // 403 here = the beta gate (signup.invite / signup.code_invalid): no account for this Apple ID yet
            if let onNeedsCode, case .server(403, _) = e { onNeedsCode(); return }
            self.error = e.localizedDescription
        }
    }
}

/// E-mail and password; or a code from the mail; or a passkey.
struct SignInView: View {
    @Environment(AppModel.self) private var app
    @Binding var path: [StartView.Step]
    @State private var login = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var runner = AuthorizationRunner()

    var body: some View {
        Form {
            Section {
                TextField(L("E-mail"), text: $login)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField(L("Password"), text: $password)
                    .textContentType(.password)
                    .onSubmit { Task { await submit() } }
            }
            if let error {
                Section { Text(error).foregroundStyle(Theme.empty) }
            }
            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        Text(L("Sign in")).fontWeight(.semibold)
                        Spacer()
                        if busy { ProgressView() }
                    }
                }
                .disabled(login.isEmpty || password.isEmpty || busy)
            }
            Section {
                Button {
                    path.append(.code)
                } label: {
                    Label(L("Sign in with a code from an e-mail"), systemImage: "envelope")
                }
                if app.instance?.auth?.passkey?.bool ?? true {
                    Button {
                        Task { await passkey() }
                    } label: {
                        Label(L("Sign in with passkey"), systemImage: "person.badge.key")
                    }
                    .disabled(busy)
                }
            } header: {
                Text(L("Without a password"))
            } footer: {
                Text(L("Forgot your password? Sign in with a code from an e-mail, then set a new one in the web app."))
            }
        }
        .scrollContentBackground(.hidden)
        .canvasBackground()
        .navigationTitle(L("Sign in"))
    }

    private func submit() async {
        guard !login.isEmpty, !password.isEmpty else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.signIn(server: app.cloudServer, mode: "cloud", login: login.trimmingCharacters(in: .whitespaces), password: password, code: nil)
        } catch let e as APIError {
            if case .server(401, let m) = e { error = APIError.friendly(status: 401, message: m) } else { error = e.localizedDescription }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func passkey() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.signInWithPasskey(runner: runner)
        } catch {
            if !AuthorizationRunner.cancelled(error) { self.error = APIError.from(error).localizedDescription }
        }
    }
}

/// Sign-in without a password: the mail carries a 6-digit code (POST /api/auth/link → /api/auth/link/code).
struct EmailCodeView: View {
    @Environment(AppModel.self) private var app
    @State private var email = ""
    @State private var code = ""
    @State private var sent = false
    @State private var busy = false
    @State private var error: String?
    @FocusState private var codeFocused: Bool

    var body: some View {
        Form {
            Section {
                TextField(L("E-mail"), text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(sent)
            } footer: {
                if !sent { Text(L("We send you an e-mail with a code. Type it in here – it works once and for 10 minutes.")) }
            }
            if sent {
                Section {
                    TextField(L("6-digit code"), text: $code)
                        .textContentType(.oneTimeCode)
                        .keyboardType(.numberPad)
                        .font(.title3.monospacedDigit())
                        .focused($codeFocused)
                } header: {
                    Text(L("Code from the e-mail"))
                } footer: {
                    Text(LF("If %@ has an account, the mail is on its way. Check the spam folder too.", email))
                }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            Section {
                Button {
                    Task { sent ? await signIn() : await send() }
                } label: {
                    HStack {
                        Text(sent ? L("Sign in") : L("Send code")).fontWeight(.semibold)
                        Spacer()
                        if busy { ProgressView() }
                    }
                }
                .disabled(busy || (sent ? code.filter(\.isNumber).count < 6 : !email.contains("@")))
                if sent {
                    Button(L("Send a new code")) { Task { await send() } }.disabled(busy)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .canvasBackground()
        .navigationTitle(L("Code by e-mail"))
    }

    private func send() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await APIClient(baseURL: app.cloudServer).requestSignInMail(email: email.trimmingCharacters(in: .whitespaces))
            sent = true
            code = ""
            codeFocused = true
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func signIn() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.signInWithCode(email: email.trimmingCharacters(in: .whitespaces), code: code.filter(\.isNumber))
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// ToHuus Cloud sign-up with the one onboarding question "Wer gehört dazu?" – or with Apple.
struct SignUpView: View {
    @Environment(AppModel.self) private var app
    /// access code from the invitation field or a link
    var initialCode = ""
    /// Sign in with Apple on the start screen needed a code: say so at the top
    var afterApple = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var householdName = ""
    @State private var form = "family"
    @State private var betaCode = ""
    @State private var stores: [String] = []
    @State private var choices: StoreChoices?
    @State private var ownStore = ""
    @State private var busy = false
    @State private var error: String?

    static let forms: [(String, String)] = [
        ("single", "Just me"), ("couple", "The two of us"), ("family", "Family with children"), ("wg", "Flat share"),
        ("carer", "I look after someone"),
    ]

    var body: some View {
        Form {
            if invite {
                if afterApple {
                    Section {
                        Text(L("There’s no account for this Apple ID yet. Type your access code below, then tap “Continue with Apple” again."))
                            .foregroundStyle(Theme.info)
                    }
                }
                Section {
                    TextField(L("Access code"), text: $betaCode, prompt: Text(verbatim: "TOHU-XXXX-XXXX"))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                        .accessibilityHint(L("Needed to create an account right now."))
                    if let codeHint { Text(codeHint).font(.footnote).foregroundStyle(Theme.ink2) }
                } header: {
                    Text(L("Access code"))
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        BetaNote(compact: true)
                        Text(L("With Apple: type the code first, then tap “Continue with Apple”."))
                            .font(.footnote).foregroundStyle(Theme.ink2)
                    }
                }
            }
            Section {
                AppleSignInButton(kind: .signUp, error: $error, betaCode: cleanCode, stores: stores)
                    .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                    .listRowBackground(Color.clear)
            } footer: {
                Text(L("Or create the account with your e-mail address:"))
            }
            Section {
                TextField(L("Your name"), text: $name).textContentType(.givenName)
                TextField(L("E-mail"), text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField(LF("Password (at least %d characters)", minPassword), text: $password).textContentType(.newPassword)
            } header: {
                Text(L("You"))
            }
            Section {
                TextField(L("Name of your household, e.g. Familie Berg"), text: $householdName)
                Picker(L("Who belongs to it?"), selection: $form) {
                    ForEach(Self.forms, id: \.0) { f in Text(L(f.1)).tag(f.0) }
                }
                .pickerStyle(.inline)
            } header: {
                Text(L("Household"))
            } footer: {
                Text(L("This sets what you see first. You can change it any time."))
            }
            Section {
                FlowLayout(spacing: 8) {
                    ForEach(shopOptions, id: \.self) { s in
                        ChoiceChip(title: s, on: stores.contains(s)) { toggle(s) }
                    }
                }
                .padding(.vertical, 4)
                HStack {
                    TextField(L("Other shop, e.g. farm shop"), text: $ownStore)
                        .submitLabel(.done)
                        .onSubmit { addOwn() }
                    if !ownStore.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button(L("Add")) { addOwn() }.font(.subheadline.weight(.semibold))
                    }
                }
            } header: {
                Text(L("Where do you usually shop?"))
            } footer: {
                Text(L("Pick as many as you like – you can change it any time."))
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        Text(L("Create household")).fontWeight(.semibold)
                        Spacer()
                        if busy { ProgressView() }
                    }
                }
                .disabled(!valid || busy)
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    if app.instance?.betaGift == nil {
                        Text(L("14 days of Plus for free, then Free unless you choose a plan. Nothing renews by itself."))
                    } else {
                        Text(L("Right now every household gets the plan as a gift. Nothing is charged."))
                    }
                    Text(L("By creating an account you accept the terms and the privacy policy."))
                    LegalLinks().frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .canvasBackground()
        .navigationTitle(L("Create account"))
        .onAppear { if betaCode.isEmpty && !initialCode.isEmpty { betaCode = initialCode } }
        .task { if choices == nil { choices = try? await APIClient(baseURL: app.cloudServer).storeChoices() } }
    }

    private var invite: Bool { app.instance?.signupMode == "invite" }

    /// the code field takes whatever was pasted (a whole message, a link with ?code=) – the code is picked out
    private var cleanCode: String {
        if case .access(let c) = StartCode(betaCode) { return c }
        return betaCode.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// something else than an access code in the code field: one sentence what it is
    private var codeHint: String? {
        switch StartCode(betaCode) {
        case .invite: return L("That’s an invitation into a household – no access code needed. Go back and tap “I have an invitation”.")
        case .gift: return L("That’s a gift code for a plan, not an access code. It can’t be used in the app. After you’ve signed in, it’s redeemed in the browser under Settings › Data, plan & account › Plan & storage.")
        case .connect: return L("That’s a link to connect the app with a server. Go back and use “Scan QR code”.")
        default: return nil
        }
    }

    /// alphabetical shops of the region, the weekly market, then own entries – nothing preselected
    private var shopOptions: [String] {
        var all = choices?.stores ?? []
        if let m = choices?.market { all.append(m) }
        for s in stores where !all.contains(s) { all.append(s) }
        return all
    }

    private func toggle(_ s: String) {
        if let i = stores.firstIndex(of: s) { stores.remove(at: i) } else { stores.append(s) }
    }

    private func addOwn() {
        let n = ownStore.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        if !stores.contains(where: { $0.caseInsensitiveCompare(n) == .orderedSame }) { stores.append(n) }
        ownStore = ""
    }

    private var minPassword: Int { app.instance?.passwordMin ?? 10 }

    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && email.contains("@") && password.count >= minPassword
            && !householdName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.signUp(server: app.cloudServer, email: email.trimmingCharacters(in: .whitespaces), password: password,
                                 name: name.trimmingCharacters(in: .whitespaces),
                                 householdName: householdName.trimmingCharacters(in: .whitespaces), form: form,
                                 betaCode: cleanCode, stores: stores)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Sign-up gate: "Neue Konten gibt es gerade nur mit Zugangscode – frag gern per Mail danach." with the
/// mail link (support address from /api/instance).
struct BetaNote: View {
    @Environment(AppModel.self) private var app
    var compact = false

    private var address: String { app.instance?.support ?? "tohuus@tillheidrich.de" }

    var body: some View {
        VStack(alignment: compact ? .leading : .center, spacing: 4) {
            Text(L("New accounts need an access code right now – feel free to ask by e-mail."))
                .multilineTextAlignment(compact ? .leading : .center)
                .fixedSize(horizontal: false, vertical: true)
            if let url = URL(string: "mailto:\(address)?subject=ToHuus%20Zugangscode") {
                Link(address, destination: url)
                    .accessibilityLabel(LF("Write to %@", address))
            }
        }
        .font(compact ? .footnote : .subheadline)
        .foregroundStyle(Theme.ink2)
        .frame(maxWidth: .infinity, alignment: compact ? .leading : .center)
    }
}
