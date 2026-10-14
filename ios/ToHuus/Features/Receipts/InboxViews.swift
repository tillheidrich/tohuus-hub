import SwiftUI

/// "Bon-Postfach" (self-hosted only, web: Retail.tsx InboxStatusCard): does the mailbox work, where to forward receipts,
/// "Check now". Hidden in ToHuus Cloud (the server answers `available: false`) – there the receipt address does the job.
struct InboxStatusCard: View {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @State private var info: InboxInfo?
    @State private var checking = false
    @State private var toast: ToastMessage?
    @State private var showSettings = false

    var body: some View {
        Group {
            if let d = info, d.available != false {
                if !d.configured {
                    if app.isAdmin {
                        Button { showSettings = true } label: {
                            HStack(alignment: .top, spacing: Theme.Space.s3) {
                                icon
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(L("Receipts by e-mail")).font(.headline).foregroundStyle(Theme.ink)
                                    Text(L("Connect a mailbox once – eBons and pickup notices then arrive here by themselves."))
                                        .font(.subheadline).foregroundStyle(Theme.ink2)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3)
                            }
                            .padding(Theme.Space.s4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    configured(d)
                }
            }
        }
        .task(id: store.revision("inbox")) { info = try? await store.api.inbox() }
        .sheet(isPresented: $showSettings, onDismiss: { store.touch("inbox") }) {
            NavigationStack {
                // Settings › Access & AI › receipt inbox (Settings/Integrations, same screen as in Settings)
                MailInboxView(api: store.api)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { showSettings = false } } }
            }
        }
        .toast($toast)
    }

    private var icon: some View {
        Image(systemName: "envelope").foregroundStyle(Theme.primaryText)
            .frame(width: 40, height: 40)
            .background(Theme.primarySoft, in: Circle())
    }

    private func configured(_ d: InboxInfo) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(alignment: .top, spacing: Theme.Space.s3) {
                icon
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Receipt inbox")).font(.headline).foregroundStyle(Theme.ink)
                    Text(d.enabled ? L("Checked every 10 minutes.") : L("Switched off – only “Check now” reads it."))
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer(minLength: 0)
                if app.isAdmin {
                    Button { showSettings = true } label: { Image(systemName: "gearshape").frame(width: 44, height: 44) }
                        .accessibilityLabel(L("Receipt inbox settings"))
                }
            }
            InboxStatusLine(status: d.status)
            Button { Task { await check() } } label: {
                HStack { if checking { ProgressView() }; Label(checking ? L("Checking …") : L("Check now"), systemImage: "arrow.clockwise") }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(checking)
            if let to = d.forwardTo {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("Forward receipts to:")).font(.subheadline).foregroundStyle(Theme.ink2)
                    HStack {
                        Text(to).font(.body.monospaced()).textSelection(.enabled).foregroundStyle(Theme.ink)
                        Spacer(minLength: 4)
                        Button {
                            UIPasteboard.general.string = to
                            Haptics.success()
                            toast = ToastMessage(text: L("Copied"))
                        } label: { Image(systemName: "doc.on.doc").frame(width: 44, height: 44) }
                            .accessibilityLabel(L("Copy address"))
                    }
                    Text(L("Tip: in the REWE, Lidl Plus or dm app you can have the eBon sent by e-mail. Use this address, or forward the mail – PDF attachments and receipt mails both work."))
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
    }

    private func check() async {
        checking = true
        defer { checking = false }
        do {
            let s = try await store.api.checkInbox()
            toast = ToastMessage(text: s.message, isError: !s.ok)
            store.touch("inbox", "imports")
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

struct InboxStatusLine: View {
    let status: InboxStatus?

    var body: some View {
        if let s = status {
            HStack(alignment: .top, spacing: Theme.Space.s2) {
                Image(systemName: s.ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                    .foregroundStyle(s.ok ? Theme.primaryText : Theme.low)
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.message).font(.subheadline).foregroundStyle(Theme.ink)
                    if let when = ServerDate.relative(s.at) { Text(LF("Last check %@", when)).font(.caption).foregroundStyle(Theme.ink3) }
                }
            }
            .padding(Theme.Space.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(s.ok ? Theme.primarySoft : Theme.lowSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .accessibilityElement(children: .combine)
        } else {
            Text(L("Not checked yet.")).font(.caption).foregroundStyle(Theme.ink3)
        }
    }
}
