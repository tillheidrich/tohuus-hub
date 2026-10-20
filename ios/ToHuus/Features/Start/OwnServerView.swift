import SwiftUI
import Vision

/// "Eigener Server": connect the app to a self-hosted ToHuus. Address → check (GET /api/instance) → sign in with
/// name or e-mail + password (+ the two-step code), in the browser (passkey, e-mail link, SSO) or by a code / QR code
/// from the web app. Everything is unlocked on an own server – no plans, no Sign in with Apple.
struct OwnServerView: View {
    @Environment(AppModel.self) private var app
    /// an address to start with (a scanned link, the debug server)
    var initialAddress: String = ""

    @State private var address = ""
    @State private var server: URL?
    @State private var info: InstanceInfo?
    @State private var options: SelfhostAuthOptions?
    @State private var checking = false
    @State private var failure: String?

    @State private var login = ""
    @State private var password = ""
    @State private var twoStep = ""
    @State private var needCode: String?
    @State private var pairCode = ""
    @State private var showCode = false
    @State private var busy = false
    @State private var error: String?
    @State private var scanning = false
    @State private var runner = BrowserSignIn()
    @FocusState private var focus: Field?

    enum Field { case address, login, password, code, pair }

    var body: some View {
        Form {
            if let server, let info {
                serverSection(server, info)
                if info.isCloud {
                    Section {
                        Text(L("This is ToHuus Cloud. Go back and sign in with the buttons on the start screen."))
                            .foregroundStyle(Theme.ink2)
                    }
                } else {
                    passwordSection
                    browserSection(info)
                    if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                    Section {
                        Label(L("Everything is included on your own server – no plans, no payments."), systemImage: "checkmark.seal")
                            .font(.footnote).foregroundStyle(Theme.ink2)
                    }
                }
            } else {
                addressSection
            }
        }
        .scrollContentBackground(.hidden)
        .canvasBackground()
        .navigationTitle(L("Own server"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $scanning) {
            ScannerSheet(title: L("Scan QR code"), symbologies: [.qr]) { code in Task { await scanned(code) } }
        }
        .onAppear {
            if address.isEmpty { address = initialAddress }
            if server == nil { focus = .address }
        }
    }

    // MARK: step 1 – address

    private var addressSection: some View {
        Group {
            Section {
                TextField(L("e.g. tohuus.example.de"), text: $address)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focus, equals: .address)
                    .onSubmit { Task { await check() } }
                    .accessibilityLabel(L("Address of your server"))
            } header: {
                Text(L("Address of your server"))
            } footer: {
                Text(L("The address you open ToHuus with in the browser. The app needs https; plain http only works in your home network."))
            }
            if let failure {
                Section { Label(failure, systemImage: "exclamationmark.circle").foregroundStyle(Theme.empty) }
            }
            Section {
                Button {
                    Task { await check() }
                } label: {
                    HStack {
                        Text(L("Continue")).fontWeight(.semibold)
                        Spacer()
                        if checking { ProgressView() }
                    }
                }
                .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || checking)
            }
            Section {
                Button { scanning = true } label: { Label(L("Scan QR code from the web app"), systemImage: "qrcode.viewfinder") }
                Link(destination: Help.url("selbst-hosten")) {
                    Label(L("How to run ToHuus yourself"), systemImage: "questionmark.circle")
                }
            } footer: {
                Text(L("In the web app: Settings › Me › Sign-in & security › “Connect the iPhone app”. The QR code brings address and sign-in along."))
            }
        }
    }

    private func check() async {
        guard !checking else { return }
        checking = true
        defer { checking = false }
        failure = nil
        switch await ServerCheck.check(address) {
        case .ok(let url, let i):
            Motion.perform(Motion.quick) {
                server = url
                info = i
            }
            error = nil
            needCode = nil
            focus = .login
            if !i.isCloud { options = try? await APIClient(baseURL: url).selfhostAuthOptions() }
        case .failed(let f):
            failure = f.message
            Haptics.warning()
        }
    }

    // MARK: step 2 – sign in

    private func serverSection(_ url: URL, _ info: InstanceInfo) -> some View {
        Section {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: info.isCloud ? "cloud" : "server.rack")
                    .font(.title3)
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: 40, height: 40)
                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(info.name ?? "ToHuus").font(.headline)
                    Text(url.host() ?? url.absoluteString).font(.subheadline).foregroundStyle(Theme.ink2)
                    if let v = info.version { Text(LF("Version %@", v)).font(.caption).foregroundStyle(Theme.ink3) }
                }
                Spacer(minLength: 0)
                Button(L("Change")) {
                    Motion.perform(Motion.quick) {
                        server = nil
                        self.info = nil
                    }
                    password = ""
                    twoStep = ""
                    needCode = nil
                    error = nil
                }
                .font(.subheadline)
            }
            .accessibilityElement(children: .combine)
        } footer: {
            if url.scheme == "http" { Text(L("Connected without https – fine in your home network, not on the way.")) }
        }
    }

    private var passwordSection: some View {
        Section {
            TextField(L("Name or e-mail"), text: $login)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focus, equals: .login)
                .submitLabel(.next)
                .onSubmit { focus = .password }
            SecureField(L("Password"), text: $password)
                .textContentType(.password)
                .focused($focus, equals: .password)
                .submitLabel(.go)
                .onSubmit { Task { await signIn() } }
            if needCode != nil {
                TextField(L("Code from your authenticator app"), text: $twoStep)
                    .textContentType(.oneTimeCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.title3.monospacedDigit())
                    .focused($focus, equals: .code)
                    .onSubmit { Task { await signIn() } }
            }
            Button {
                Task { await signIn() }
            } label: {
                HStack {
                    Text(L("Sign in")).fontWeight(.semibold)
                    Spacer()
                    if busy { ProgressView() }
                }
            }
            .disabled(login.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty || busy || (needCode != nil && twoStep.count < 6))
        } header: {
            Text(L("With your password"))
        } footer: {
            if needCode != nil {
                Text(L("Two-step sign-in is on for you: enter the 6-digit code from your authenticator app, or a recovery code."))
            } else if options?.methods?.passwordAdminsOnly == true {
                Text(L("In this household only admins sign in with a password. Everyone else: sign in in the browser below."))
            } else {
                Text(L("The name and password you use in the web app. No account yet? An admin of the household sends you an invitation link."))
            }
        }
    }

    @ViewBuilder private func browserSection(_ info: InstanceInfo) -> some View {
        if info.auth?.appPair?.bool == true {
            Section {
                Button {
                    Task { await browser() }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label(L("Sign in in the browser"), systemImage: "safari")
                        if let ways = options?.browserWays {
                            Text(LF("With %@, like in the web app.", ways)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
                .disabled(busy)
                Button { scanning = true } label: { Label(L("Scan QR code from the web app"), systemImage: "qrcode.viewfinder") }
                    .disabled(busy)
                if showCode {
                    HStack {
                        TextField(L("Code, e.g. ABCD-EFGH"), text: $pairCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.body.monospaced())
                            .focused($focus, equals: .pair)
                            .onSubmit { Task { await claim() } }
                        Button(L("Connect")) { Task { await claim() } }
                            .font(.subheadline.weight(.semibold))
                            .disabled(pairCode.filter { $0.isLetter || $0.isNumber }.count < 8 || busy)
                    }
                } else {
                    Button {
                        showCode = true
                        focus = .pair
                    } label: { Label(L("Enter a code from the web app"), systemImage: "keyboard") }
                }
            } header: {
                Text(L("Without a password"))
            } footer: {
                Text(L("The code is in the web app under Settings › Me › Sign-in & security › “Connect the iPhone app”. It works once and for 10 minutes."))
            }
        } else {
            Section {
                EmptyView()
            } footer: {
                Text(L("Signing in with a QR code or in the browser needs a newer ToHuus on the server. Your password works."))
            }
        }
    }

    private func signIn() async {
        guard let server, let info, !busy else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            let r = try await app.signInOwnServer(server: server, info: info, login: login.trimmingCharacters(in: .whitespaces),
                                                  password: password, code: needCode == nil ? nil : twoStep.trimmingCharacters(in: .whitespaces))
            if case .needCode(let m) = r {
                // asked before: the code didn't fit
                if needCode != nil { error = m.isEmpty ? L("That code didn’t work.") : m }
                needCode = m
                twoStep = ""
                focus = .code
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
            Haptics.warning()
        }
    }

    private func browser() async {
        guard let server, let info else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.signInInBrowser(server: server, info: info, runner: runner)
        } catch {
            if !BrowserSignIn.cancelled(error) { self.error = APIError.from(error).localizedDescription }
        }
    }

    private func claim() async {
        guard let server, let info else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.claimPairCode(server: server, info: info, code: pairCode, verifier: nil)
        } catch {
            self.error = APIError.from(error).localizedDescription
            Haptics.warning()
        }
    }

    private func scanned(_ text: String) async {
        guard let link = ConnectLink(text: text) else {
            // a QR code with just the address: take it as the address
            if server == nil, AppModel.normalise(text) != nil, !text.lowercased().hasPrefix("tohuus:") {
                address = text
                await check()
            } else {
                error = L("This QR code isn’t from ToHuus. In the web app: Settings › Me › Sign-in & security › “Connect the iPhone app”.")
                failure = server == nil ? error : nil
            }
            return
        }
        busy = true
        checking = true
        defer { busy = false; checking = false }
        do {
            try await app.connect(link)
        } catch {
            let m = APIError.from(error).localizedDescription
            if server == nil { failure = m } else { self.error = m }
        }
    }
}

/// A connect link that came in from outside (camera, Safari): "Mit tohuus.example.de verbinden?"
struct ConnectLinkSheet: View {
    let link: ConnectLink
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Image(systemName: "link.badge.plus")
                    .font(.system(size: 36))
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: 72, height: 72)
                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: 36))
                    .accessibilityHidden(true)
                Text(LF("Connect with %@?", link.server.host() ?? link.server.absoluteString))
                    .font(Theme.title(Theme.FontSize.h2)).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(app.phase == .signedIn
                     ? L("This iPhone signs in there too. The household you use now stays one tap away under More › Servers & households.")
                     : L("This iPhone signs in with the code from the web app. No password needed."))
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                if let error { ErrorBanner(message: error) }
                Spacer(minLength: 0)
                Button {
                    Task { await connect() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(Theme.onPrimary) }
                        Text(L("Connect"))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy)
            }
            .padding(Theme.Space.s5)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
            .canvasBackground()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func connect() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.connect(link)
            Haptics.success()
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

extension View {
    /// Shows tohuus://connect links (QR code from the web app, opened with the camera) – start screen and signed in.
    func connectLinkSheet() -> some View { modifier(ConnectLinkModifier()) }
}

private struct ConnectLinkModifier: ViewModifier {
    @State private var inbox = ConnectInbox.shared

    func body(content: Content) -> some View {
        // the links themselves arrive through ToHuusApp.handle(_:) → ConnectInbox (one onOpenURL for the whole app)
        content
            .sheet(item: Binding(get: { inbox.pending }, set: { inbox.pending = $0 })) { link in
                ConnectLinkSheet(link: link)
            }
    }
}
