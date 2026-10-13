import AuthenticationServices
import SwiftUI

/// First screen of the App Store app – ToHuus Cloud only (self-hosting lives on GitHub with the web app):
/// brand, one-line promise, "Konto erstellen", "Anmelden", Sign in with Apple, privacy and terms.
struct StartView: View {
    @Environment(AppModel.self) private var app
    @State private var path: [Step] = []
    @State private var error: String?

    enum Step: Hashable {
        case signIn
        case signUp
        case code
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: Theme.Space.s6) {
                    header
                    if let notice = app.notice {
                        Text(notice).font(.subheadline).foregroundStyle(Theme.info)
                            .padding(Theme.Space.s3).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.infoSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    }
                    VStack(spacing: Theme.Space.s3) {
                        AppleSignInButton(kind: .signIn, error: $error)
                        Button(L("Create account")) { path.append(.signUp) }
                            .buttonStyle(PrimaryButtonStyle())
                        Button(L("Sign in")) { path.append(.signIn) }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    if let error { ErrorBanner(message: error) }
                    if app.instance?.signupMode == "invite" { BetaNote() }
                    if app.instance?.betaGift == nil {
                        Text(L("14 days with everything, without payment details. Then Free, unless you choose a plan."))
                            .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                    }
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
                case .signUp: SignUpView()
                case .code: EmailCodeView()
                }
            }
            .task { _ = try? await app.loadInstance(app.cloudServer) }
            #if DEBUG
            .onAppear {
                let d = UserDefaults.standard
                if d.string(forKey: "debugStartSignup") != nil || d.bool(forKey: "debugStartSignUp") { path = [.signUp] }
                else if d.bool(forKey: "debugStartSignIn") { path = [.signIn] }
                else if d.bool(forKey: "debugStartCode") { path = [.code] }
            }
            #endif
        }
    }

    private var header: some View {
        VStack(spacing: Theme.Space.s3) {
            BrandMark(size: 72)
                .padding(.top, Theme.Space.s10)
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
            self.error = APIError.from(error).localizedDescription
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
                Section {
                    TextField(L("Access code"), text: $betaCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                        .accessibilityHint(L("Needed to create an account during the test."))
                } header: {
                    Text(L("Access code"))
                } footer: {
                    BetaNote(compact: true)
                }
            }
            Section {
                AppleSignInButton(kind: .signUp, error: $error, betaCode: betaCode.trimmingCharacters(in: .whitespaces), stores: stores)
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
                        Text(L("During the beta your household gets the plan as a gift. Nothing is charged."))
                    }
                    Text(L("By creating an account you accept the terms and the privacy policy."))
                    LegalLinks().frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .canvasBackground()
        .navigationTitle(L("Create account"))
        .task { if choices == nil { choices = try? await APIClient(baseURL: app.cloudServer).storeChoices() } }
    }

    private var invite: Bool { app.instance?.signupMode == "invite" }

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
                                 betaCode: betaCode.trimmingCharacters(in: .whitespaces), stores: stores)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Beta gate: "ToHuus ist gerade im kleinen Test. Du brauchst einen Zugangscode – frag gern per Mail nach." with the
/// mail link (support address from /api/instance).
struct BetaNote: View {
    @Environment(AppModel.self) private var app
    var compact = false

    private var address: String { app.instance?.support ?? "tohuus@tillheidrich.de" }

    var body: some View {
        VStack(alignment: compact ? .leading : .center, spacing: 4) {
            Text(L("ToHuus is in a small test right now. You need an access code – feel free to ask by e-mail."))
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
