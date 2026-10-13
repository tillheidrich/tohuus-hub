import SwiftUI

/// "Bons per E-Mail" (ToHuus Cloud, docs/mail-inbox.md): the household's receipt address to forward shop mails to.
/// Hidden until the cloud has a receipt domain; without Plus a short hint instead of the address.
struct MailAddressSection: View {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @State private var info: Info?
    @State private var copied = false

    struct Info: Decodable, Sendable {
        var available: Bool
        var allowed: Bool?
        var address: String?
        var stats: Stats?
        struct Stats: Decodable, Sendable {
            var days: Int
            var received: Int
            var imported: Int
        }
    }

    var body: some View {
        Group {
            if let info, info.available {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Label(L("Receipts by e-mail"), systemImage: "envelope").font(.headline)
                    if info.allowed == true, let address = info.address {
                        Text(L("Forward receipts, order and pickup confirmations to this address. Everything else is discarded at once, without being stored."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                        Text(address).font(.body.monospaced()).textSelection(.enabled)
                        Button {
                            UIPasteboard.general.string = address
                            copied = true
                            Haptics.success()
                        } label: {
                            Label(copied ? L("Copied") : L("Copy"), systemImage: copied ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        Text(L("Filter by sender, so one-time codes and other mails never leave your mailbox."))
                            .font(.caption).foregroundStyle(Theme.ink3)
                        if let s = info.stats {
                            Text(LF("Last %d days: %d received, %d became receipts", s.days, s.received, s.imported))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    } else {
                        Text(L("With Plus your household gets its own address: forward receipts, order and pickup confirmations, and ToHuus books them."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                        if app.purchasesAvailable {
                            Button(L("See plans")) { app.showPaywall = true }.buttonStyle(SecondaryButtonStyle())
                        }
                    }
                }
                .padding(Theme.Space.s4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .task { info = try? await store.api.get("api/mail/address", as: Info.self) }
    }
}
