import SwiftUI

/// "Mit Claude oder ChatGPT verbinden" (web: AiSettings.tsx ConnectAssistantCard): the MCP address with OAuth sign-in
/// and this person's own connections (GET/DELETE /api/oauth/connections). Each connection belongs to the person who
/// signed in with it – nobody else sees it.
struct ConnectAssistantView: View {
    let api: APIClient
    @State private var data: OAuthConnections?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var ending: OAuthConnections.Connection?
    @State private var showEnd = false

    var body: some View {
        List {
            Section {
                Text(L("Your assistant can then see the list and what is at home, and put things on the list – in your name."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                if data?.mcp == false {
                    Label(L("MCP access is switched off for this household."), systemImage: "exclamationmark.triangle")
                        .font(.subheadline).foregroundStyle(Theme.warning)
                }
            }
            if let url = data?.mcpUrl {
                Section {
                    Text(url).font(.footnote.monospaced()).textSelection(.enabled)
                    Button {
                        UIPasteboard.general.string = url
                        toast = ToastMessage(text: L("Copied"))
                    } label: { Label(L("Copy address"), systemImage: "doc.on.doc") }
                    ShareLink(item: url) { Label(L("Share"), systemImage: "square.and.arrow.up") }
                } header: {
                    Text(L("Address for the assistant"))
                }
                Section {
                    step(1, L("Claude: Settings › Connectors › Add custom connector. ChatGPT: Settings › Connectors › Create (developer mode)."))
                    step(2, L("Paste the address. Authentication: OAuth (Claude finds it by itself)."))
                    step(3, L("Sign in to ToHuus, choose what the assistant may do, confirm."))
                } header: {
                    Text(L("How to connect"))
                }
            }
            Section {
                ForEach(data?.connections ?? []) { c in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.client ?? L("Assistant"))
                        Text(sub(c)).font(.caption).foregroundStyle(Theme.ink3)
                    }
                    .swipeActions {
                        Button(role: .destructive) { ending = c; showEnd = true } label: { Label(L("End connection"), systemImage: "xmark") }
                    }
                }
                if let d = data, d.connections.isEmpty {
                    Text(L("No assistant connected yet.")).foregroundStyle(Theme.ink3)
                }
            } header: {
                Text(L("Your connections"))
            } footer: {
                if !(data?.connections.isEmpty ?? true) { Text(L("Swipe to end a connection.")) }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("Connect with Claude or ChatGPT"))
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
        .confirmationDialog(L("End this connection?"), isPresented: $showEnd, titleVisibility: .visible, presenting: ending) { c in
            Button(L("End connection"), role: .destructive) { Task { await end(c) } }
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s3) {
            Text("\(n)").font(.subheadline.weight(.bold)).foregroundStyle(Theme.primaryText).frame(width: 18)
            Text(text).font(.subheadline)
        }
        .accessibilityElement(children: .combine)
    }

    private func sub(_ c: OAuthConnections.Connection) -> String {
        var parts = [c.scopes.contains("mcp:write") ? L("Read and change") : L("Read")]
        if c.scopes.contains("mcp:health") { parts.append(L("Allergies and children’s details")) }
        parts.append(c.lastUsedAt.flatMap { ServerDate.relative($0) }.map { LF("last used %@", $0) } ?? L("never used"))
        return parts.joined(separator: " · ")
    }

    private func load() async {
        do {
            data = try await api.get("api/oauth/connections", as: OAuthConnections.self)
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func end(_ c: OAuthConnections.Connection) async {
        do {
            _ = try await api.send("DELETE", "api/oauth/connections/\(c.id)", as: Ignored.self)
            toast = ToastMessage(text: L("Connection ended"))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// Zugänge (admins, web: Settings › Zugang & KI › "Neuer Zugang" / "Aktive Zugänge"): access keys for an AI assistant
/// (MCP), Home Assistant or a script with full API access. Shown once, stored hashed, revocable.
/// GET/POST /api/tokens, DELETE /api/tokens/:id. App sign-ins are not listed here (they are the members' own).
struct AccessTokensView: View {
    let api: APIClient
    @State private var tokens: [AccessToken] = []
    @State private var baseUrl: String?
    @State private var name = "Claude"
    @State private var scope = "mcp"
    @State private var created: (name: String, token: String, scope: String)?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var revoking: AccessToken?
    @State private var showRevoke = false
    @State private var busy = false

    private var base: String {
        var b = baseUrl ?? api.baseURL.absoluteString
        while b.hasSuffix("/") { b.removeLast() }
        return b
    }

    var body: some View {
        List {
            if let c = created {
                Section {
                    if c.scope != "ha" { secret(L("MCP address (URL for Claude / ChatGPT)"), "\(base)/mcp/\(c.token)") }
                    secret(L("Token (for Authorization: Bearer …)"), c.token)
                    if c.scope == "ha" {
                        secret(L("Address for the integration"), base)
                        Text(L("Paste address and token into Home Assistant › Add integration › ToHuus Hub."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                    Button(L("Done")) { created = nil }
                } header: {
                    Text(LF("%@: copy it now – shown only once", c.name))
                }
            } else {
                Section {
                    Picker(L("For"), selection: $scope) {
                        Text(L("AI assistant")).tag("mcp")
                        Text("Home Assistant").tag("ha")
                        Text(L("Full API access")).tag("full")
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: scope) { _, v in name = v == "ha" ? "Home Assistant" : v == "mcp" ? "Claude" : L("Script") }
                    TextField(L("Name, e.g. Claude Sam"), text: $name)
                    Button {
                        Task { await create() }
                    } label: {
                        HStack { Label(L("Generate"), systemImage: "key"); if busy { Spacer(); ProgressView() } }
                    }
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                } header: {
                    Text(L("New access"))
                } footer: {
                    Text(scope == "full" ? L("Full API access can do everything an admin can. Only for your own scripts.")
                                         : L("Easier for Claude and ChatGPT: “Connect with Claude or ChatGPT” signs in with OAuth, no key needed."))
                }
            }
            Section {
                ForEach(tokens) { t in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t.name ?? "–")
                        Text(sub(t)).font(.caption.monospaced()).foregroundStyle(Theme.ink3)
                    }
                    .swipeActions {
                        Button(role: .destructive) { revoking = t; showRevoke = true } label: { Label(L("Revoke"), systemImage: "xmark") }
                    }
                }
                if tokens.isEmpty { Text(L("No access yet.")).foregroundStyle(Theme.ink3) }
            } header: {
                Text(L("Active access"))
            } footer: {
                if !tokens.isEmpty { Text(L("Swipe to revoke an access.")) }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("Access keys"))
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
        .onDisappear { created = nil }
        .confirmationDialog(L("Revoke access?"), isPresented: $showRevoke, titleVisibility: .visible, presenting: revoking) { t in
            Button(L("Revoke"), role: .destructive) { Task { await revoke(t) } }
        } message: { _ in
            Text(L("Whatever uses this key stops working right away."))
        }
    }

    private func sub(_ t: AccessToken) -> String {
        let kind = t.scope == "mcp" ? L("AI assistant") : t.scope == "ha" ? "Home Assistant" : "API"
        let used = t.lastUsedAt.flatMap { ServerDate.relative($0) }.map { LF("last used %@", $0) } ?? L("never used")
        return "\(t.prefix ?? "")… · \(kind) · \(used)"
    }

    private func secret(_ title: String, _ value: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).foregroundStyle(Theme.ink3)
                Text(value).font(.footnote.monospaced()).textSelection(.enabled)
            }
            Spacer()
            Button {
                // local only, gone after ten minutes – it is a key
                UIPasteboard.general.setItems([["public.utf8-plain-text": value]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(600)])
                toast = ToastMessage(text: L("Copied"))
            } label: { Image(systemName: "doc.on.doc") }
            .buttonStyle(.borderless)
            .accessibilityLabel(LF("Copy %@", title))
        }
    }

    private func load() async {
        do {
            tokens = try await api.get("api/tokens", as: Lossy<AccessToken>.self).wrappedValue
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
        if baseUrl == nil { baseUrl = (try? await api.householdSettings())?.baseUrl }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        let n = String(name.trimmingCharacters(in: .whitespaces).prefix(60))
        do {
            let r = try await api.send("POST", "api/tokens", json: ["name": n, "scope": scope], as: CreatedToken.self)
            created = (n, r.token, scope)
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func revoke(_ t: AccessToken) async {
        do {
            _ = try await api.send("DELETE", "api/tokens/\(t.id)", as: Ignored.self)
            toast = ToastMessage(text: L("Access revoked"))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}
