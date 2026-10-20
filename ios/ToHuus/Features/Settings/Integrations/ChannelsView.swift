import SwiftUI
import UIKit

/// Settings › Notifications & calendar › For the whole household (web: pages/Channels.tsx): Telegram (two-way: linked chats, one-time links with
/// QR), Gotify and Matrix. Routing per event stays in "What goes where?" (HouseholdNotifyView).
/// API: GET /api/channels, PUT /api/channels/telegram|gotify|matrix, POST /api/channels/telegram/pair,
/// PATCH/DELETE /api/channels/telegram/chats/:id, POST /api/channels/:name/test (docs/channels.md).
struct ChannelsView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var c: JSONValue?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var busy: String?
    // Telegram
    @State private var botToken = ""
    @State private var pair: Pair?
    @State private var members: [Member] = []
    @State private var confirmDisconnect = false
    @State private var unlinking: JSONValue?
    // Gotify / Matrix forms (filled from the server, "••••" keeps a saved token)
    @State private var gotify: [String: JSONValue] = [:]
    @State private var matrix: [String: JSONValue] = [:]

    struct Pair: Identifiable {
        let id = UUID()
        var link: String
        var group: Bool
        var forName: String?
        var startCount: Int
    }

    struct Member: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
    }

    private var admin: Bool { app.isAdmin }

    var body: some View {
        List {
            Section {
                Text(L("Optional extra ways to reach the household. Each one is off until you set it up."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let c {
                telegramSections(c["telegram"] ?? .null)
                gotifySection(c["gotify"] ?? .null)
                matrixSection(c["matrix"] ?? .null)
            } else if let error {
                Section { ErrorBanner(message: error) { Task { await load() } } }
            } else {
                IxLoadingRow()
            }
        }
        .themedList()
        .navigationTitle(L("Channels"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .toast($toast)
        .sheet(item: $pair) { p in
            TelegramPairSheet(pair: p, api: api) { linked in
                pair = nil
                if linked { toast = ToastMessage(text: L("Linked")) }
                Task { await load() }
            }
            .presentationDetents([.large])
        }
        .confirmationDialog(L("Disconnect the bot?"), isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button(L("Disconnect bot"), role: .destructive) { Task { await putTelegram(["botToken": ""]) } }
        } message: {
            Text(L("Disconnect the bot? Linked chats stay saved, but nothing is sent until you add a token again."))
        }
        .confirmationDialog(L("Unlink this chat?"), isPresented: Binding(get: { unlinking != nil }, set: { if !$0 { unlinking = nil } }), titleVisibility: .visible) {
            Button(L("Unlink"), role: .destructive) {
                if let chat = unlinking { Task { await unlink(chat) } }
            }
        } message: {
            Text(L("Unlink this chat? It stops receiving messages and can no longer add things."))
        }
    }

    // MARK: Telegram

    @ViewBuilder private func telegramSections(_ s: JSONValue) -> some View {
        let configured = s["configured"]?.bool ?? false
        let enabled = s["enabled"]?.bool ?? false
        let chats = s["chats"]?.array ?? []
        Section {
            if configured && admin {
                Toggle(isOn: Binding(get: { enabled }, set: { v in Task { await putTelegram(["enabled": v]) } })) {
                    Label(L("Telegram on"), systemImage: "paperplane")
                }
                .tint(Theme.primary)
            }
            if !configured {
                if admin {
                    Text(L("In Telegram, open @BotFather and send /newbot. Pick any name, e.g. “Our home”.")).font(.subheadline)
                    Text(L("BotFather replies with a token like 123456:ABC… – paste it here.")).font(.subheadline)
                    Text(L("Then link each person (and, if you like, a family group) with a one-time link.")).font(.subheadline)
                    SecureField(L("Bot token"), text: $botToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                    Button {
                        Task { await putTelegram(["botToken": botToken.trimmingCharacters(in: .whitespaces), "enabled": true], connecting: true) }
                    } label: {
                        HStack { Text(busy == "telegram" ? L("Checking …") : L("Connect bot")); if busy == "telegram" { Spacer(); ProgressView() } }
                    }
                    .disabled(busy != nil || botToken.trimmingCharacters(in: .whitespaces).count < 20)
                } else {
                    Text(L("An admin can set up a Telegram bot here. Afterwards you can link your own Telegram."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
            } else {
                if enabled, let err = s["status"]?["lastError"]?.string, !err.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L("Telegram is not reachable right now")).font(.subheadline.weight(.semibold))
                        Text(err).font(.caption.monospaced())
                    }
                    .foregroundStyle(Theme.low)
                }
                Button { Task { await makeLink(group: false, userId: nil, forName: nil, chats: chats.count) } } label: {
                    Label(L("Link my Telegram"), systemImage: "link")
                }
                .disabled(!enabled)
                if admin {
                    Button { Task { await makeLink(group: true, userId: nil, forName: nil, chats: chats.count) } } label: {
                        Label(L("Link a family group"), systemImage: "person.3")
                    }
                    .disabled(!enabled)
                    if members.count > 1 {
                        Menu {
                            ForEach(members) { m in
                                Button(m.name) { Task { await makeLink(group: false, userId: m.id, forName: m.name, chats: chats.count) } }
                            }
                        } label: {
                            Label(L("Link for someone else …"), systemImage: "person.badge.plus")
                        }
                        .disabled(!enabled)
                    }
                }
            }
        } header: {
            Text("Telegram")
        } footer: {
            if !configured {
                Text(L("Two-way: notifications with buttons, add to the list by chat, send receipts."))
            } else if let name = s["botName"]?.string, !name.isEmpty {
                Text("@\(name) · " + (chats.count == 1 ? L("1 linked chat") : LF("%d linked chats", chats.count)))
            }
        }

        if configured {
            Section {
                if chats.isEmpty {
                    Text(L("No chat linked yet.")).foregroundStyle(Theme.ink3)
                }
                ForEach(Array(chats.enumerated()), id: \.offset) { _, chat in
                    chatRow(chat)
                }
            } header: {
                Text(L("Linked chats"))
            } footer: {
                Text(L("The switch decides whether a chat gets notifications. Adding to the list works either way."))
            }
            if admin {
                Section {
                    if s["webhookAvailable"]?.bool == true {
                        Picker(L("How messages arrive"), selection: Binding(get: { s["mode"]?.string ?? "polling" }, set: { v in Task { await putTelegram(["mode": v]) } })) {
                            Text(L("Server asks (works everywhere)")).tag("polling")
                            Text(L("Webhook (https)")).tag("webhook")
                        }
                    }
                    Text(statusText(s["status"] ?? .null)).font(.footnote).foregroundStyle(Theme.ink3)
                    Button { Task { await test("telegram", emptyHint: L("No linked chat answered – link a chat first")) } } label: {
                        Label(L("Send a test"), systemImage: "bell.badge")
                    }
                    .disabled(!enabled)
                    Button(L("Disconnect bot"), role: .destructive) { confirmDisconnect = true }
                } header: {
                    Text(L("More"))
                } footer: {
                    Text(L("In groups, Telegram only passes commands to bots. Add things there with /kaufen."))
                }
            }
        }
    }

    private func chatRow(_ chat: JSONValue) -> some View {
        let group = chat["kind"]?.string == "group"
        let title = group ? (chat["title"]?.string ?? L("Group")) : (chat["user_name"]?.string ?? L("Former member"))
        var sub = group ? L("Group") : (chat["title"]?.string ?? L("Private chat"))
        if (chat["fails"]?.int ?? 0) > 0 { sub += " · " + L("last message failed") }
        return Toggle(isOn: Binding(get: { chat["notify"]?.bool ?? false }, set: { v in Task { await setNotify(chat, v) } })) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    Text(sub).font(.caption).foregroundStyle(Theme.ink3)
                }
            } icon: {
                Image(systemName: group ? "person.3" : "paperplane")
            }
        }
        .tint(Theme.primary)
        .accessibilityHint(L("Notifications to this chat"))
        .swipeActions {
            Button(role: .destructive) { unlinking = chat } label: { Label(L("Unlink"), systemImage: "trash") }
        }
        .contextMenu {
            Button(role: .destructive) { unlinking = chat } label: { Label(L("Unlink"), systemImage: "trash") }
        }
    }

    private func statusText(_ st: JSONValue) -> String {
        switch st["mode"]?.string {
        case "off": return L("Not receiving messages.")
        case "webhook": return L("Receiving messages by webhook.")
        default:
            if let r = ServerDate.relative(st["lastPollAt"]?.string) { return LF("Receiving messages – last check %@.", r) }
            return L("Starting …")
        }
    }

    // MARK: Gotify

    @ViewBuilder private func gotifySection(_ s: JSONValue) -> some View {
        Section {
            if admin {
                Toggle(isOn: Binding(get: { s["enabled"]?.bool ?? false }, set: { v in
                    gotify["enabled"] = .bool(v)
                    Task { await saveGotify() }
                })) { Label(L("Gotify on"), systemImage: "bell") }
                .tint(Theme.primary)
            }
            if s["enabled"]?.bool == true || admin {
                labeledField(L("Server address"), gotifyField("url"), "https://gotify.example.de")
                secureField(L("App token"), gotifyField("appToken"), "A…")
                DisclosureGroup(L("Priority per event")) {
                    ForEach(HouseholdNotifyView.events) { ev in
                        Picker(ev.label, selection: Binding(get: { nearest(gotify["priorities"]?[ev.key]?.int ?? 5) }, set: { v in
                            var p = gotify["priorities"]?.object ?? [:]
                            p[ev.key] = .number(Double(Int(v) ?? 5))
                            gotify["priorities"] = .object(p)
                        })) {
                            Text(L("Quiet")).tag("2")
                            Text(L("Normal")).tag("5")
                            Text(L("Important")).tag("8")
                        }
                        .font(.subheadline)
                        .disabled(!admin)
                    }
                }
                if admin {
                    Button(L("Save")) { Task { await saveGotify() } }
                    Button(L("Send a test")) { Task { await test("gotify") } }.disabled(s["ready"]?.bool != true)
                }
            }
        } header: {
            Text("Gotify")
        } footer: {
            Text(s["enabled"]?.bool == true
                 ? (s["ready"]?.bool == true ? L("In Gotify: Apps › Create application, then copy its token. “Important” pops up on screen in the Gotify Android app.") : L("On, but not complete"))
                 : L("Self-hosted push to the Gotify app."))
        }
    }

    private func nearest(_ n: Int) -> String { n <= 3 ? "2" : n >= 7 ? "8" : "5" }

    // MARK: Matrix

    @ViewBuilder private func matrixSection(_ s: JSONValue) -> some View {
        Section {
            if admin {
                Toggle(isOn: Binding(get: { s["enabled"]?.bool ?? false }, set: { v in
                    matrix["enabled"] = .bool(v)
                    Task { await saveMatrix() }
                })) { Label(L("Matrix on"), systemImage: "bubble.left.and.bubble.right") }
                .tint(Theme.primary)
            }
            if s["enabled"]?.bool == true || admin {
                labeledField(L("Homeserver"), matrixField("homeserver"), "https://matrix.example.org")
                secureField(L("Access token"), matrixField("accessToken"), "syt_…")
                labeledField(L("Room"), matrixField("roomId"), "!abc123:example.org / #family:example.org")
                if admin {
                    Button(L("Save")) { Task { await saveMatrix() } }
                    Button(L("Send a test")) { Task { await test("matrix") } }.disabled(s["ready"]?.bool != true)
                }
            }
        } header: {
            Text("Matrix")
        } footer: {
            Text(s["enabled"]?.bool == true
                 ? L("Best a separate account for the house. In Element: Settings › Help & About › Access token. Invite that account to the room. Matrix only sends. Answers in the room are not read.")
                 : L("Messages into a Matrix room (Element and others)."))
        }
    }

    // MARK: fields

    private func gotifyField(_ key: String) -> Binding<String> {
        Binding(get: { gotify[key]?.string ?? "" }, set: { gotify[key] = .string($0) })
    }

    private func matrixField(_ key: String) -> Binding<String> {
        Binding(get: { matrix[key]?.string ?? "" }, set: { matrix[key] = .string($0) })
    }

    private func labeledField(_ title: String, _ value: Binding<String>, _ placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(Theme.ink3)
            TextField(placeholder, text: value)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(!admin)
        }
    }

    private func secureField(_ title: String, _ value: Binding<String>, _ placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(Theme.ink3)
            SecureField(placeholder, text: value)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.body.monospaced())
                .disabled(!admin)
        }
    }

    // MARK: actions

    private func load() async {
        do {
            let v = try await api.ixRaw("api/channels")
            c = v
            gotify = v["gotify"]?.object ?? [:]
            matrix = v["matrix"]?.object ?? [:]
            error = nil
            if admin, members.isEmpty {
                members = (try? await api.get("api/shop/members", as: Lossy<Member>.self).wrappedValue) ?? []
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func putTelegram(_ body: [String: Any], connecting: Bool = false) async {
        busy = "telegram"
        defer { busy = nil }
        do {
            let r = try await api.ixRawSend("PUT", "api/channels/telegram", json: body)
            if connecting {
                botToken = ""
                toast = ToastMessage(text: LF("Connected to @%@", r["botName"]?.string ?? "bot"))
            }
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func makeLink(group: Bool, userId: Int?, forName: String?, chats: Int) async {
        var body: [String: Any] = [:]
        if group { body["group"] = true }
        if let userId { body["user_id"] = userId }
        do {
            let r = try await api.ixRawSend("POST", "api/channels/telegram/pair", json: body)
            guard let link = r["link"]?.string else { return }
            pair = Pair(link: link, group: r["kind"]?.string == "group", forName: forName, startCount: chats)
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func setNotify(_ chat: JSONValue, _ on: Bool) async {
        guard let id = chat["id"]?.int else { return }
        do {
            _ = try await api.ixRawSend("PATCH", "api/channels/telegram/chats/\(id)", json: ["notify": on])
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func unlink(_ chat: JSONValue) async {
        unlinking = nil
        guard let id = chat["id"]?.int else { return }
        do {
            _ = try await api.ixRawSend("DELETE", "api/channels/telegram/chats/\(id)")
            toast = ToastMessage(text: L("Chat unlinked"))
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func saveGotify() async {
        var body: [String: Any] = [:]
        if let e = gotify["enabled"]?.bool { body["enabled"] = e }
        body["url"] = gotify["url"]?.string ?? ""
        body["appToken"] = gotify["appToken"]?.string ?? ""
        if let p = gotify["priorities"] { body["priorities"] = p.ixAny }
        await putChannel("gotify", body)
    }

    private func saveMatrix() async {
        var body: [String: Any] = [:]
        if let e = matrix["enabled"]?.bool { body["enabled"] = e }
        body["homeserver"] = matrix["homeserver"]?.string ?? ""
        body["accessToken"] = matrix["accessToken"]?.string ?? ""
        body["roomId"] = matrix["roomId"]?.string ?? ""
        await putChannel("matrix", body)
    }

    private func putChannel(_ name: String, _ body: [String: Any]) async {
        do {
            _ = try await api.ixRawSend("PUT", "api/channels/\(name)", json: body)
            toast = ToastMessage(text: L("Saved"))
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            await load()
        }
    }

    private func test(_ name: String, emptyHint: String? = nil) async {
        do {
            let r = try await api.ixRawSend("POST", "api/channels/\(name)/test", json: [:])
            toast = r["ok"]?.bool == true
                ? ToastMessage(text: L("Test sent"))
                : ToastMessage(text: emptyHint ?? L("The channel did not accept the message – check the settings"), isError: true)
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

/// One-time Telegram link: open, QR for another phone, copy. Closes by itself when the chat shows up.
struct TelegramPairSheet: View {
    let pair: ChannelsView.Pair
    let api: APIClient
    let onClose: (Bool) -> Void
    @State private var copied = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(pair.group
                         ? L("Open the link, choose the family group and add the bot. That’s it.")
                         : pair.forName.map { LF("Send this link to %@. Opening it and tapping “Start” links their Telegram.", $0) }
                            ?? L("Open the link on your phone and tap “Start” in Telegram."))
                    if let u = URL(string: pair.link) {
                        Link(destination: u) { Label(L("Open Telegram"), systemImage: "arrow.up.right.square") }
                        ShareLink(item: u) { Label(L("Share link"), systemImage: "square.and.arrow.up") }
                    }
                }
                Section {
                    HStack { Spacer(); IxQRCode(text: pair.link, size: 200); Spacer() }
                        .listRowBackground(Color.clear)
                }
                Section {
                    IxCopyRow(title: L("Link"), value: pair.link) { copied = true }
                } footer: {
                    Text(copied ? L("Link copied") : L("The link works once and expires in 15 minutes."))
                }
            }
            .themedList()
            .navigationTitle(pair.group ? L("Link a family group") : (pair.forName.map { LF("Link Telegram for %@", $0) } ?? L("Link my Telegram")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { onClose(false) } } }
            .task {
                // the new chat shows up in GET /api/channels – then we are done
                for _ in 0..<300 {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if Task.isCancelled { return }
                    if let v = try? await api.ixRaw("api/channels"), (v["telegram"]?["chats"]?.array?.count ?? 0) > pair.startCount {
                        Haptics.success()
                        onClose(true)
                        return
                    }
                }
            }
        }
    }
}
