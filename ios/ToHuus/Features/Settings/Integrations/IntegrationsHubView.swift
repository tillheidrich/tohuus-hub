import SwiftUI

/// Mehr › Connections: everything ToHuus talks to outside the app – Home Assistant, displays, printers & tickets,
/// Telegram/Gotify/Matrix, receipts by e-mail, Cookidoo. One place instead of the web's tabs
/// (Settings › Home Assistant, Displays, Printers & tickets, Access & AI). Permanent guests never get here.
struct IntegrationsHubView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var haState: String?
    @State private var displays: Int?
    @State private var printers: Int?

    var body: some View {
        List {
            Section {
                NavigationLink { HomeAssistantView(api: api) } label: {
                    row("Home Assistant", L("Shopping list, meal plan, care tasks, who is home, NFC tags"), "house", haState)
                }
                NavigationLink { CookidooView(api: api) } label: {
                    row("Cookidoo", L("The Cookidoo week into the meal plan"), "fork.knife", nil)
                }
            } header: {
                Text(L("Smart home"))
            }
            Section {
                NavigationLink { DisplaysView(api: api) } label: {
                    row(L("Displays"), L("Kitchen and hallway screens, e-ink frames"), "display", displays.map { $0 == 1 ? L("1 display") : LF("%d displays", $0) })
                }
                NavigationLink { PrintersView(api: api) } label: {
                    row(L("Printers & tickets"), L("Shopping slips, week plan and notes on paper"), "printer", printerBadge)
                }
            } header: {
                Text(L("Screens & paper"))
            }
            Section {
                NavigationLink { ChannelsView(api: api) } label: {
                    row(L("Telegram, Gotify & Matrix"), L("Messages to chats, add to the list by chat"), "paperplane", nil)
                }
                NavigationLink { MailInboxView(api: api) } label: {
                    row(L("Receipts by e-mail"), app.isCloud ? L("Your household's own receipt address") : L("A mailbox ToHuus reads every 10 minutes"), "envelope", nil)
                }
                NavigationLink { HouseholdNotifyView(api: api) } label: {
                    row(L("Webhooks, ntfy & e-mail"), L("What goes where for the whole household"), "point.3.connected.trianglepath.dotted", nil)
                }
            } header: {
                Text(L("Messages"))
            }
        }
        .themedList()
        .navigationTitle(L("Connections"))
        .task { await load() }
    }

    private var printerBadge: String? {
        guard let n = printers, n > 0 else { return nil }
        return n == 1 ? L("1 printer") : LF("%d printers", n)
    }

    private func row(_ title: String, _ sub: String, _ icon: String, _ badge: String?) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(title)
                    if let badge { Spacer(); Text(badge).font(.caption).foregroundStyle(Theme.ink3) }
                }
                Text(sub).font(.caption).foregroundStyle(Theme.ink3)
            }
        } icon: {
            Image(systemName: icon).foregroundStyle(Theme.primaryText)
        }
        .frame(minHeight: 44)
    }

    private func load() async {
        if let d = try? await api.ixRaw("api/ha2") {
            switch d["transport"]?.string {
            case "integration", "rest": haState = L("connected")
            default: haState = L("not connected")
            }
        }
        if let d = try? await api.ixRaw("api/displays") { displays = d["displays"]?.array?.count }
        if let p = try? await api.ixRaw("api/print/printers") { printers = p.array?.count }
    }
}
