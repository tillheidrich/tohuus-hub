import SwiftUI
import UIKit

/// GET /api/print/info (web: pages/Bons.tsx PrintInfo)
struct PrintInfo: Decodable, Sendable {
    @Lossy var printers: [Printer]
    var settings: Settings?
    var channels: [String: Bool]?
    @Lossy var members: [Member]
    @Lossy var jobs: [Job]

    struct Printer: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var host: String
        var port: Int?
        var paper: Int?
        var mode: String?
        var codepage: String?
        var cut: String?
        var darkness: Int?
        var feedLines: Int?
        var autoOrders: String?
        var autoCare: JSONValue?
        var isDefault: JSONValue?
        var lastOkAt: String?
        var lastError: String?
    }

    struct Settings: Decodable, Sendable {
        var paper: Int?
        var quietFrom: String?
        var quietTo: String?
    }

    struct Member: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var hasEmail: JSONValue?
        var hasTelegram: JSONValue?
    }

    struct Job: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var kind: String?
        var target: String?
        var ok: JSONValue?
        var error: String?
        var actor: String?
        var createdAt: String?
        var printer: String?
    }
}

/// What a ticket shows (web: BonSpec) – also usable from other screens.
struct TicketSpec: Identifiable, Hashable, Sendable {
    var type: String
    var id: Int?
    var storeId: Int?
    var text: String?
    var title: String?
    var day: String?

    var query: [URLQueryItem] {
        var q = [URLQueryItem(name: "type", value: type)]
        if let id { q.append(.init(name: "id", value: String(id))) }
        if let storeId { q.append(.init(name: "store_id", value: String(storeId))) }
        if let text, !text.isEmpty { q.append(.init(name: "text", value: text)) }
        if let title, !title.isEmpty { q.append(.init(name: "title", value: title)) }
        if let day { q.append(.init(name: "day", value: day)) }
        return q
    }

    var json: [String: Any] {
        var b: [String: Any] = ["type": type]
        if let id { b["id"] = id }
        if let storeId { b["store_id"] = storeId }
        if let text, !text.isEmpty { b["text"] = text }
        if let title, !title.isEmpty { b["title"] = title }
        if let day { b["day"] = day }
        return b
    }

    static func label(_ t: String) -> String {
        switch t {
        case "shopping": return L("Shopping slip")
        case "order": return L("Kitchen ticket")
        case "care": return L("Care ticket")
        case "wish": return L("Wish ticket")
        case "recipe": return L("Recipe card")
        case "week": return L("Week plan")
        case "note": return L("Fridge note")
        case "test": return L("Test page")
        default: return t
        }
    }
}

/// Settings › Connections & devices › Printers (web: Bons.tsx PrintSettings): make a ticket (shopping slip, week plan, fridge note),
/// network thermal printers (ESC/POS, usually port 9100), defaults and what was printed or sent lately.
/// API: GET /api/print/info, POST/PATCH/DELETE /api/print/printers[/:id], POST /api/print/printers/:id/test,
/// PUT /api/print/settings (docs/print.md).
struct PrintersView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var info: PrintInfo?
    @State private var error: String?
    @State private var editing: PrinterEdit?
    @State private var ticket: TicketSpec?
    @State private var note = ""
    @State private var busy: Int?
    @State private var confirmRemove: PrintInfo.Printer?
    @State private var toast: ToastMessage?

    struct PrinterEdit: Identifiable {
        let id = UUID()
        var printer: PrintInfo.Printer?
    }

    private var admin: Bool { app.isAdmin }

    var body: some View {
        List {
            Section {
                Button { ticket = TicketSpec(type: "shopping") } label: {
                    Label { VStack(alignment: .leading) { Text(L("Shopping slip")); Text(L("Sorted by aisle, with boxes to tick")).font(.caption).foregroundStyle(Theme.ink3) } } icon: { Image(systemName: "cart") }
                }
                Button { ticket = TicketSpec(type: "week") } label: {
                    Label { VStack(alignment: .leading) { Text(L("Week plan")); Text(L("Seven days for the fridge door")).font(.caption).foregroundStyle(Theme.ink3) } } icon: { Image(systemName: "calendar") }
                }
                TextField(L("e.g. Back at six – soup is in the fridge"), text: $note, axis: .vertical).lineLimit(2...5)
                Button { ticket = TicketSpec(type: "note", text: String(note.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1200))) } label: {
                    Label(L("Preview ticket"), systemImage: "note.text")
                }
                .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } header: {
                Text(L("Make a ticket"))
            } footer: {
                Text(L("Receipt-style slips for the fridge, the kitchen or the phone. Print buttons also sit on the shopping list, orders, care tasks, recipes and the week plan."))
            }

            if let error { Section { ErrorBanner(message: error) { Task { await load() } } } }
            if let info {
                printersSection(info)
                if admin, let s = info.settings { defaultsSection(s) }
                if !info.jobs.isEmpty {
                    Section(L("Recently printed & sent")) {
                        ForEach(info.jobs) { j in
                            HStack {
                                Text(jobText(j)).font(.subheadline).lineLimit(2)
                                Spacer()
                                if j.ok?.bool == false {
                                    Text(L("failed")).font(.caption).foregroundStyle(Theme.low)
                                } else if let r = ServerDate.relative(j.createdAt) {
                                    Text(r).font(.caption).foregroundStyle(Theme.ink3)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            } else if error == nil {
                IxLoadingRow()
            }
            Section {
                DisclosureGroup(L("Good to know")) {
                    Text(L("Image mode prints the ticket as a picture: umlauts, Swedish letters and the QR code always come out right. Text mode is faster on old printers and uses code page CP858 or Windows-1252.")).font(.footnote)
                    Text(L("Home Assistant / ESPHome: an ESP32 with a serial thermal printer can print via ESPHome’s thermal printer component. Trigger it from a Home Assistant automation on the tohuus_hub_event (e.g. order.new). For a network printer, ToHuus Hub’s own auto-print is simpler.")).font(.footnote)
                }
            }
        }
        .themedList()
        .navigationTitle(L("Printers"))
        .toolbar {
            if admin {
                ToolbarItem(placement: .primaryAction) {
                    Button { editing = PrinterEdit(printer: nil) } label: { Label(L("Add printer"), systemImage: "plus") }
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .toast($toast)
        .sheet(item: $editing) { e in
            PrinterEditSheet(api: api, printer: e.printer) { saved in
                editing = nil
                if saved { toast = ToastMessage(text: L("Saved")) }
                Task { await load() }
            }
        }
        .sheet(item: $ticket) { t in TicketSheet(api: api, spec: t) }
        .confirmationDialog(L("Remove printer?"), isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }), titleVisibility: .visible) {
            Button(L("Remove"), role: .destructive) { if let p = confirmRemove { Task { await remove(p) } } }
        } message: {
            Text(LF("Remove “%@”?", confirmRemove?.name ?? ""))
        }
    }

    @ViewBuilder private func printersSection(_ info: PrintInfo) -> some View {
        Section {
            if info.printers.isEmpty {
                if admin {
                    EmptyStateView(systemImage: "printer", title: L("No printer yet"),
                                   message: L("Any network thermal printer that speaks ESC/POS works – Epson TM, Star in ESC/POS mode, most 58/80 mm Wi-Fi printers. Usually on port 9100."),
                                   actionTitle: L("Add printer")) { editing = PrinterEdit(printer: nil) }
                } else {
                    EmptyStateView(systemImage: "printer", title: L("No printer yet"),
                                   message: L("Any network thermal printer that speaks ESC/POS works – Epson TM, Star in ESC/POS mode, most 58/80 mm Wi-Fi printers. Usually on port 9100."))
                }
            }
            ForEach(info.printers) { p in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(p.name).font(.headline)
                        if p.isDefault?.bool == true { StatusPill(text: L("default"), status: nil) }
                        Spacer()
                        Button { Task { await test(p) } } label: {
                            if busy == p.id { ProgressView() } else { Label(L("Test page"), systemImage: "printer").labelStyle(.iconOnly).frame(width: 44, height: 44) }
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(L("Test page"))
                        .disabled(busy != nil)
                    }
                    Text("\(p.host):\(p.port ?? 9100) · \(p.paper ?? 80) mm · \(p.mode == "text" ? L("text") : L("image"))")
                        .font(.caption).foregroundStyle(Theme.ink3)
                    if let e = p.lastError, !e.isEmpty {
                        IxStatusLine(text: e, ok: false)
                    } else if let r = ServerDate.relative(p.lastOkAt) {
                        IxStatusLine(text: LF("Last print %@", r), ok: true)
                    } else {
                        IxStatusLine(text: L("Not used yet – try a test page."), ok: nil)
                    }
                    Text(LF("Orders: %@", autoOrdersLabel(p.autoOrders)) + " · " + LF("Care tasks: %@", p.autoCare?.bool == true ? L("when due") : L("off")))
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
                .padding(.vertical, 4)
                .contentShape(Rectangle())
                .onTapGesture { if admin { editing = PrinterEdit(printer: p) } }
                .swipeActions {
                    if admin {
                        Button(role: .destructive) { confirmRemove = p } label: { Label(L("Remove"), systemImage: "trash") }
                        Button { editing = PrinterEdit(printer: p) } label: { Label(L("Edit"), systemImage: "pencil") }.tint(Theme.info)
                    }
                }
                .contextMenu {
                    Button { Task { await test(p) } } label: { Label(L("Test page"), systemImage: "printer") }
                    if admin {
                        Button { editing = PrinterEdit(printer: p) } label: { Label(L("Edit"), systemImage: "pencil") }
                        Button(role: .destructive) { confirmRemove = p } label: { Label(L("Remove"), systemImage: "trash") }
                    }
                }
            }
        } header: {
            Text(L("Printers"))
        }
    }

    @ViewBuilder private func defaultsSection(_ s: PrintInfo.Settings) -> some View {
        Section {
            Picker(L("Paper for sharing & previews"), selection: Binding(get: { s.paper ?? 58 }, set: { v in Task { await saveSettings(["paper": v]) } })) {
                Text("58 mm").tag(58)
                Text("80 mm").tag(80)
            }
            DatePicker(L("Quiet from"), selection: Binding(get: { IxTime.date(s.quietFrom ?? "22:00") }, set: { d in Task { await saveSettings(["quietFrom": IxTime.string(d)]) } }), displayedComponents: .hourAndMinute)
            DatePicker(L("Quiet until"), selection: Binding(get: { IxTime.date(s.quietTo ?? "07:00", fallback: "07:00") }, set: { d in Task { await saveSettings(["quietTo": IxTime.string(d)]) } }), displayedComponents: .hourAndMinute)
        } header: {
            Text(L("Defaults"))
        } footer: {
            Text(L("Due care tasks are not printed in these hours. Orders always print – somebody is waiting for them."))
        }
    }

    private func autoOrdersLabel(_ a: String?) -> String {
        switch a {
        case "all": return L("always")
        default: return L("off")
        }
    }

    private func jobText(_ j: PrintInfo.Job) -> String {
        var s = TicketSpec.label(j.kind ?? "")
        s += " · " + (j.target == "printer" ? (j.printer ?? L("Printer")) : TicketSheet.channelLabel(j.target ?? ""))
        if j.actor == "auto" { s += " · " + L("automatic") }
        return s
    }

    // MARK: actions

    private func load() async {
        do {
            info = try await api.get("api/print/info", as: PrintInfo.self)
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func test(_ p: PrintInfo.Printer) async {
        busy = p.id
        defer { busy = nil }
        do {
            _ = try await api.ixRawSend("POST", "api/print/printers/\(p.id)/test", json: [:], timeout: 40)
            toast = ToastMessage(text: LF("Test page sent to %@", p.name))
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
        await load()
    }

    private func remove(_ p: PrintInfo.Printer) async {
        confirmRemove = nil
        do {
            _ = try await api.ixRawSend("DELETE", "api/print/printers/\(p.id)")
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func saveSettings(_ body: [String: Any]) async {
        do {
            _ = try await api.ixRawSend("PUT", "api/print/settings", json: body)
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

/// Add / edit a network printer.
struct PrinterEditSheet: View {
    let api: APIClient
    let printer: PrintInfo.Printer?
    let onDone: (Bool) -> Void
    @State private var name = L("Kitchen printer")
    @State private var host = ""
    @State private var port = "9100"
    @State private var paper = 80
    @State private var mode = "raster"
    @State private var codepage = "cp858"
    @State private var cut = "partial"
    @State private var darkness = 0.0
    @State private var feed = 4
    @State private var autoOrders = "off"
    @State private var autoCare = false
    @State private var isDefault = false
    @State private var busy = false
    @State private var error: String?

    private var darknessLabel: String {
        switch Int(darkness) {
        case -2: return L("very light")
        case -1: return L("lighter")
        case 1: return L("darker")
        case 2: return L("very dark")
        default: return L("normal")
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("Name"), text: $name)
                    TextField(L("IP address or host name"), text: $host)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField(L("Port"), text: $port).keyboardType(.numberPad)
                } footer: {
                    Text(L("Most printers print their address when you hold the feed button while switching them on."))
                }
                Section {
                    Picker(L("Paper width"), selection: $paper) { Text("58 mm").tag(58); Text("80 mm").tag(80) }
                    Picker(L("Print as"), selection: $mode) { Text(L("Image (recommended)")).tag("raster"); Text(L("Text")).tag("text") }
                    if mode == "text" {
                        Picker(L("Code page"), selection: $codepage) { Text("CP858").tag("cp858"); Text("Windows-1252").tag("cp1252") }
                    }
                    Picker(L("Cutter"), selection: $cut) {
                        Text(L("partial cut")).tag("partial")
                        Text(L("full cut")).tag("full")
                        Text(L("no cutter")).tag("none")
                    }
                    VStack(alignment: .leading) {
                        Text(LF("Darkness: %@", darknessLabel))
                        Slider(value: $darkness, in: -2...2, step: 1).accessibilityLabel(L("Darkness")).accessibilityValue(darknessLabel)
                    }
                    Stepper(LF("Blank lines before cutting: %d", feed), value: $feed, in: 0...12)
                }
                Section {
                    Picker(L("Print new orders automatically"), selection: $autoOrders) {
                        Text(L("off")).tag("off")
                        Text(L("always")).tag("all")
                    }
                    Toggle(L("Print care tasks when they are due"), isOn: $autoCare).tint(Theme.primary)
                    Toggle(L("Default printer"), isOn: $isDefault).tint(Theme.primary)
                } footer: {
                    Text(L("A kitchen ticket for every new sofa or guest order – only orders that come in after you switch this on."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(printer == nil ? L("Add printer") : L("Edit printer"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { onDone(false) } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }.disabled(busy || host.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                guard let p = printer else { return }
                name = p.name; host = p.host; port = String(p.port ?? 9100); paper = p.paper ?? 80
                mode = p.mode ?? "raster"; codepage = p.codepage ?? "cp858"; cut = p.cut ?? "partial"
                darkness = Double(p.darkness ?? 0); feed = p.feedLines ?? 4; autoOrders = p.autoOrders ?? "off"
                autoCare = p.autoCare?.bool ?? false; isDefault = p.isDefault?.bool ?? false
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let body: [String: Any] = [
            "name": String(name.trimmingCharacters(in: .whitespaces).prefix(40)), "host": host.trimmingCharacters(in: .whitespaces),
            "port": Int(port) ?? 9100, "paper": paper, "mode": mode, "codepage": codepage, "cut": cut, "darkness": Int(darkness),
            "feed_lines": feed, "auto_orders": autoOrders, "auto_care": autoCare, "is_default": isDefault,
        ]
        do {
            if let p = printer {
                _ = try await api.ixRawSend("PATCH", "api/print/printers/\(p.id)", json: body)
            } else {
                _ = try await api.ixRawSend("POST", "api/print/printers", json: body)
            }
            onDone(true)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// A ticket: preview, print on a network printer, share the image, send to a member (Telegram, Matrix, Gotify, e-mail).
/// API: GET /api/print/ticket.png, POST /api/print/print, POST /api/print/send.
struct TicketSheet: View {
    let api: APIClient
    let spec: TicketSpec
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @State private var info: PrintInfo?
    @State private var paper: Int?
    @State private var printerId: Int?
    @State private var member: Int = 0
    @State private var image: UIImage?
    @State private var file: URL?
    @State private var loadError: String?
    @State private var busy: String?
    @State private var toast: ToastMessage?

    static func channelLabel(_ c: String) -> String {
        switch c {
        case "telegram": return "Telegram"
        case "matrix": return "Matrix"
        case "gotify": return "Gotify"
        case "email": return L("E-mail")
        case "printer": return L("Printer")
        default: return c
        }
    }

    private var printers: [PrintInfo.Printer] { info?.printers ?? [] }
    private var printer: PrintInfo.Printer? { printers.first { $0.id == printerId } ?? printers.first }
    private var effPaper: Int { paper ?? printer?.paper ?? info?.settings?.paper ?? 58 }
    private var channels: [String] { ["telegram", "matrix", "gotify", "email"].filter { info?.channels?[$0] == true } }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker(L("Paper width"), selection: Binding(get: { effPaper }, set: { paper = $0 })) { Text("58 mm").tag(58); Text("80 mm").tag(80) }
                        .pickerStyle(.segmented)
                    HStack {
                        Spacer()
                        if let image {
                            Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: effPaper == 58 ? 240 : 320)
                                .background(Color.white)
                                .accessibilityLabel(TicketSpec.label(spec.type))
                        } else if let loadError {
                            Text(loadError).foregroundStyle(Theme.empty)
                        } else {
                            ProgressView().frame(height: 200)
                        }
                        Spacer()
                    }
                    .listRowBackground(Theme.surface2)
                }
                Section {
                    if printers.count > 1 {
                        Picker(L("Printer"), selection: Binding(get: { printer?.id ?? 0 }, set: { printerId = $0 })) {
                            ForEach(printers) { p in Text(p.name).tag(p.id) }
                        }
                    }
                    if !printers.isEmpty {
                        Button { Task { await doPrint() } } label: {
                            HStack { Label(LF("Print on %@", printer?.name ?? L("the printer")), systemImage: "printer"); if busy == "print" { Spacer(); ProgressView() } }
                        }
                        .disabled(busy != nil)
                    }
                    if let file {
                        ShareLink(item: file) { Label(L("Share as image"), systemImage: "square.and.arrow.up") }
                    }
                }
                if !channels.isEmpty && !app.isGuest {
                    Section {
                        Picker(L("To"), selection: $member) {
                            Text(L("the household")).tag(0)
                            ForEach(info?.members ?? []) { m in Text(m.name).tag(m.id) }
                        }
                        ForEach(channels, id: \.self) { c in
                            Button { Task { await send(c) } } label: {
                                HStack { Label(Self.channelLabel(c), systemImage: c == "email" ? "envelope" : "paperplane"); if busy == c { Spacer(); ProgressView() } }
                            }
                            .disabled(busy != nil || !memberOk(c))
                        }
                    } header: {
                        Text(L("Send as a digital receipt"))
                    }
                }
            }
            .themedList()
            .navigationTitle(spec.type == "note" ? (spec.title ?? TicketSpec.label(spec.type)) : TicketSpec.label(spec.type))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task { info = try? await api.get("api/print/info", as: PrintInfo.self) }
            .task(id: effPaper) { await loadImage() }
            .toast($toast)
        }
    }

    private func memberOk(_ c: String) -> Bool {
        guard member != 0, let m = info?.members.first(where: { $0.id == member }) else { return true }
        return c == "telegram" ? m.hasTelegram?.bool == true : c == "email" ? m.hasEmail?.bool == true : false
    }

    private func loadImage() async {
        do {
            let data = try await api.ixDownload("api/print/ticket.png", query: spec.query + [URLQueryItem(name: "paper", value: String(effPaper))], timeout: 40)
            image = UIImage(data: data)
            file = try? IxFiles.temp(data, name: "\(spec.type)-\(IxFiles.today).png")
            loadError = nil
        } catch {
            loadError = APIError.from(error).localizedDescription
        }
    }

    private func doPrint() async {
        busy = "print"
        defer { busy = nil }
        var body = spec.json
        if let p = printer { body["printer_id"] = p.id }
        do {
            let r = try await api.ixRawSend("POST", "api/print/print", json: body, timeout: 40)
            toast = ToastMessage(text: LF("Printing on %@", r["printer"]?.string ?? printer?.name ?? ""))
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func send(_ channel: String) async {
        busy = channel
        defer { busy = nil }
        var body = spec.json
        body["channel"] = channel
        body["paper"] = effPaper
        if member != 0 { body["member_id"] = member }
        do {
            _ = try await api.ixRawSend("POST", "api/print/send", json: body, timeout: 40)
            toast = ToastMessage(text: LF("Sent via %@", Self.channelLabel(channel)))
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}
