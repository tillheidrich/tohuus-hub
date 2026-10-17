import SwiftUI
import UIKit

/// Settings › Receipts by e-mail. ToHuus Cloud: the household's own receipt address (web: MailAddress.tsx – copy,
/// forwarding tips, counters, new address for admins). Own server: a mailbox (IMAP) that ToHuus reads every 10 minutes
/// (web: Retail.tsx InboxSettingsCard). Each part shows only when the server offers it (`available`).
/// API: GET /api/mail/address, POST /api/mail/address/rotate, GET/PUT /api/retail/inbox, POST /api/retail/inbox/check.
struct MailInboxView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var address: JSONValue?
    @State private var inbox: JSONValue?
    @State private var loaded = false
    @State private var confirmRotate = false
    @State private var busy = false
    @State private var toast: ToastMessage?
    // IMAP form
    @State private var enabled = false
    @State private var host = ""
    @State private var port = "993"
    @State private var tls = true
    @State private var user = ""
    @State private var password = ""
    @State private var folder = "INBOX"
    @State private var moveTo = ""
    @State private var allowFrom = ""

    static let presets: [IxPair] = [
        IxPair("imap.gmx.net", "GMX"), IxPair("imap.web.de", "web.de"), IxPair("imap.gmail.com", "Gmail"),
        IxPair("outlook.office365.com", "Outlook"), IxPair("imap.mailbox.org", "mailbox.org"), IxPair("posteo.de", "Posteo"),
    ]

    private var admin: Bool { app.isAdmin }

    var body: some View {
        Form {
            if let a = address, a["available"]?.bool == true { addressSections(a) }
            if let i = inbox, i["available"]?.bool != false { inboxSections(i) }
            if loaded && address?["available"]?.bool != true && (inbox == nil || inbox?["available"]?.bool == false) {
                Section {
                    EmptyStateView(systemImage: "envelope", title: L("Not available on this server"),
                                   message: L("Receipts by e-mail need a receipt address in ToHuus Cloud or a mailbox on your own server."))
                }
            }
            if !loaded { IxLoadingRow() }
        }
        .themedList()
        .navigationTitle(L("Receipts by e-mail"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .toast($toast)
        .confirmationDialog(L("New address?"), isPresented: $confirmRotate, titleVisibility: .visible) {
            Button(L("New address"), role: .destructive) { Task { await rotate() } }
        } message: {
            Text(L("Create a new address? The old one stops working at once – update your forwarding rules."))
        }
    }

    // MARK: cloud address

    @ViewBuilder private func addressSections(_ a: JSONValue) -> some View {
        if a["allowed"]?.bool == true, let addr = a["address"]?.string {
            Section {
                IxCopyRow(title: L("Your receipt address"), value: addr) { toast = ToastMessage(text: L("Copied")) }
                ShareLink(item: addr) { Label(L("Share"), systemImage: "square.and.arrow.up") }
                if let s = a["stats"], !s.isNull {
                    let ignored = (s["ignored"]?.object ?? [:]).values.compactMap(\.int).reduce(0, +)
                    Text(LF("Last %d days: %d received, %d became receipts, %d discarded", s["days"]?.int ?? 30, s["received"]?.int ?? 0, s["imported"]?.int ?? 0, ignored))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
                if admin {
                    Button(L("New address"), role: .destructive) { confirmRotate = true }.disabled(busy)
                }
            } header: {
                Text(L("Receipts by e-mail"))
            } footer: {
                Text(L("Forward receipts, order and pickup confirmations to this address. Everything else is discarded at once, without being stored."))
            }
            Section {
                DisclosureGroup(L("Forward automatically, only from shops")) {
                    Text(L("Gmail: Settings › Filters › “From” e.g. rewe.de OR lidl.de › Forward to this address (confirm the address once).")).font(.footnote)
                    Text(L("Outlook: Settings › Rules › “From” contains the shop › Forward to this address.")).font(.footnote)
                    Text(L("iCloud Mail (web): Settings › Rules › “From” contains the shop › Forward to this address.")).font(.footnote)
                    Text(L("Filter by sender, so one-time codes and other mails never leave your mailbox.")).font(.footnote)
                }
            }
        } else {
            Section {
                Text(L("With Plus your household gets its own address: forward receipts, order and pickup confirmations, and ToHuus books them."))
                    .font(.subheadline)
                if app.purchasesAvailable {
                    Button(L("See plans")) { app.showPaywall = true }
                }
            } header: {
                Text(L("Receipts by e-mail"))
            }
        }
    }

    // MARK: own server: IMAP

    @ViewBuilder private func inboxSections(_ i: JSONValue) -> some View {
        Section {
            statusLine(i["status"] ?? .null)
            if let fwd = i["forward_to"]?.string {
                IxCopyRow(title: L("Forward receipts to:"), value: fwd) { toast = ToastMessage(text: L("Copied")) }
            }
            Button { Task { await check() } } label: {
                HStack { Label(busy ? L("Checking …") : L("Check now"), systemImage: "arrow.clockwise"); if busy { Spacer(); ProgressView() } }
            }
            .disabled(busy || i["configured"]?.bool != true)
        } header: {
            Text(L("Receipt inbox (e-mail)"))
        } footer: {
            Text(L("ToHuus Hub reads a mailbox or folder every 10 minutes and turns PDF receipts and receipt mails into imports for review. Mails are never deleted."))
        }
        if admin, let s = i["settings"], !s.isNull {
            Section {
                Toggle(L("Check automatically every 10 minutes"), isOn: $enabled).tint(Theme.primary)
                TextField(L("Mail server (IMAP)"), text: $host)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                FlowLayout(spacing: 6) {
                    ForEach(Self.presets) { p in
                        ChoiceChip(title: p.label, on: host == p.key) { host = p.key; port = "993"; tls = true }
                    }
                }
                TextField(L("Port"), text: $port).keyboardType(.numberPad)
                Toggle(L("TLS (recommended)"), isOn: $tls).tint(Theme.primary)
                TextField(L("User name / e-mail address"), text: $user)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField(s["has_password"]?.bool == true ? L("saved – leave empty to keep") : L("app password recommended"), text: $password)
            } header: {
                Text(L("Mailbox"))
            }
            Section {
                TextField("INBOX", text: $folder).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField(L("Afterwards move to (optional)"), text: $moveTo).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("rewe.de, lidl.de, dm.de", text: $allowFrom).textInputAutocapitalization(.never).autocorrectionDisabled()
            } header: {
                Text(L("Folder and senders"))
            } footer: {
                Text(L("A filter rule in your mail program can sort receipts into their own folder, e.g. “ToHuus”. Only from these senders (optional): addresses or domains, separated by commas. If you forward receipts yourself, add your own address too."))
            }
            Section {
                Button(L("Save")) { Task { await save(thenCheck: false) } }.disabled(busy)
                Button(L("Save & check now")) { Task { await save(thenCheck: true) } }
                    .disabled(busy || host.trimmingCharacters(in: .whitespaces).isEmpty || user.trimmingCharacters(in: .whitespaces).isEmpty
                              || (password.isEmpty && s["has_password"]?.bool != true))
            }
            if let recent = i["recent"]?.array, !recent.isEmpty {
                Section(L("Recent mails")) {
                    ForEach(Array(recent.enumerated()), id: \.offset) { _, m in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m["subject"]?.string ?? L("(no subject)"))
                            Text([m["from_addr"]?.string, ServerDate.shortDay(m["created_at"]?.string), resultText(m["result"] ?? .null)].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            }
        }
    }

    private func statusLine(_ s: JSONValue) -> some View {
        Group {
            if s.isNull {
                IxStatusLine(text: L("Not checked yet."), ok: nil)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    IxStatusLine(text: s["message"]?.string ?? "", ok: s["ok"]?.bool)
                    if let r = ServerDate.relative(s["at"]?.string) {
                        Text(LF("Last check %@", r)).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
    }

    private func resultText(_ r: JSONValue) -> String {
        let imports = r["imports"]?.array ?? []
        if !imports.isEmpty { return imports.contains { $0["duplicate"]?.bool != true } ? L("imported") : L("already imported") }
        return r["note"]?.string ?? L("nothing found")
    }

    // MARK: actions

    private func load() async {
        address = try? await api.ixRaw("api/mail/address")
        inbox = try? await api.ixRaw("api/retail/inbox")
        if let s = inbox?["settings"], !s.isNull {
            enabled = s["enabled"]?.bool ?? false
            host = s["host"]?.string ?? ""
            port = String(s["port"]?.int ?? 993)
            tls = s["tls"]?.bool ?? true
            user = s["user"]?.string ?? ""
            folder = s["folder"]?.string ?? "INBOX"
            moveTo = s["moveTo"]?.string ?? ""
            allowFrom = s["allowFrom"]?.ixStrings.joined(separator: ", ") ?? ""
            password = ""
        }
        loaded = true
    }

    private func rotate() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await api.ixRawSend("POST", "api/mail/address/rotate", json: [:])
            toast = ToastMessage(text: L("New address created"))
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func save(thenCheck: Bool) async {
        busy = true
        var body: [String: Any] = [
            "enabled": enabled,
            "host": host.trimmingCharacters(in: .whitespaces),
            "port": Int(port) ?? 993,
            "tls": tls,
            "user": user.trimmingCharacters(in: .whitespaces),
            "folder": folder.trimmingCharacters(in: .whitespaces).isEmpty ? "INBOX" : folder.trimmingCharacters(in: .whitespaces),
            "allowFrom": allowFrom.split(whereSeparator: { ",; \n".contains($0) }).map(String.init).filter { !$0.isEmpty },
        ]
        let mv = moveTo.trimmingCharacters(in: .whitespaces)
        body["moveTo"] = mv.isEmpty ? NSNull() as Any : mv as Any
        if !password.isEmpty { body["password"] = password }
        do {
            _ = try await api.ixRawSend("PUT", "api/retail/inbox", json: body)
            busy = false
            if thenCheck { await check() } else { toast = ToastMessage(text: L("Saved")) }
            await load()
        } catch {
            busy = false
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func check() async {
        busy = true
        defer { busy = false }
        do {
            let s = try await api.ixRawSend("POST", "api/retail/inbox/check", json: [:], timeout: 90)
            toast = ToastMessage(text: s["message"]?.string ?? L("Checked"), isError: s["ok"]?.bool == false)
            inbox = try? await api.ixRaw("api/retail/inbox")
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}
