import CoreImage.CIFilterBuiltins
import SwiftUI

/// Invite someone (admins): name and e-mail optional, member / admin / guest, a few words. Without e-mail the link is
/// passed on through the share sheet or shown as a QR code. Open invitations: new link, send again, withdraw.
struct InvitesView: View {
    let api: APIClient
    @State private var items: [InviteItem] = []
    @State private var options: InviteOptions?
    @State private var showNew = false
    @State private var link: InviteLink?
    @State private var error: String?
    @State private var busy: Int?
    @State private var toast: ToastMessage?

    var body: some View {
        List {
            Section {
                Button { showNew = true } label: { Label(L("Invite someone"), systemImage: "person.badge.plus").font(.body.weight(.semibold)) }
            } footer: {
                Text(LF("They get a personal link and choose how to sign in themselves – passkey, password or e-mail link. The link works once and for %d days.", options?.days ?? 7))
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            if !items.isEmpty {
                Section(L("Invitations")) { ForEach(items) { row($0) } }
            }
        }
        .themedList()
        .navigationTitle(L("Invitations"))
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showNew) {
            NewInviteSheet(api: api, mail: options?.mail == true) { l in
                link = l
                Task { await load() }
            }
        }
        .sheet(item: $link) { l in InviteLinkSheet(link: l) }
        .toast($toast)
    }

    private func row(_ i: InviteItem) -> some View {
        let who = i.name ?? i.email ?? L("Someone new")
        let open = i.status == "pending" || i.status == "expired"
        return VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(spacing: Theme.Space.s3) {
                AvatarView(name: who, color: i.color, size: 36, api: api)
                VStack(alignment: .leading, spacing: 2) {
                    Text(who).font(.body)
                    Text(access(i) + " · " + status(i)).font(.caption).foregroundStyle(Theme.ink3)
                    if let e = i.email, i.name != nil { Text(e).font(.caption).foregroundStyle(Theme.ink3) }
                }
                Spacer()
                if busy == i.id { ProgressView() }
            }
            if open {
                HStack(spacing: Theme.Space.s2) {
                    if options?.mail == true, i.email != nil {
                        Button(L("Send again")) { Task { await renew(i, deliver: "email") } }
                    }
                    Button(L("New link")) { Task { await renew(i, deliver: "link") } }
                    if i.status == "pending" {
                        Button(L("Withdraw"), role: .destructive) { Task { await revoke(i) } }
                    }
                }
                .buttonStyle(.bordered)
                .font(.caption.weight(.semibold))
                .disabled(busy != nil)
            }
        }
        .padding(.vertical, 4)
    }

    private func access(_ i: InviteItem) -> String {
        if i.kind == "guest" { return L("Guest") + " · " + InviteLevels.title(i.guestLevel ?? "order") }
        return i.role == "admin" ? L("Admin") : L("Member")
    }

    private func status(_ i: InviteItem) -> String {
        let until = ServerDate.parse(i.expiresAt)?.formatted(.dateTime.day().month(.wide)) ?? ""
        switch i.status {
        case "used": return LF("Joined as %@", i.usedByName ?? i.name ?? "")
        case "revoked": return L("Withdrawn")
        case "expired": return LF("Expired on %@", until)
        default: return i.sentAt != nil ? LF("E-mail sent · valid until %@", until) : LF("Waiting · valid until %@", until)
        }
    }

    private func load() async {
        do {
            async let o = api.inviteOptions()
            async let l = api.invites()
            options = try? await o
            items = try await l
            error = nil
        } catch APIError.server(let status, _) where status == 403 {
            error = L("Only admins can invite someone.")
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func renew(_ i: InviteItem, deliver: String) async {
        busy = i.id
        defer { busy = nil }
        do {
            var r = try await api.renewInvite(i.id, deliver: deliver)
            r.forName = i.name ?? i.email
            if deliver == "email" { toast = ToastMessage(text: LF("Sent again to %@", r.email ?? i.email ?? "")) } else { link = r }
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func revoke(_ i: InviteItem) async {
        busy = i.id
        defer { busy = nil }
        do {
            try await api.revokeInvite(i.id)
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

enum InviteLevels {
    static let all = ["order", "stock", "recipes", "family"]
    static func title(_ k: String) -> String {
        switch k {
        case "stock": return L("+ Stock")
        case "recipes": return L("+ Recipes")
        case "family": return L("Like family")
        default: return L("Treats & shopping list")
        }
    }
    static func help(_ k: String) -> String {
        switch k {
        case "stock": return L("Also sees the stock and where things are.")
        case "recipes": return L("Also sees recipes, the week plan and votes.")
        case "family": return L("Everything day to day – but no settings, spending or backups.")
        default: return L("Can ask for treats from the menu and add to the shopping list.")
        }
    }
}

struct NewInviteSheet: View {
    let api: APIClient
    let mail: Bool
    let onCreated: (InviteLink) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var access = "member"
    @State private var level = "order"
    @State private var message = ""
    @State private var send = true
    @State private var busy = false
    @State private var error: String?

    private var emailOk: Bool { email.range(of: #"^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$"#, options: .regularExpression) != nil }
    private var emailBad: Bool { !email.trimmingCharacters(in: .whitespaces).isEmpty && !emailOk }
    private var willMail: Bool { mail && emailOk && send }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("e.g. Sam"), text: $name).textContentType(.name)
                } header: { Text(L("Name (optional)")) } footer: { Text(L("Leave it empty and they type their own name.")) }
                Section {
                    TextField(L("name@example.org"), text: $email)
                        .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    if mail && emailOk { Toggle(L("Send the invitation by e-mail now"), isOn: $send) }
                } header: { Text(L("E-mail (optional)")) } footer: {
                    if emailBad { Text(L("That doesn’t look like an e-mail address.")).foregroundStyle(Theme.empty) }
                    else if !mail { Text(L("This server can’t send e-mail. You get a link to pass on instead.")) }
                }
                Section {
                    Picker(L("Access"), selection: $access) {
                        Text(L("Member")).tag("member")
                        Text(L("Admin")).tag("admin")
                        Text(L("Guest")).tag("guest")
                    }
                    .pickerStyle(.segmented)
                    if access == "guest" {
                        Picker(L("What may they see?"), selection: $level) {
                            ForEach(InviteLevels.all, id: \.self) { Text(InviteLevels.title($0)).tag($0) }
                        }
                    }
                } header: { Text(L("Access")) } footer: {
                    Text(access == "admin" ? L("Admins can also change settings, members and backups.")
                         : access == "guest" ? L("For the aunt, the babysitter or a flatmate’s partner: sees only what you allow.") + " " + InviteLevels.help(level)
                         : L("Members can use everything day to day, but not change settings."))
                }
                Section(L("A few words (optional)")) {
                    TextField(L("e.g. Here’s our shopping list app – see you on Sunday!"), text: $message, axis: .vertical).lineLimit(2...4)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Invite someone"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(willMail ? L("Send") : L("Create link")) { Task { await create() } }
                        .disabled(busy || emailBad)
                }
            }
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        let n = name.trimmingCharacters(in: .whitespaces)
        let e = email.trimmingCharacters(in: .whitespaces)
        let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            var r = try await api.createInvite(name: n.isEmpty ? nil : n, email: e.isEmpty ? nil : e,
                                               role: access == "admin" ? "admin" : "member", kind: access == "guest" ? "guest" : "member",
                                               guestLevel: access == "guest" ? level : nil, message: m.isEmpty ? nil : m, send: willMail)
            r.forName = n.isEmpty ? (e.isEmpty ? nil : e) : n
            dismiss()
            onCreated(r)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// The link to pass on: QR code, share sheet, copy. Shown only now.
struct InviteLinkSheet: View {
    let link: InviteLink
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Space.s4) {
                    if link.sent == true, let e = link.email {
                        Label(LF("The invitation is on its way to %@. You can also pass on the link yourself:", e), systemImage: "envelope")
                            .font(.subheadline)
                            .padding(Theme.Space.s3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    }
                    if let qr = QRCode.image(link.url) {
                        Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                            .frame(width: 220, height: 220)
                            .padding(Theme.Space.s3)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            .accessibilityLabel(L("QR code of the invitation link"))
                    }
                    Text(link.url).font(.caption.monospaced()).foregroundStyle(Theme.ink3).multilineTextAlignment(.center).textSelection(.enabled)
                    ShareLink(item: link.url,
                              subject: Text(L("Invitation")),
                              message: Text(L("Join our household app – pick how you want to sign in here:"))) {
                        Label(L("Share link"), systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button {
                        UIPasteboard.general.string = link.url
                        copied = true
                    } label: { Label(copied ? L("Link copied") : L("Copy link"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                        .buttonStyle(SecondaryButtonStyle())
                    if let d = ServerDate.parse(link.expiresAt) {
                        Text(LF("Scan with the phone, or send the link. Valid until %@, works once. It is shown only now.", d.formatted(.dateTime.day().month(.wide))))
                            .font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                    }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(link.forName.map { LF("Invitation for %@", $0) } ?? L("Invitation"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
        }
    }
}

enum QRCode {
    static func image(_ text: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
