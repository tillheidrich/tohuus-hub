import SwiftUI
import UIKit

/// Settings › Displays (web: pages/Displays.tsx): read-only kitchen / hallway screens and e-ink frames. A display link
/// is shown once (with QR, image URL and Home Assistant YAML); afterwards only "last seen" and a new link.
/// API: GET/POST /api/displays, PATCH/DELETE /api/displays/:id, POST /api/displays/:id/rotate (docs/kiosk.md).
struct DisplaysView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var list: DisplayList?
    @State private var error: String?
    @State private var editing: DisplayEdit?
    @State private var created: CreatedDisplay?
    @State private var confirmRotate: DisplayRow?
    @State private var confirmRevoke: DisplayRow?
    @State private var toast: ToastMessage?

    struct DisplayList: Decodable, Sendable {
        @Lossy var displays: [DisplayRow]
        var layouts: [String: [String]]?
        var widgets: [String]?
    }

    struct DisplayRow: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var layout: String?
        var widgets: [String]?
        var nightFrom: String?
        var nightTo: String?
        var lastSeenAt: String?
        var lastSeenVia: String?
    }

    struct CreatedDisplay: Decodable, Sendable, Identifiable {
        var display: DisplayRow
        var token: String?
        var url: String
        var path: String?
        var imageUrl: String
        var id: Int { display.id }
    }

    /// nil row = new display
    struct DisplayEdit: Identifiable {
        let id = UUID()
        var row: DisplayRow?
    }

    private var admin: Bool { app.isAdmin }

    var body: some View {
        List {
            Section {
                Label {
                    Text(L("An old tablet on the fridge or by the door shows what’s for dinner, what to eat first and the shopping list – read-only, no login, updates by itself."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                } icon: { Image(systemName: "display").foregroundStyle(Theme.primaryText) }
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } } }
            if let list {
                if list.displays.isEmpty {
                    Section {
                        if admin {
                            EmptyStateView(systemImage: "display", title: L("No displays yet"), message: L("Create one and open the link on the tablet."),
                                           actionTitle: L("New display")) { editing = DisplayEdit(row: nil) }
                        } else {
                            EmptyStateView(systemImage: "display", title: L("No displays yet"), message: L("An admin can set one up here."))
                        }
                    }
                } else {
                    Section(L("Your displays")) {
                        ForEach(list.displays) { d in row(d) }
                    }
                }
            } else if error == nil {
                IxLoadingRow()
            }
            Section {
                DisclosureGroup(L("E-ink frames and Home Assistant")) {
                    Text(L("Every display also exists as a PNG image: /api/display/<link>/image.png?w=800&h=480&mode=bw. It works with TRMNL (image plugin), Inkplate, ESPHome e-paper and Home Assistant."))
                        .font(.footnote)
                    Text(Self.haYaml("https://your-host/api/display/<display-link>/image.png?w=800&h=480&mode=color"))
                        .font(.caption2.monospaced()).textSelection(.enabled)
                    Text(L("The link is shown only once. Lost it? Use “New link” next to the display."))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
            }
        }
        .themedList()
        .navigationTitle(L("Displays"))
        .toolbar {
            if admin {
                ToolbarItem(placement: .primaryAction) {
                    Button { editing = DisplayEdit(row: nil) } label: { Label(L("New display"), systemImage: "plus") }
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .toast($toast)
        .sheet(item: $editing) { e in
            DisplayEditSheet(api: api, row: e.row, layouts: list?.layouts ?? [:], all: list?.widgets ?? Self.defaultWidgets) { result in
                editing = nil
                if let result { created = result }
                Task { await load() }
            }
        }
        .sheet(item: $created) { c in DisplayCreatedSheet(created: c) }
        .confirmationDialog(L("New link?"), isPresented: Binding(get: { confirmRotate != nil }, set: { if !$0 { confirmRotate = nil } }), titleVisibility: .visible) {
            Button(L("New link")) { if let d = confirmRotate { Task { await rotate(d) } } }
        } message: {
            Text(LF("Create a new link for “%@”? The old link stops working right away.", confirmRotate?.name ?? ""))
        }
        .confirmationDialog(L("Revoke display?"), isPresented: Binding(get: { confirmRevoke != nil }, set: { if !$0 { confirmRevoke = nil } }), titleVisibility: .visible) {
            Button(L("Revoke"), role: .destructive) { if let d = confirmRevoke { Task { await revoke(d) } } }
        } message: {
            Text(LF("Revoke “%@”? The screen shows an error from then on.", confirmRevoke?.name ?? ""))
        }
    }

    static let defaultWidgets = ["clock", "meals", "eat_first", "low", "shopping", "care"]

    private func row(_ d: DisplayRow) -> some View {
        var parts = [Self.layoutLabel(d.layout ?? "kitchen")]
        if let seen = ServerDate.relative(d.lastSeenAt) {
            parts.append(LF("last seen %@ (%@)", seen, Self.seenVia(d.lastSeenVia)))
        } else {
            parts.append(L("not opened yet"))
        }
        if let f = d.nightFrom, let t = d.nightTo { parts.append(LF("dims %@–%@", f, t)) }
        return Button {
            if admin { editing = DisplayEdit(row: d) }
        } label: {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: "display").foregroundStyle(Theme.primaryText).frame(width: 28).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(d.name).foregroundStyle(Theme.ink)
                    Text(parts.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer(minLength: 0)
                if admin { Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.ink3).accessibilityHidden(true) }
            }
            .frame(minHeight: 44)
        }
        .disabled(!admin)
        .swipeActions(edge: .trailing) {
            if admin {
                Button(role: .destructive) { confirmRevoke = d } label: { Label(L("Revoke"), systemImage: "trash") }
                Button { confirmRotate = d } label: { Label(L("New link"), systemImage: "arrow.triangle.2.circlepath") }.tint(Theme.info)
            }
        }
        .contextMenu {
            if admin {
                Button { editing = DisplayEdit(row: d) } label: { Label(L("Edit"), systemImage: "pencil") }
                Button { confirmRotate = d } label: { Label(L("New link"), systemImage: "arrow.triangle.2.circlepath") }
                Button(role: .destructive) { confirmRevoke = d } label: { Label(L("Revoke"), systemImage: "trash") }
            }
        }
    }

    static func layoutLabel(_ l: String) -> String {
        switch l {
        case "hallway": return L("Hallway")
        case "minimal": return L("Minimal")
        default: return L("Kitchen")
        }
    }

    static func layoutHint(_ l: String) -> String {
        switch l {
        case "hallway": return L("Today’s meal, what’s due at home and the shopping list.")
        case "minimal": return L("Date, meals and the shopping list – calm, also for e-ink.")
        default: return L("Meal plan, eat first, low & out and the shopping list.")
        }
    }

    static func widgetLabel(_ w: String) -> String {
        switch w {
        case "clock": return L("Clock, date & greeting")
        case "meals": return L("Meal plan (today & tomorrow)")
        case "eat_first": return L("Eat first")
        case "low": return L("Low & out")
        case "shopping": return L("Shopping list (count & top items)")
        case "care": return L("Due at home")
        default: return w
        }
    }

    static func seenVia(_ v: String?) -> String {
        switch v {
        case "image": return L("as image")
        case "json": return L("as data")
        default: return L("as page")
        }
    }

    static func haYaml(_ imageUrl: String) -> String {
        let eink = imageUrl.replacingOccurrences(of: #"w=\d+&h=\d+&mode=\w+"#, with: "w=800&h=480&mode=bw", options: .regularExpression)
        return """
        # \(L("Image entity – shows up as image.tohuus_display"))
        template:
          - image:
              - name: "ToHuus display"
                url: "\(imageUrl)"

        # \(L("Or as a dashboard card (no YAML file needed):"))
        # type: picture
        # image: "\(imageUrl)"

        # ESPHome e-paper (\(L("replace w/h with your panel size"))):
        # online_image:
        #   - id: tohuus_display
        #     url: "\(eink)"
        #     format: PNG
        #     type: BINARY
        #     update_interval: 15min
        """
    }

    // MARK: actions

    private func load() async {
        do {
            // layouts/widgets are plain words ("eat_first" is a value, not a key) – the standard decoder is fine
            list = try await api.get("api/displays", as: DisplayList.self)
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func rotate(_ d: DisplayRow) async {
        confirmRotate = nil
        do {
            created = try await api.send("POST", "api/displays/\(d.id)/rotate", json: [:], as: CreatedDisplay.self)
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func revoke(_ d: DisplayRow) async {
        confirmRevoke = nil
        do {
            _ = try await api.send("DELETE", "api/displays/\(d.id)", as: Ignored.self)
            toast = ToastMessage(text: L("Display revoked"))
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

/// New / edit display: name, layout, what it shows, dim at night.
struct DisplayEditSheet: View {
    let api: APIClient
    let row: DisplaysView.DisplayRow?
    let layouts: [String: [String]]
    let all: [String]
    /// a new display returns its one-time links
    let onDone: (DisplaysView.CreatedDisplay?) -> Void
    @State private var name = ""
    @State private var layout = "kitchen"
    @State private var widgets: [String] = []
    @State private var night = true
    @State private var from = IxTime.date("22:00")
    @State private var to = IxTime.date("06:00")
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("e.g. Kitchen tablet"), text: $name)
                } header: { Text(L("Name")) }
                Section {
                    Picker(L("Layout"), selection: Binding(get: { layout }, set: pickLayout)) {
                        Text(DisplaysView.layoutLabel("kitchen")).tag("kitchen")
                        Text(DisplaysView.layoutLabel("hallway")).tag("hallway")
                        Text(DisplaysView.layoutLabel("minimal")).tag("minimal")
                    }
                    .pickerStyle(.segmented)
                } header: { Text(L("Layout")) } footer: { Text(DisplaysView.layoutHint(layout)) }
                Section {
                    ForEach(all, id: \.self) { w in
                        Toggle(DisplaysView.widgetLabel(w), isOn: Binding(get: { widgets.contains(w) }, set: { on in
                            if on { if !widgets.contains(w) { widgets.append(w) } } else { widgets.removeAll { $0 == w } }
                        }))
                        .tint(Theme.primary)
                    }
                } header: {
                    Text(L("What it shows"))
                } footer: {
                    Text(L("Never shown: guest names, notes, spending. Member names only if names are shown on the sign-in screen."))
                }
                Section {
                    Toggle(L("Dim at night"), isOn: $night).tint(Theme.primary)
                    if night {
                        DatePicker(L("From"), selection: $from, displayedComponents: .hourAndMinute)
                        DatePicker(L("Until"), selection: $to, displayedComponents: .hourAndMinute)
                    }
                } footer: {
                    Text(L("The screen gets darker in these hours; a tap brightens it for 30 seconds."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(row == nil ? L("New display") : L("Edit display"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(row == nil ? L("Create") : L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear(perform: fill)
        }
        .presentationDetents([.large])
    }

    private func fill() {
        if let row {
            name = row.name
            layout = row.layout ?? "kitchen"
            widgets = row.widgets ?? layouts[layout] ?? []
            night = row.nightFrom != nil && row.nightTo != nil
            if let f = row.nightFrom { from = IxTime.date(f) }
            if let t = row.nightTo { to = IxTime.date(t, fallback: "06:00") }
        } else if name.isEmpty {
            name = DisplaysView.layoutLabel("kitchen")
            widgets = layouts["kitchen"] ?? all
        }
    }

    private func pickLayout(_ l: String) {
        if name == DisplaysView.layoutLabel(layout) { name = DisplaysView.layoutLabel(l) }
        layout = l
        widgets = layouts[l] ?? widgets
    }

    private func payload() -> [String: Any] {
        [
            "name": String(name.trimmingCharacters(in: .whitespaces).prefix(60)),
            "layout": layout,
            "widgets": widgets,
            "night_from": night ? IxTime.string(from) as Any : NSNull() as Any,
            "night_to": night ? IxTime.string(to) as Any : NSNull() as Any,
        ]
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            if let row {
                _ = try await api.ixRawSend("PATCH", "api/displays/\(row.id)", json: payload())
                onDone(nil)
            } else {
                // the answer carries snake_case keys (image_url) – the app's decoder converts them
                let r = try await api.ixRawSend("POST", "api/displays", json: payload())
                let data = try JSONEncoder().encode(r)
                onDone(try JSONCoding.decoder().decode(DisplaysView.CreatedDisplay.self, from: data))
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// The one-time links of a new display: QR for the tablet, the page, the image for e-ink / Home Assistant, YAML.
struct DisplayCreatedSheet: View {
    let created: DisplaysView.CreatedDisplay
    @Environment(\.dismiss) private var dismiss
    @State private var toast: ToastMessage?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack { Spacer(); IxQRCode(text: created.url, size: 200); Spacer() }
                        .listRowBackground(Color.clear)
                } footer: {
                    Text(LF("%@: open this link on the tablet – shown only once", created.display.name))
                }
                Section {
                    IxCopyRow(title: L("Display link"), value: created.url, secret: true) { toast = ToastMessage(text: L("Copied")) }
                    if let u = URL(string: created.url) {
                        Link(destination: u) { Label(L("Open display"), systemImage: "display") }
                        ShareLink(item: u) { Label(L("Send to the tablet"), systemImage: "square.and.arrow.up") }
                    }
                }
                Section {
                    IxCopyRow(title: L("Image for e-ink frames and Home Assistant"), value: created.imageUrl, secret: true) { toast = ToastMessage(text: L("Copied")) }
                    if let u = URL(string: created.imageUrl) { Link(destination: u) { Label(L("Preview image"), systemImage: "photo") } }
                } footer: {
                    Text(L("Change w and h to your screen size; mode=bw for black-and-white e-ink, gray for greyscale, color for Home Assistant."))
                }
                Section {
                    let yaml = DisplaysView.haYaml(created.imageUrl.replacingOccurrences(of: "mode=gray", with: "mode=color"))
                    Text(yaml).font(.caption2.monospaced()).textSelection(.enabled)
                    Button { IxClipboard.copy(yaml, secret: true); toast = ToastMessage(text: L("Copied")) } label: {
                        Label(L("Copy YAML"), systemImage: "doc.on.doc")
                    }
                } header: {
                    Text(L("Home Assistant (configuration.yaml)"))
                } footer: {
                    Text(L("Tip for tablets: add the page to the home screen, switch auto-lock off and keep the charger plugged in."))
                }
            }
            .themedList()
            .navigationTitle(created.display.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .toast($toast)
        }
        .interactiveDismissDisabled()
    }
}
