import SwiftUI

/// "Bons per E-Mail" (ToHuus Cloud, docs/mail-inbox.md; web: MailAddress.tsx): the household's receipt address to forward
/// shop mails to, how to forward only shop mails (Gmail, Outlook, iCloud), the counters (never contents) and – for
/// admins – a new address. Hidden until the cloud has a receipt domain; without Plus a short hint instead of the address.
struct MailAddressSection: View {
    let store: ServerStore
    /// a row of its own in a List (Belege) instead of a card in a scroll view
    var inList = false
    @Environment(AppModel.self) private var app
    @State private var info: MailAddressInfo?
    @State private var copied = false
    @State private var showHow = false
    @State private var confirmRotate = false
    @State private var busy = false
    @State private var toast: ToastMessage?
    @State private var loader = LoadTrigger()

    var body: some View {
        // not a Group: .task on an empty Group never runs, the card would never load (Design/LoadSlot.swift)
        if inList {
            // a row of its own in a List (Belege), as before: no background, slim insets. No invisible view to hang
            // a .task on in a List: load from the body
            let _ = loader.run { await load() }
            if info?.available == true {
                Section { dialogs(card).toast($toast) }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
        } else {
            dialogs(LoadSlot { card }).task { await load() }.toast($toast)
        }
    }

    @ViewBuilder private var card: some View {
        if let info, info.available {
            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                Label(L("Receipts by e-mail"), systemImage: "envelope").font(.headline)
                if info.allowed == true, let address = info.address {
                    Text(L("Forward receipts, order and pickup confirmations to this address. Everything else is discarded at once, without being stored."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                    Text(address).font(.body.monospaced()).textSelection(.enabled)
                    HStack(spacing: Theme.Space.s2) {
                        Button {
                            UIPasteboard.general.string = address
                            copied = true
                            Haptics.success()
                        } label: {
                            Label(copied ? L("Copied") : L("Copy"), systemImage: copied ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        ShareLink(item: address) { Label(L("Share"), systemImage: "square.and.arrow.up") }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    DisclosureGroup(isExpanded: $showHow) {
                        VStack(alignment: .leading, spacing: 6) {
                            bullet(L("Gmail: Settings › Filters › “From” e.g. rewe.de OR lidl.de › Forward to this address (confirm the address once)."))
                            bullet(L("Outlook: Settings › Rules › “From” contains the shop › Forward to this address."))
                            bullet(L("iCloud Mail (web): Settings › Rules › “From” contains the shop › Forward to this address."))
                            bullet(L("Filter by sender, so one-time codes and other mails never leave your mailbox."))
                        }
                        .padding(.top, 6)
                    } label: {
                        Text(L("Forward automatically, only from shops")).font(.subheadline.weight(.semibold))
                    }
                    .tint(Theme.primaryText)
                    if let s = info.stats {
                        Text(LF("Last %d days: %d received, %d became receipts, %d discarded", s.days, s.received, s.imported, s.ignoredTotal))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                    if app.isAdmin {
                        Button { confirmRotate = true } label: {
                            HStack { if busy { ProgressView() }; Label(L("New address"), systemImage: "arrow.triangle.2.circlepath") }
                        }
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                        .disabled(busy)
                    }
                } else {
                    Text(L("With Plus your household gets its own address: forward receipts, order and pickup confirmations, and ToHuus books them."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                    if app.purchasesAvailable {
                        Button(L("See plans")) { app.openPaywall("mail_inbox") }.buttonStyle(SecondaryButtonStyle())
                    }
                }
            }
            .padding(Theme.Space.s4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private func load() async { info = try? await store.api.mailAddress() }

    private func dialogs(_ v: some View) -> some View {
        v.confirmationDialog(L("Create a new address?"), isPresented: $confirmRotate, titleVisibility: .visible) {
            Button(L("New address"), role: .destructive) { Task { await rotate() } }
        } message: {
            Text(L("The old one stops working at once – update your forwarding rules."))
        }
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("•").foregroundStyle(Theme.ink3)
            Text(text).font(.caption).foregroundStyle(Theme.ink2)
        }
    }

    private func rotate() async {
        busy = true
        defer { busy = false }
        do {
            try await store.api.rotateMailAddress()
            info = try? await store.api.mailAddress()
            copied = false
            toast = ToastMessage(text: L("New address created"))
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}
