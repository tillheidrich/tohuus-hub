import SwiftUI

/// "Ich habe eine Einladung" (web: pages/Invite.tsx, /einladung/<token>): the invitation link from a message, pasted or
/// opened, works in the app too – ToHuus Cloud (e-mail + password, the app gets its token right away, POST
/// /api/invite/:token with client "ios") and a self-hosted server (name + password, then the normal sign-in).
struct JoinInviteView: View {
    @Environment(AppModel.self) private var app
    var initialLink = ""
    @State private var link = ""
    @State private var server: URL?
    @State private var token: String?
    @State private var info: InviteInfo?
    @State private var cloud = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var password2 = ""
    @State private var busy = false
    @State private var error: String?

    struct InviteInfo: Decodable, Sendable {
        var name: String?
        var household: String?
        var invitedBy: String?
        var message: String?
        var email: String?
        var kind: String?
        var access: String?
        var methods: Methods?
        struct Methods: Decodable, Sendable { var password: Bool? }
    }

    private var minPw: Int { cloud ? 10 : 8 }
    private var ready: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && password.count >= minPw && password == password2
            && (!cloud || email.contains("@"))
    }

    var body: some View {
        Form {
            if info == nil {
                Section {
                    TextField(L("Invitation link"), text: $link, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    PasteButton(payloadType: String.self) { s in if let first = s.first { link = first } }
                    Button(L("Open invitation")) { Task { await open() } }
                        .disabled(busy || link.trimmingCharacters(in: .whitespaces).isEmpty)
                } footer: {
                    Text(L("The link from the message, for example https://…/einladung/…"))
                }
            } else if let info {
                Section {
                    Text(LF("%@ invites you to %@.", info.invitedBy ?? L("Someone"), info.household ?? "ToHuus"))
                        .font(.headline)
                    if let m = info.message, !m.isEmpty { Text(m).foregroundStyle(Theme.ink2) }
                    if let a = info.access { LabeledContent(L("Access"), value: a) }
                }
                if !cloud && info.methods?.password == false {
                    // this server signs members in without passwords (passkey or e-mail link): join in the browser,
                    // then connect the app with "Eigener Server" (code-review 14 Oct 2026)
                    Section {
                        Text(L("This household signs in without passwords. Join in the browser with a passkey or an e-mail link, then connect the app under “Own server”."))
                        if let url = URL(string: link.trimmingCharacters(in: .whitespacesAndNewlines)) {
                            Link(destination: url) { Label(L("Continue in the browser"), systemImage: "safari") }
                        }
                    }
                } else {
                Section {
                    TextField(L("Your name"), text: $name).textContentType(.name)
                    if cloud {
                        TextField(L("E-mail"), text: $email)
                            .textContentType(.username).keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    SecureField(LF("Password (at least %d characters)", minPw), text: $password).textContentType(.newPassword)
                    SecureField(L("Repeat password"), text: $password2).textContentType(.newPassword)
                    if !password2.isEmpty && password != password2 {
                        Text(L("The passwords don’t match.")).font(.caption).foregroundStyle(Theme.empty)
                    }
                } footer: {
                    Text(cloud ? L("With an existing ToHuus account, use its e-mail and password.") : L("You sign in with this name and password on this server."))
                }
                Section {
                    Button { Task { await accept() } } label: {
                        HStack { Text(L("Join")); if busy { Spacer(); ProgressView() } }
                    }
                    .disabled(!ready || busy)
                }
                }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("Invitation"))
        .task {
            if link.isEmpty && !initialLink.isEmpty {
                link = initialLink
                await open()
            }
        }
    }

    /// https://host[/prefix]/einladung/<token> → server + token
    static func parse(_ raw: String) -> (URL, String)? {
        guard let r = raw.range(of: #"https?://[^\s"'<>]+"#, options: .regularExpression),
              let url = URL(string: String(raw[r])), let host = url.host else { return nil }
        let parts = url.pathComponents
        guard let i = parts.firstIndex(where: { $0 == "einladung" || $0 == "invite" }), i + 1 < parts.count else { return nil }
        var c = URLComponents()
        c.scheme = url.scheme
        c.host = host
        c.port = url.port
        let prefix = parts[1..<i].joined(separator: "/")
        c.path = prefix.isEmpty ? "" : "/" + prefix
        guard let base = c.url else { return nil }
        return (base, parts[i + 1])
    }

    private func open() async {
        error = nil
        guard let (base, t) = Self.parse(link) else {
            error = L("This doesn’t look like an invitation link.")
            return
        }
        busy = true
        defer { busy = false }
        do {
            let api = APIClient(baseURL: base)
            let inst = try await app.loadInstance(base)
            let enc = t.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? t
            let i = try await api.get("api/invite/\(enc)", as: InviteInfo.self)
            cloud = inst.mode == "cloud"
            server = base
            token = t
            name = i.name ?? ""
            email = i.email ?? ""
            info = i
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func accept() async {
        guard let server, let token else { return }
        busy = true
        defer { busy = false }
        error = nil
        let api = APIClient(baseURL: server)
        let enc = token.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? token
        let who = name.trimmingCharacters(in: .whitespaces)
        do {
            if cloud {
                let body: [String: Any] = ["name": who, "email": email.trimmingCharacters(in: .whitespaces), "password": password, "client": "ios", "device": AppModel.deviceName]
                let res = try await api.send("POST", "api/invite/\(enc)", json: body, as: AppAuthResponse.self)
                app.finishSignIn(server: server, mode: "cloud", response: res)
            } else {
                let body: [String: Any] = ["name": who, "method": "password", "password": password]
                _ = try await api.send("POST", "api/invite/\(enc)", json: body, as: Ignored.self)
                try await app.signIn(server: server, mode: "selfhost", login: who, password: password, code: nil)
            }
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
