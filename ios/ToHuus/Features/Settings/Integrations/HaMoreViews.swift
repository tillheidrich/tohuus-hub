import SwiftUI
import UIKit

// Home Assistant, the rarer parts: voice-command guide for the babysitter page (web: Ha2.tsx VoiceCard), Cookidoo
// (CookidooStatus.tsx + Settings.tsx HaConnection) and address & token with the older to-do sync (ShopSettings.tsx
// HaTodoCard).

/// Voice commands guests may use – lights, blinds, heating, music, scenes. Never locks, alarms, cameras, people.
/// API: GET /api/ha2/voice, PUT /api/ha2/voice/settings, POST /api/ha2/voice/import-exposed|entities|items,
/// PATCH/DELETE /api/ha2/voice/items/:id, PUT /api/ha2/voice/links/:id – every answer is the whole view.
struct HaVoiceView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var v: JSONValue?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var editing: JSONValue?
    @State private var picking = false
    @State private var adding = false

    private var admin: Bool { app.isAdmin }

    static func domainLabel(_ d: String) -> String {
        switch d {
        case "light": return L("Lamp")
        case "switch": return L("Plug / switch")
        case "cover": return L("Blinds")
        case "climate": return L("Heating")
        case "fan": return L("Fan")
        case "media_player": return L("Music & TV")
        case "scene": return L("Scene")
        case "script": return L("Routine")
        default: return d
        }
    }

    static func domainIcon(_ d: String) -> String {
        switch d {
        case "light": return "lightbulb"
        case "switch": return "powerplug"
        case "cover": return "blinds.vertical.closed"
        case "climate": return "thermometer.medium"
        case "fan": return "fan"
        case "media_player": return "music.note"
        default: return "sparkles"
        }
    }

    var body: some View {
        List {
            Section {
                Text(L("Shows babysitters and house-sitters what they can switch by voice – lights, blinds, heating, music, scenes. Locks, alarms, cameras, garage doors and people never appear."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let v {
                content(v)
            } else if let error {
                Section { ErrorBanner(message: error) { Task { await load() } } }
            } else {
                IxLoadingRow()
            }
        }
        .themedList()
        .navigationTitle(L("Voice commands"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .toast($toast)
        .sheet(isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
            if let it = editing {
                HaVoiceItemSheet(item: it, domains: v?["domains"]?.ixStrings ?? []) { body, delete in
                    let id = it["id"]?.int ?? 0
                    Task {
                        if delete { await call("DELETE", "api/ha2/voice/items/\(id)", nil, ok: L("Removed")) }
                        else if let body { await call("PATCH", "api/ha2/voice/items/\(id)", body.object?.mapValues { $0.ixAny }, ok: L("Saved")) }
                        editing = nil
                    }
                }
            }
        }
        .sheet(isPresented: $adding) {
            HaVoiceItemSheet(item: nil, domains: v?["domains"]?.ixStrings ?? []) { body, _ in
                Task {
                    if let body { await call("POST", "api/ha2/voice/items", body.object?.mapValues { $0.ixAny }, ok: L("Added")) }
                    adding = false
                }
            }
        }
        .sheet(isPresented: $picking) {
            HaVoicePickSheet(candidates: v?["candidates"]?.array ?? [], assistant: v?["assistant_name"]?.string ?? "") { ids in
                Task {
                    await call("POST", "api/ha2/voice/entities", ["ids": ids], ok: nil, addedToast: true)
                    picking = false
                }
            }
        }
    }

    @ViewBuilder private func content(_ v: JSONValue) -> some View {
        let s = v["settings"] ?? .null
        let items = v["items"]?.array ?? []
        let candidates = v["candidates"]?.array ?? []
        let exposed = candidates.filter { $0["exposed_here"]?.bool == true && $0["added"]?.bool != true && $0["domain"]?.string != "script" }.count
        Section {
            Picker(L("Your voice assistant"), selection: Binding(get: { s["assistant"]?.string ?? "" }, set: { a in
                Task { await call("PUT", "api/ha2/voice/settings", ["assistant": a], ok: nil) }
            })) {
                ForEach(Array((v["assistants"]?.array ?? []).enumerated()), id: \.offset) { _, a in
                    Text(a["name"]?.string ?? "?").tag(a["id"]?.string ?? "")
                }
            }
            .disabled(!admin)
        }
        Section {
            if items.isEmpty {
                Text(L("Nothing listed yet. Take devices over from Home Assistant or add them by hand – it works without Home Assistant, too."))
                    .font(.footnote).foregroundStyle(Theme.ink3)
            }
            ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                Button { if admin { editing = it } } label: {
                    HStack(alignment: .top, spacing: Theme.Space.s3) {
                        Image(systemName: Self.domainIcon(it["domain"]?.string ?? "")).foregroundStyle(Theme.primaryText).frame(width: 24).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text([it["name"]?.string, it["area"]?.string, it["hidden"]?.bool == true ? L("hidden") : nil].compactMap { $0 }.joined(separator: " · "))
                                .foregroundStyle(it["hidden"]?.bool == true ? Theme.ink3 : Theme.ink)
                            ForEach(it["phrases"]?.ixStrings ?? [], id: \.self) { p in
                                Text(LF("“%@”", p)).font(.caption).foregroundStyle(Theme.ink2)
                            }
                        }
                    }
                    .frame(minHeight: 44, alignment: .leading)
                }
                .disabled(!admin)
            }
            if admin {
                if exposed > 0 {
                    Button { Task { await call("POST", "api/ha2/voice/import-exposed", [:], ok: nil, addedToast: true) } } label: {
                        Label(LF("Take over what %@ can reach (%d)", v["assistant_name"]?.string ?? "", exposed), systemImage: "checkmark.circle")
                    }
                }
                if !candidates.isEmpty {
                    Button { picking = true } label: { Label(L("Choose from Home Assistant"), systemImage: "house") }
                }
                Button { adding = true } label: { Label(L("Add by hand"), systemImage: "plus") }
            }
        } header: {
            Text(L("Devices"))
        }
        let links = (v["links"]?.array ?? []).filter { $0["scopes"]?.ixStrings.contains("stock") == true }
        Section {
            Toggle(L("On for every babysitter and house-sitter link unless switched off below"), isOn: Binding(get: { s["sitter_default"]?.bool != false }, set: { on in
                Task { await call("PUT", "api/ha2/voice/settings", ["sitter_default": on], ok: nil) }
            }))
            .tint(Theme.primary)
            .disabled(!admin)
            if links.isEmpty {
                Text(L("No babysitter link yet. Create one under Guests & Bar › Guest links with “Where is what?”."))
                    .font(.footnote).foregroundStyle(Theme.ink3)
            }
            ForEach(Array(links.enumerated()), id: \.offset) { _, l in
                Toggle(l["name"]?.string ?? "?", isOn: Binding(get: { l["voice"]?.bool ?? false }, set: { on in
                    Task { await call("PUT", "api/ha2/voice/links/\(l["id"]?.int ?? 0)", ["on": on], ok: nil) }
                }))
                .tint(Theme.primary)
                .disabled(!admin)
            }
        } header: {
            Text(L("Shown on these guest links"))
        }
    }

    private func load() async {
        do {
            v = try await api.ixRaw("api/ha2/voice")
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func call(_ method: String, _ path: String, _ body: [String: Any]?, ok: String?, addedToast: Bool = false) async {
        do {
            let r = try await api.ixRawSend(method, path, json: body)
            if r["settings"] != nil { v = r } else { await load() }
            if addedToast { toast = ToastMessage(text: LF("%d added", r["added"]?.int ?? 0)) }
            else if let ok { toast = ToastMessage(text: ok) }
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

/// Edit (or add by hand) one voice item: name as you say it, kind, room, phrases, hidden on guest pages.
struct HaVoiceItemSheet: View {
    let item: JSONValue?
    let domains: [String]
    /// (body, delete)
    let onDone: (JSONValue?, Bool) -> Void
    @State private var name = ""
    @State private var area = ""
    @State private var domain = "light"
    @State private var text = ""
    @State private var hidden = false
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section(L("Name as you say it")) {
                    TextField(L("e.g. the reading lamp"), text: $name)
                }
                if item == nil {
                    Picker(L("Kind"), selection: $domain) {
                        ForEach(domains.isEmpty ? ["light"] : domains, id: \.self) { d in Text(HaVoiceView.domainLabel(d)).tag(d) }
                    }
                }
                Section(L("Room")) {
                    TextField(L("e.g. Living room"), text: $area)
                }
                Section {
                    TextField(L("Phrases (one per line)"), text: $text, axis: .vertical).lineLimit(3...6)
                } footer: {
                    Text(L("Leave empty to use the suggested phrases for your assistant."))
                }
                if item != nil {
                    Toggle(L("Hide on guest pages"), isOn: $hidden).tint(Theme.primary)
                    Section {
                        Button(L("Remove"), role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .themedList()
            .navigationTitle(item?["name"]?.string ?? L("Add by hand"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { onDone(nil, false) } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(item == nil ? L("Add") : L("Save")) { onDone(payload(), false) }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog(L("Remove?"), isPresented: $confirmDelete) {
                Button(L("Remove"), role: .destructive) { onDone(nil, true) }
            }
            .onAppear {
                guard let item else { return }
                name = item["name"]?.string ?? ""
                area = item["area"]?.string ?? ""
                domain = item["domain"]?.string ?? "light"
                let custom = item["custom"]?.ixStrings
                text = ((custom?.isEmpty == false ? custom : nil) ?? item["phrases"]?.ixStrings ?? []).joined(separator: "\n")
                hidden = item["hidden"]?.bool ?? false
            }
        }
    }

    private func payload() -> JSONValue {
        let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let phrases = JSONValue.array(lines.prefix(5).map { JSONValue.string($0) })
        var b: [String: JSONValue] = ["name": .string(String(name.prefix(80))), "area": area.isEmpty ? .null : .string(String(area.prefix(60)))]
        if let item {
            // unchanged suggested phrases stay automatic
            let auto = (item["custom"]?.isNull ?? true) && lines == (item["phrases"]?.ixStrings ?? [])
            b["phrases"] = auto || lines.isEmpty ? .null : phrases
            b["hidden"] = .bool(hidden)
        } else {
            b["domain"] = .string(domain)
            b["phrases"] = phrases
        }
        return .object(b)
    }
}

/// Pick devices Home Assistant knows.
struct HaVoicePickSheet: View {
    let candidates: [JSONValue]
    let assistant: String
    let onAdd: ([String]) -> Void
    @State private var sel: Set<String> = []
    @State private var q = ""
    @Environment(\.dismiss) private var dismiss

    private var list: [JSONValue] {
        let n = q.trimmingCharacters(in: .whitespaces).lowercased()
        return candidates.filter { c in
            c["added"]?.bool != true && (n.isEmpty || "\(c["name"]?.string ?? "") \(c["area"]?.string ?? "") \(c["entity_id"]?.string ?? "")".lowercased().contains(n))
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if list.isEmpty { Text(L("Nothing left to add.")).foregroundStyle(Theme.ink3) }
                    ForEach(Array(list.enumerated()), id: \.offset) { _, c in
                        let id = c["entity_id"]?.string ?? ""
                        Button {
                            if sel.contains(id) { sel.remove(id) } else { sel.insert(id) }
                        } label: {
                            HStack(spacing: Theme.Space.s3) {
                                Image(systemName: sel.contains(id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(sel.contains(id) ? Theme.primaryText : Theme.ink3)
                                Image(systemName: HaVoiceView.domainIcon(c["domain"]?.string ?? "")).frame(width: 22).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(c["name"]?.string ?? id).foregroundStyle(Theme.ink)
                                    Text([c["area"]?.string, HaVoiceView.domainLabel(c["domain"]?.string ?? ""), c["exposed_here"]?.bool == true ? assistant : nil].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(Theme.ink3)
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        .accessibilityAddTraits(sel.contains(id) ? .isSelected : [])
                    }
                } footer: {
                    Text(LF("Marked “%@” = already reachable by %@. Scripts only if they are safe for guests.", assistant, assistant))
                }
            }
            .themedList()
            .searchable(text: $q)
            .navigationTitle(L("Choose from Home Assistant"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(LF("Add %d", sel.count)) { onAdd(Array(sel)) }.disabled(sel.isEmpty)
                }
            }
        }
    }
}

// MARK: - Cookidoo

/// Settings › Cookidoo: which way the Cookidoo week arrives (the HA integration sends it, or ToHuus fetches it from
/// Home Assistant with a token), when it last did, and "Save & sync".
/// API: GET /api/cook2/cookidoo/status, GET/PATCH /api/settings › ha, POST /api/plan/cookidoo-sync.
struct CookidooView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var status: JSONValue?
    @State private var calendar = ""
    @State private var busy = false
    @State private var toast: ToastMessage?

    var body: some View {
        Form {
            Section {
                Text(L("Cookidoo has no open API, but the Home Assistant “Cookidoo” integration shows “My week” as a calendar. There are two ways to get the planned dishes into the meal plan:"))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            Section {
                Text(L("With the HACS integration set up, Home Assistant sends the Cookidoo week by itself – every three hours and whenever it changes. Nothing to enter here. Options in Home Assistant: “Send the Cookidoo week to ToHuus Hub” and the calendar."))
                    .font(.footnote)
                if let push = status?["push"], !push.isNull {
                    IxStatusLine(text: LF("Last received %@: %d dishes, %d new, %d removed",
                                          HomeAssistantView.when(push["at"]?.string), push["events"]?.int ?? 0, push["added"]?.int ?? 0, push["removed"]?.int ?? 0), ok: true)
                } else if status != nil {
                    IxStatusLine(text: L("Nothing received from Home Assistant yet."), ok: nil)
                }
            } header: {
                Text("1 · " + L("Recommended: the ToHuus Hub integration in Home Assistant"))
            }
            Section {
                Text(L("Without the integration: enter your Home Assistant address and a long-lived token below.")).font(.footnote)
                NavigationLink { HaAdvancedView(api: api) } label: {
                    LabeledContent(L("Home Assistant address"), value: status?["pull"]?.bool == true ? L("set up") : L("not set up"))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("Calendar entity")).font(.caption).foregroundStyle(Theme.ink3)
                    TextField("calendar.cookidoo_speiseplan", text: $calendar)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().font(.body.monospaced())
                        .disabled(!app.isAdmin)
                    Text(LF("Integration default: %@", "calendar.cookidoo_speiseplan")).font(.caption).foregroundStyle(Theme.ink3)
                }
                if app.isAdmin {
                    Button { Task { await save(sync: false) } } label: { Text(L("Save")) }.disabled(busy)
                    Button { Task { await save(sync: true) } } label: {
                        HStack { Text(L("Save & sync")); if busy { Spacer(); ProgressView() } }
                    }
                    .disabled(busy || status?["pull"]?.bool != true)
                }
            } header: {
                Text("2 · " + L("Alternative: ToHuus Hub fetches it with a Home Assistant token"))
            }
        }
        .themedList()
        .navigationTitle("Cookidoo")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
    }

    private func load() async {
        status = try? await api.ixRaw("api/cook2/cookidoo/status")
        if calendar.isEmpty { calendar = status?["calendar"]?.string ?? "" }
    }

    private func save(sync: Bool) async {
        busy = true
        defer { busy = false }
        do {
            _ = try await api.ixRawSend("PATCH", "api/settings", json: ["ha": ["cookidooCalendar": calendar.trimmingCharacters(in: .whitespaces)]])
            if sync {
                let r = try await api.ixRawSend("POST", "api/plan/cookidoo-sync", json: [:], timeout: 60)
                if let e = r["error"]?.string, !e.isEmpty { throw APIError.server(status: 400, message: e) }
                toast = ToastMessage(text: LF("Cookidoo: %d entries read, %d new in the meal plan", r["events"]?.int ?? 0, r["added"]?.int ?? 0))
            } else {
                toast = ToastMessage(text: L("Saved"))
            }
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

// MARK: - address & token

/// Home Assistant address + long-lived token (ToHuus → HA, for setups without the integration) and the older
/// two-way sync of the shopping list with one HA to-do entity.
/// API: GET/PATCH /api/settings › ha, GET/PUT /api/shop/ha-todo, POST /api/shop/ha-todo/sync.
struct HaAdvancedView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var url = ""
    @State private var token = ""
    @State private var todo: JSONValue?
    @State private var entity = ""
    @State private var busy = false
    @State private var toast: ToastMessage?
    @State private var loaded = false

    var body: some View {
        Form {
            Section {
                TextField("https://ha.example.de", text: $url)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField(L("In HA: Profile › Security › Create token"), text: $token)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().font(.body.monospaced())
                Button { Task { await saveConnection() } } label: {
                    HStack { Text(L("Save")); if busy { Spacer(); ProgressView() } }
                }
                .disabled(busy)
            } header: {
                Text(L("Home Assistant address and long-lived access token"))
            } footer: {
                Text(L("Only needed without the integration. The token stays on the server and is never shown again."))
            }
            .disabled(!app.isAdmin)

            if let todo {
                let st = todo["status"] ?? .null
                Section {
                    Toggle(L("Shopping list in Home Assistant"), isOn: Binding(get: { todo["enabled"]?.bool ?? false }, set: { v in
                        Task { await saveTodo(["enabled": v, "entity": entity]) }
                    }))
                    .tint(Theme.primary)
                    if todo["connected"]?.bool != true {
                        Text(L("Enter the Home Assistant address and token above first.")).font(.footnote).foregroundStyle(Theme.low)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L("To-do entity")).font(.caption).foregroundStyle(Theme.ink3)
                        TextField("todo.shopping_list", text: $entity)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().font(.body.monospaced())
                    }
                    if let at = st["at"]?.string {
                        if let e = st["error"]?.string, !e.isEmpty {
                            IxStatusLine(text: LF("Last attempt %@: %@", HomeAssistantView.when(at), e), ok: false)
                        } else {
                            IxStatusLine(text: LF("Last synced %@ · %d entries in Home Assistant", HomeAssistantView.when(at), st["items"]?.int ?? 0), ok: true)
                        }
                    }
                    Button(L("Save")) { Task { await saveTodo(["entity": entity]) } }
                        .disabled(busy || entity.range(of: "^todo\\.[a-z0-9_]+$", options: .regularExpression) == nil)
                    Button { Task { await syncTodo() } } label: { Label(L("Sync now"), systemImage: "arrow.triangle.2.circlepath") }
                        .disabled(busy || todo["enabled"]?.bool != true || todo["connected"]?.bool != true)
                } footer: {
                    Text(L("Keeps the list in step with a Home Assistant to-do list, both ways. With the integration, leave this switched off – its to-do list talks to ToHuus Hub directly."))
                }
                .disabled(!app.isAdmin)
            }
        }
        .themedList()
        .navigationTitle(L("Address & token"))
        .navigationBarTitleDisplayMode(.inline)
        .task { if !loaded { await load(); loaded = true } }
        .toast($toast)
    }

    private func load() async {
        if let s = try? await api.ixRaw("api/settings") {
            url = s["ha"]?["url"]?.string ?? ""
            token = s["ha"]?["token"]?.string ?? ""
        }
        todo = try? await api.ixRaw("api/shop/ha-todo")
        entity = todo?["entity"]?.string ?? ""
    }

    private func saveConnection() async {
        busy = true
        defer { busy = false }
        do {
            // "••••" keeps the saved token
            _ = try await api.ixRawSend("PATCH", "api/settings", json: ["ha": ["url": url.trimmingCharacters(in: .whitespaces), "token": token]])
            toast = ToastMessage(text: L("Saved"))
            todo = try? await api.ixRaw("api/shop/ha-todo")
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func saveTodo(_ body: [String: Any]) async {
        busy = true
        defer { busy = false }
        var b = body
        if let e = b["entity"] as? String, e.range(of: "^todo\\.[a-z0-9_]+$", options: .regularExpression) == nil { b.removeValue(forKey: "entity") }
        do {
            _ = try await api.ixRawSend("PUT", "api/shop/ha-todo", json: b)
            toast = ToastMessage(text: L("Saved"))
            todo = try? await api.ixRaw("api/shop/ha-todo")
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func syncTodo() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.ixRawSend("POST", "api/shop/ha-todo/sync", json: [:], timeout: 60)
            if let e = r["error"]?.string, !e.isEmpty { throw APIError.server(status: 400, message: e) }
            toast = ToastMessage(text: LF("Synced: %d new here, %d new in Home Assistant", r["added_here"]?.int ?? 0, r["added_there"]?.int ?? 0))
            todo = try? await api.ixRaw("api/shop/ha-todo")
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}
