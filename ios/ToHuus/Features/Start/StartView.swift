import SwiftUI

/// First screen: ToHuus Cloud (default) or own server, then sign up / sign in.
struct StartView: View {
    @Environment(AppModel.self) private var app
    @State private var path: [Step] = []
    @State private var serverText = ""
    @State private var showScanner = false
    @State private var busy = false
    @State private var error: String?

    enum Step: Hashable {
        case cloud
        case signIn(URL, String)
        case signUp
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s6) {
                    header
                    if let notice = app.notice {
                        Text(notice).font(.subheadline).foregroundStyle(Theme.info)
                            .padding(Theme.Space.s3).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.infoSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    }
                    Card(title: L("ToHuus Cloud"), systemImage: "cloud") {
                        Text(L("The easiest way: we run the server and store your household encrypted. Free to start."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                        Button(L("Continue with ToHuus Cloud")) { Task { await connectCloud() } }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(busy)
                    }
                    Card(title: L("Own server"), systemImage: "server.rack") {
                        Text(L("You run ToHuus yourself (Docker, Home Assistant). Everything is included."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                        TextField(L("Address, e.g. tohuus.example.de"), text: $serverText)
                            .textContentType(.URL)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(12)
                            .background(Theme.canvas, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.lineStrong, lineWidth: 1))
                            .onSubmit { Task { await connectOwn() } }
                        HStack(spacing: Theme.Space.s3) {
                            Button {
                                showScanner = true
                            } label: {
                                Label(L("Scan QR code"), systemImage: "qrcode.viewfinder")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                            Button(L("Connect")) { Task { await connectOwn() } }
                                .buttonStyle(SecondaryButtonStyle())
                                .disabled(serverText.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                        }
                    }
                    if busy { ProgressView().frame(maxWidth: .infinity) }
                    if let error { ErrorBanner(message: error) }
                }
                .padding(Theme.Space.s5)
            }
            .canvasBackground()
            .navigationDestination(for: Step.self) { step in
                switch step {
                case .cloud: CloudChoiceView(path: $path)
                case .signIn(let url, let mode): SignInView(server: url, mode: mode)
                case .signUp: SignUpView()
                }
            }
            .sheet(isPresented: $showScanner) {
                ScannerSheet(title: L("Scan QR code"), symbologies: [.qr]) { code in
                    serverText = code
                    Task { await connectOwn() }
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Image(systemName: "house.fill")
                .font(.system(size: 34))
                .foregroundStyle(Theme.primary)
            Text(L("Welcome to ToHuus")).font(Theme.title())
                .foregroundStyle(Theme.ink)
            Text(L("ToHuus remembers what is missing at home, what you can cook and where the money goes."))
                .font(.body).foregroundStyle(Theme.ink2)
        }
        .padding(.top, Theme.Space.s6)
    }

    private func connectCloud() async {
        busy = true
        defer { busy = false }
        error = nil
        _ = try? await app.loadInstance(SharedConfig.cloudURL)
        path.append(.cloud)
    }

    private func connectOwn() async {
        guard let url = AppModel.normalise(serverText) else {
            error = APIError.invalidURL.localizedDescription
            return
        }
        busy = true
        defer { busy = false }
        error = nil
        do {
            let info = try await app.loadInstance(url)
            path.append(.signIn(url, info.isCloud ? "cloud" : "selfhost"))
        } catch {
            self.error = L("ToHuus could not reach this server. Check the address and that the server is running.")
        }
    }
}

/// ToHuus Cloud: create a household or sign in.
struct CloudChoiceView: View {
    @Environment(AppModel.self) private var app
    @Binding var path: [StartView.Step]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Text(L("ToHuus Cloud")).font(Theme.title())
                Text(L("New here? Set up your household in a minute. Every new household gets 14 days of Plus, without payment details."))
                    .foregroundStyle(Theme.ink2)
                Button(L("Create household")) { path.append(.signUp) }
                    .buttonStyle(PrimaryButtonStyle())
                Button(L("I already have an account")) { path.append(.signIn(SharedConfig.cloudURL, "cloud")) }
                    .buttonStyle(SecondaryButtonStyle())
                if let privacy = app.instance?.legal?.privacy, let url = URL(string: privacy) {
                    Link(L("Privacy"), destination: url).font(.footnote)
                }
            }
            .padding(Theme.Space.s5)
        }
        .canvasBackground()
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct SignInView: View {
    @Environment(AppModel.self) private var app
    let server: URL
    let mode: String
    @State private var login = ""
    @State private var password = ""
    @State private var code = ""
    @State private var showCode = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Text(server.host() ?? server.absoluteString).foregroundStyle(Theme.ink2)
            } header: {
                Text(L("Server"))
            }
            Section {
                TextField(mode == "cloud" ? L("E-mail") : L("Name or e-mail"), text: $login)
                    .textContentType(.username)
                    .keyboardType(mode == "cloud" ? .emailAddress : .default)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField(L("Password"), text: $password)
                    .textContentType(.password)
                if showCode {
                    TextField(L("Code from your authenticator app"), text: $code)
                        .textContentType(.oneTimeCode)
                        .keyboardType(.numberPad)
                }
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
            } footer: {
                if mode != "cloud" {
                    Text(L("Passkeys, e-mail links and SSO work in the web app. In the app, sign in with your password."))
                }
            }
        }
        .scrollContentBackground(.hidden)
        .canvasBackground()
        .navigationTitle(L("Sign in"))
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.signIn(server: server, mode: mode, login: login.trimmingCharacters(in: .whitespaces), password: password,
                                 code: showCode ? code : nil)
        } catch let e as APIError {
            if case .server(401, let m) = e {
                error = m
                if m.lowercased().contains("code") { showCode = true }
            } else if case .notFound = e {
                error = L("This server is too old for the app. Please update ToHuus on the server.")
            } else {
                error = e.localizedDescription
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// ToHuus Cloud sign-up with the one onboarding question "Wer gehört dazu?".
struct SignUpView: View {
    @Environment(AppModel.self) private var app
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var householdName = ""
    @State private var form = "family"
    @State private var busy = false
    @State private var error: String?

    static let forms: [(String, String)] = [
        ("single", "Just me"), ("couple", "The two of us"), ("family", "Family with children"), ("wg", "Flat share"),
        ("carer", "I look after someone"),
    ]

    var body: some View {
        Form {
            Section {
                TextField(L("Your name"), text: $name).textContentType(.givenName)
                TextField(L("E-mail"), text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField(L("Password (at least 8 characters)"), text: $password).textContentType(.newPassword)
            } header: {
                Text(L("You"))
            }
            Section {
                TextField(L("Name of your household, e.g. Familie Heidrich"), text: $householdName)
                Picker(L("Who belongs to it?"), selection: $form) {
                    ForEach(Self.forms, id: \.0) { f in Text(L(f.1)).tag(f.0) }
                }
                .pickerStyle(.inline)
            } header: {
                Text(L("Household"))
            } footer: {
                Text(L("This sets what you see first. You can change it any time."))
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
                    Text(L("14 days of Plus for free, then Free unless you choose a plan. Nothing renews by itself."))
                    if let privacy = app.instance?.legal?.privacy, let url = URL(string: privacy) {
                        Link(L("Privacy"), destination: url)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .canvasBackground()
        .navigationTitle(L("Create household"))
    }

    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && email.contains("@") && password.count >= 8
            && !householdName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await app.signUp(email: email.trimmingCharacters(in: .whitespaces), password: password,
                                 name: name.trimmingCharacters(in: .whitespaces),
                                 householdName: householdName.trimmingCharacters(in: .whitespaces), form: form)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
