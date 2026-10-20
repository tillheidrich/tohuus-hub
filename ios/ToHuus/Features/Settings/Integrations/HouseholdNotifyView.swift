import SwiftUI
import UIKit

/// Settings › Notifications & calendar › "For the whole household" (web: Settings.tsx `Notify`): the shared channels (Home
/// Assistant webhook, ntfy, another webhook, household e-mail), digest hour, best-before warning, auto shopping list,
/// the routing matrix "What goes where?" (admins change it), a test and the log of what was sent.
/// GET/PATCH /api/settings › notify, POST /api/settings/test-notification, GET /api/notifications, GET /api/channels.
struct HouseholdNotifyView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    /// settings.notify as the server sent it (plain keys – "auth.new_device" must stay as it is)
    @State private var n: [String: JSONValue]?
    @State private var dirty = false
    @State private var extraCols: [IxPair] = []
    @State private var log: [LogEntry] = []
    @State private var error: String?
    @State private var busy = false
    @State private var toast: ToastMessage?

    struct LogEntry: Decodable, Sendable, Identifiable {
        var id: Int
        var title: String?
        var channels: String?
        var createdAt: String?

        var channelText: String {
            guard let data = channels?.data(using: .utf8),
                  let arr = try? JSONDecoder().decode([JSONValue].self, from: data), !arr.isEmpty else { return L("in the app only") }
            return arr.map { "\($0["channel"]?.string ?? "?") \($0["ok"]?.bool == true ? "✓" : "✗")" }.joined(separator: " · ")
        }
    }

    /// web: Settings.tsx EVENT_LABEL – the order of the matrix
    static var events: [IxPair] { [
        IxPair("stock.low", L("Something is running low")),
        IxPair("stock.empty", L("Something has run out")),
        IxPair("stock.expiring", L("Best-before date coming up")),
        IxPair("import.review", L("Import waiting for review")),
        IxPair("order.new", L("Someone would love something (home or guests)")),
        IxPair("order.status", L("Answer to your wish (only to you)")),
        IxPair("shopping.added", L("New item on the shopping list")),
        IxPair("digest.daily", L("Daily digest (once a day)")),
        IxPair("care.due", L("Home care task due")),
        IxPair("kids.wish", L("A kid wishes for something")),
        IxPair("auth.new_device", L("New sign-in on another device (only to that member)")),
        IxPair("budget.warning", L("Spending budget at 80 % or reached")),
        IxPair("plan.vote", L("Family food vote started or decided")),
        IxPair("plan.rotation", L("Next week filled from the rotation")),
        IxPair("trip.started", L("Someone is shopping right now")),
        IxPair("trip.addon", L("Something added to a shopping trip")),
        IxPair("rhythm.due", L("Something is due again")),
        IxPair("plan.reminder", L("Reminder for the week plan")),
    ] }
    /// phones and browsers decide per person for these – the household matrix only routes shared channels
    static let personal: Set<String> = ["trip.started", "trip.addon", "rhythm.due", "plan.reminder", "stock.expiring", "import.review", "order.new", "budget.warning"]

    private var admin: Bool { app.isAdmin }

    var body: some View {
        Form {
            if let n {
                channelsSection(n)
                timingSection(n)
                matrixSections(n)
                if admin {
                    Section {
                        Button { Task { await test() } } label: {
                            HStack { Label(L("Send a test"), systemImage: "bell.badge"); if busy { Spacer(); ProgressView() } }
                        }
                        .disabled(busy)
                    } footer: {
                        Text(L("Saves first, then sends a test message to every shared channel that is set up."))
                    }
                }
                logSection
            } else if error == nil {
                IxLoadingRow()
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("For the whole household"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if admin {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }.disabled(!dirty || busy)
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .toast($toast)
    }

    // MARK: sections

    private func text(_ key: String) -> Binding<String> {
        Binding(get: { n?[key]?.string ?? "" }, set: { n?[key] = .string($0); dirty = true })
    }

    @ViewBuilder private func channelsSection(_ n: [String: JSONValue]) -> some View {
        Section {
            field(L("Home Assistant – webhook URL"), text("haWebhookUrl"), "https://ha.example.de/api/webhook/tohuus_…")
            field(L("ntfy topic (optional)"), text("ntfyUrl"), L("https://ntfy.sh/my-secret-topic"))
            field(L("Another webhook (n8n, Node-RED …)"), text("webhookUrl"), "https://…")
            field(L("Email to"), text("emailTo"), L("us@example.com, second@example.com"), keyboard: .emailAddress)
        } header: {
            Text(L("Shared channels"))
        } footer: {
            Text(admin
                 ? L("ToHuus Hub sends events as JSON (title, message, url, data). You’ll find a ready-made automation under “AI assistants & access”.")
                 : L("Only admins can change this."))
        }
    }

    private func field(_ title: String, _ value: Binding<String>, _ placeholder: String, keyboard: UIKeyboardType = .URL) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(Theme.ink3)
            TextField(placeholder, text: value)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(!admin)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private func timingSection(_ n: [String: JSONValue]) -> some View {
        Section {
            Picker(L("Daily digest at"), selection: Binding(get: { n["digestHour"]?.int ?? -1 }, set: { self.n?["digestHour"] = .number(Double($0)); dirty = true })) {
                Text(L("off")).tag(-1)
                ForEach(0..<24, id: \.self) { h in Text(String(format: "%d:00", h)).tag(h) }
            }
            .disabled(!admin)
            Picker(L("Best-before warning"), selection: Binding(get: { n["expiryWarnDays"]?.int ?? 3 }, set: { self.n?["expiryWarnDays"] = .number(Double($0)); dirty = true })) {
                ForEach([1, 2, 3, 5, 7], id: \.self) { d in Text(d == 1 ? L("1 day before") : LF("%d days before", d)).tag(d) }
            }
            .disabled(!admin)
            Toggle(isOn: Binding(get: { n["autoShoppingList"]?.bool ?? false }, set: { self.n?["autoShoppingList"] = .bool($0); dirty = true })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Add low items to the shopping list automatically"))
                    Text(L("as soon as they drop below the minimum")).font(.footnote).foregroundStyle(Theme.ink3)
                }
            }
            .tint(Theme.primary)
            .disabled(!admin)
        }
    }

    private var columns: [IxPair] {
        [IxPair("ha", "Home Assistant"), IxPair("ntfy", "ntfy"), IxPair("webhook", "Webhook"), IxPair("email", L("E-mail")), IxPair("push", L("Push"))] + extraCols
    }

    private func icon(_ col: String) -> String {
        switch col {
        case "ha": return "house"
        case "ntfy", "gotify": return "bell"
        case "webhook": return "link"
        case "email": return "envelope"
        case "push": return "iphone"
        case "telegram": return "paperplane"
        case "matrix": return "bubble.left.and.bubble.right"
        default: return "circle"
        }
    }

    @ViewBuilder private func matrixSections(_ n: [String: JSONValue]) -> some View {
        Section {
            ForEach(Self.events) { ev in
                let row = n["events"]?[ev.key]?.object ?? [:]
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Text(ev.label).font(Theme.rowFont)
                    FlowLayout(spacing: 6) {
                        ForEach(columns) { col in
                            if col.key == "push" && Self.personal.contains(ev.key) {
                                Text(L("Push: per person"))
                                    .font(.footnote).foregroundStyle(Theme.ink3)
                                    .frame(minHeight: 44)
                                    .accessibilityLabel(L("Each person decides this for themselves"))
                            } else {
                                IxToggleChip(title: col.label, systemImage: icon(col.key), on: row[col.key]?.bool ?? false, enabled: admin,
                                             a11yLabel: "\(ev.label): \(col.label)") {
                                    setEvent(ev.key, col.key, !(row[col.key]?.bool ?? false))
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text(L("What goes where?"))
        } footer: {
            Text(admin ? L("Tap a channel to switch it for this event, then save.") : L("Only admins can change this."))
        }
    }

    @ViewBuilder private var logSection: some View {
        Section {
            if log.isEmpty {
                Text(L("Nothing yet.")).foregroundStyle(Theme.ink3)
            }
            ForEach(log.prefix(12)) { x in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(x.title ?? "–").font(.subheadline)
                        Text(x.channelText).font(.caption).foregroundStyle(Theme.ink3)
                    }
                    Spacer()
                    if let r = ServerDate.relative(x.createdAt) { Text(r).font(.caption).foregroundStyle(Theme.ink3) }
                }
                .accessibilityElement(children: .combine)
            }
        } header: {
            Text(L("Recently sent"))
        }
    }

    // MARK: actions

    private func setEvent(_ ev: String, _ ch: String, _ v: Bool) {
        guard var all = n, admin else { return }
        var events = all["events"]?.object ?? [:]
        var row = events[ev]?.object ?? [:]
        row[ch] = .bool(v)
        // the server wants these four on every row
        for k in ["ha", "webhook", "ntfy", "email"] where row[k] == nil { row[k] = .bool(false) }
        events[ev] = .object(row)
        all["events"] = .object(events)
        n = all
        dirty = true
        Haptics.tick()
    }

    private func load() async {
        do {
            let s = try await api.ixRaw("api/settings")
            if !dirty { n = s["notify"]?.object }
            if let c = try? await api.ixRaw("api/channels") {
                var cols: [IxPair] = []
                if c["telegram"]?["enabled"]?.bool == true { cols.append(IxPair("telegram", "Telegram")) }
                if c["gotify"]?["enabled"]?.bool == true { cols.append(IxPair("gotify", "Gotify")) }
                if c["matrix"]?["enabled"]?.bool == true { cols.append(IxPair("matrix", "Matrix")) }
                extraCols = cols
            }
            log = (try? await api.get("api/notifications", as: Lossy<LogEntry>.self).wrappedValue) ?? []
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    @discardableResult
    private func save(quiet: Bool = false) async -> Bool {
        guard let n else { return false }
        busy = true
        defer { busy = false }
        var body = n.mapValues { $0.ixAny }
        // only known fields – the server checks the shape
        body = body.filter { ["haWebhookUrl", "webhookUrl", "ntfyUrl", "emailTo", "digestHour", "expiryWarnDays", "autoShoppingList", "events"].contains($0.key) }
        do {
            _ = try await api.ixRawSend("PATCH", "api/settings", json: ["notify": body])
            dirty = false
            if !quiet { toast = ToastMessage(text: L("Saved")) }
            return true
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            return false
        }
    }

    private func test() async {
        guard await save(quiet: true) else { return }
        busy = true
        defer { busy = false }
        do {
            let r = try await api.ixRawSend("POST", "api/settings/test-notification", json: [:])
            let chans = r["channels"]?.array?.compactMap { $0.string ?? $0["channel"]?.string } ?? []
            toast = chans.isEmpty
                ? ToastMessage(text: L("No channel responded – check the URLs"), isError: true)
                : ToastMessage(text: LF("Test sent: %@", chans.joined(separator: ", ")))
            log = (try? await api.get("api/notifications", as: Lossy<LogEntry>.self).wrappedValue) ?? log
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}
