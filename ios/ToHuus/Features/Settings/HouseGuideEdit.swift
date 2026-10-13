import SwiftUI

/// Who sees a card or code (server/lib/house-guide.ts Visibility). Admin lists carry it; the app edits the two
/// everyday switches (everyone at home, babysitter links) and keeps the rest (guest level, single links) as it is.
struct HGVisibility: Decodable, Sendable, Hashable {
    var members: Bool
    var guestLevel: String?
    var sitters: Bool
    var links: [LinkVis]?

    struct LinkVis: Decodable, Sendable, Hashable {
        var id: Int
        var until: String?
    }

    init(members: Bool, guestLevel: String?, sitters: Bool, links: [LinkVis] = []) {
        self.members = members
        self.guestLevel = guestLevel
        self.sitters = sitters
        self.links = links
    }

    static let cardDefault = HGVisibility(members: true, guestLevel: "order", sitters: true)
    static let codeDefault = HGVisibility(members: true, guestLevel: nil, sitters: false)

    var json: [String: Any] {
        [
            "members": members,
            "guest_level": orNull(guestLevel),
            "sitters": sitters,
            "links": (links ?? []).map { ["id": $0.id, "until": orNull($0.until)] as [String: Any] },
        ]
    }
}

/// New or edit a house info card (web: HouseGuide.tsx CardEditor). Cards are not secret – codes go under codes.
struct HouseCardEditor: View {
    let api: APIClient
    let card: HouseGuide.Card?
    let areas: [String]
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var type = "tip"
    @State private var topic = "other"
    @State private var title = ""
    @State private var text = ""
    @State private var detail = ""
    @State private var area = ""
    @State private var vis = HGVisibility.cardDefault
    @State private var error: String?
    @State private var busy = false
    @State private var confirmDelete = false

    private var say: Bool { type == "voice" || type == "routine" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(L("Kind"), selection: $type) {
                        Text(L("Tip")).tag("tip")
                        Text(L("Command")).tag("voice")
                        Text(L("Routine")).tag("routine")
                        Text(L("Number")).tag("contact")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(say ? L("e.g. Good night") : type == "contact" ? L("e.g. Our neighbours") : L("e.g. Heating"), text: $title)
                } header: { Text(L("Title")) }
                Section {
                    TextField(say ? "Alexa, gute Nacht" : "", text: $text, axis: .vertical).lineLimit(2...6)
                        .keyboardType(type == "contact" ? .phonePad : .default)
                } header: { Text(say ? L("What you say") : type == "contact" ? L("Number") : L("How it works")) }
                Section {
                    TextField(type == "routine" ? L("e.g. all lights off, blinds down, night light in the kids’ room on") : "", text: $detail, axis: .vertical)
                        .lineLimit(1...5)
                } header: { Text(type == "routine" ? L("What happens") : L("More (optional)")) }
                Section {
                    Picker(L("Topic"), selection: $topic) {
                        ForEach(HouseGuideLabels.topics, id: \.self) { t in Text(HouseGuideLabels.topic(t)).tag(t) }
                    }
                    AreaField(area: $area, areas: areas)
                }
                HGCardMediaSection(api: api, cardId: card?.id, media: card?.media ?? [])
                Section {
                    Toggle(L("Everyone at home"), isOn: $vis.members)
                    Toggle(L("All babysitter and house-sitter links"), isOn: $vis.sitters)
                } header: { Text(L("Who sees it")) } footer: { Text(L("Cards are not secret – codes and passwords belong under Codes.")) }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if card != nil {
                    Section {
                        Button(L("Delete card"), role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(card == nil ? L("New card") : L("Edit card"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { onDone(); dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }
                        .disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog(L("Delete this card?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) { Task { await remove() } }
            }
            .onAppear {
                guard let c = card else { return }
                type = c.type ?? "tip"
                topic = c.topic ?? "other"
                title = c.title
                text = c.body ?? ""
                detail = c.detail ?? ""
                area = c.area ?? ""
                if let v = c.visibility { vis = v }
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let d = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        let a = area.trimmingCharacters(in: .whitespaces)
        let body: [String: Any] = [
            "type": type, "topic": topic, "title": String(title.trimmingCharacters(in: .whitespaces).prefix(100)),
            "body": String(text.prefix(1000)), "detail": orNull(d.isEmpty ? nil : String(d.prefix(1000))),
            "area": orNull(a.isEmpty ? nil : String(a.prefix(60))), "visibility": vis.json,
        ]
        do {
            try await api.saveHouseCard(id: card?.id, body)
            onDone()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func remove() async {
        guard let id = card?.id else { return }
        do {
            try await api.deleteHouseCard(id)
            onDone()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// New or edit a code (web: CodeEditor). The stored value never comes to the app: an empty field keeps it.
struct HouseCodeEditor: View {
    let api: APIClient
    let code: HouseGuide.Code?
    let areas: [String]
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "door"
    @State private var label = ""
    @State private var value = ""
    @State private var ssid = ""
    @State private var security = "WPA"
    @State private var area = ""
    @State private var note = ""
    @State private var vis = HGVisibility.codeDefault
    @State private var error: String?
    @State private var busy = false
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(L("Kind"), selection: $kind) {
                        ForEach(HouseGuideLabels.kinds, id: \.self) { k in Text(HouseGuideLabels.kind(k)).tag(k) }
                    }
                    TextField(HouseGuideLabels.kind(kind), text: $label)
                } footer: { Text(L("The name others see, e.g. “Front door”.")) }
                if kind == "wifi" {
                    Section {
                        TextField(L("Network name"), text: $ssid).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Picker(L("Security"), selection: $security) {
                            Text("WPA/WPA2/WPA3").tag("WPA")
                            Text("WEP").tag("WEP")
                            Text(L("Open network")).tag("nopass")
                        }
                    }
                }
                Section {
                    SecureField(code?.hasValue == true ? L("unchanged – type to replace") : (kind == "wifi" ? L("Password") : L("Code")), text: $value)
                        .textContentType(.newPassword)
                } header: { Text(kind == "wifi" ? L("Password") : L("Code")) } footer: {
                    Text(L("Codes stay hidden until someone taps them – and each look is noted for the admins."))
                }
                Section {
                    AreaField(area: $area, areas: areas)
                    TextField(L("Note (optional, not secret)"), text: $note)
                }
                Section {
                    Toggle(L("Everyone at home"), isOn: $vis.members)
                    Toggle(L("All babysitter and house-sitter links"), isOn: $vis.sitters)
                } header: { Text(L("Who sees it")) }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if code != nil {
                    Section { Button(L("Delete code"), role: .destructive) { confirmDelete = true } }
                }
            }
            .navigationTitle(code == nil ? L("New code") : L("Edit code"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Save")) { Task { await save() } }.disabled(busy) }
            }
            .confirmationDialog(L("Delete this code?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) { Task { await remove() } }
            }
            .onAppear {
                guard let c = code else { return }
                kind = c.kind ?? "other"
                label = c.label
                area = c.area ?? ""
                note = c.note ?? ""
                ssid = c.wifi?.ssid ?? ""
                security = c.wifi?.security ?? "WPA"
                if let v = c.visibility { vis = v }
            }
            .onDisappear { value = "" }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let l = label.trimmingCharacters(in: .whitespaces)
        let a = area.trimmingCharacters(in: .whitespaces)
        let n = note.trimmingCharacters(in: .whitespaces)
        var body: [String: Any] = [
            "kind": kind, "label": String((l.isEmpty ? HouseGuideLabels.kind(kind) : l).prefix(80)),
            "area": orNull(a.isEmpty ? nil : String(a.prefix(60))), "note": orNull(n.isEmpty ? nil : String(n.prefix(500))),
            "visibility": vis.json,
        ]
        // an empty field keeps the stored value
        if !value.isEmpty { body["value"] = String(value.prefix(200)) }
        if kind == "wifi" {
            let s = ssid.trimmingCharacters(in: .whitespaces)
            body["wifi"] = ["ssid": orNull(s.isEmpty ? nil : s), "security": security] as [String: Any]
        }
        do {
            try await api.saveHouseCode(id: code?.id, body)
            value = ""
            onDone()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func remove() async {
        guard let id = code?.id else { return }
        do {
            try await api.deleteHouseCode(id)
            onDone()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// Room or area with the household's existing areas as quick picks.
private struct AreaField: View {
    @Binding var area: String
    let areas: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            TextField(L("Room or area (optional)"), text: $area)
            if !areas.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(areas, id: \.self) { a in
                            ChoiceChip(title: a, on: area == a) { area = area == a ? "" : a }
                        }
                    }
                }
            }
        }
    }
}

enum HouseGuideLabels {
    static let topics = ["light", "heating", "blinds", "bins", "laundry", "tv", "kitchen", "kids", "emergency", "numbers", "wifi", "other"]
    static let kinds = ["door", "alarm", "garage", "wifi", "safe", "other"]

    static func topic(_ t: String) -> String {
        switch t {
        case "light": return L("Light")
        case "heating": return L("Heating")
        case "blinds": return L("Blinds")
        case "bins": return L("Bins")
        case "laundry": return L("Laundry")
        case "tv": return L("TV")
        case "kitchen": return L("Kitchen")
        case "kids": return L("Kids")
        case "emergency": return L("Emergency")
        case "numbers": return L("Important numbers")
        case "wifi": return L("Wi-Fi")
        default: return L("Other")
        }
    }

    static func kind(_ k: String) -> String {
        switch k {
        case "door": return L("Front door")
        case "alarm": return L("Alarm system")
        case "garage": return L("Garage door")
        case "wifi": return L("Guest Wi-Fi")
        case "safe": return L("Key safe")
        default: return L("Other code")
        }
    }
}

/// a JSON value or null
private func orNull(_ s: String?) -> Any { s.map { $0 as Any } ?? NSNull() }
