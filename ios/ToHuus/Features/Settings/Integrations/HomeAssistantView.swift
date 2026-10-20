import SwiftUI
import UIKit

/// Settings › Connections & devices › Home Assistant (web: pages/Ha2.tsx + HaIntegration.tsx): connect the HACS integration with a code, then
/// per topic who leads (shopping list, meal plan, care tasks), who is home, notifications through the HA app, NFC tags
/// and the voice-command guide. Home Assistant itself runs elsewhere – this screen only configures.
/// API: GET /api/ha2, PATCH /api/ha2/settings, POST /api/ha2/detect|sync|apply-proposals, GET/PATCH/DELETE
/// /api/ha2/tags, POST /api/ha/pair/start, GET /api/ha/pair/status (docs/home-assistant.md).
struct HomeAssistantView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    /// GET /api/ha2 – plain keys (entity ids such as "person.mika_b" are dictionary keys)
    @State private var d: JSONValue?
    @State private var tags: JSONValue?
    @State private var baseUrl: String?
    @State private var error: String?
    @State private var busy: String?
    @State private var toast: ToastMessage?

    static let repo = "https://github.com/tillheidrich/tohuus-hub-ha"
    private var admin: Bool { app.isAdmin }

    var body: some View {
        List {
            if let d {
                headSection(d)
                if d["transport"]?.string == nil {
                    HaIntegrationSetup(api: api, cloud: app.isCloud, baseUrl: baseUrl, admin: admin)
                }
                if let props = d["proposals"]?.array, !props.isEmpty { proposalsSection(d, props) }
                ForEach(["shopping", "meals", "care"], id: \.self) { topic in
                    if let tp = d["topics"]?.array?.first(where: { $0["topic"]?.string == topic }) {
                        HaTopicSection(topic: topic, tp: tp, capabilities: d["capabilities"] ?? .null, legacyTodo: d["legacy_todo"]?.bool == true,
                                       admin: admin) { body in Task { await save(body.object?.mapValues { $0.ixAny } ?? [:]) } }
                    }
                }
                presenceSection(d)
                notifySection(d)
                tagsSection(d)
                Section {
                    NavigationLink { HaVoiceView(api: api) } label: { Label(L("Voice commands for the babysitter page"), systemImage: "mic") }
                    NavigationLink { CookidooView(api: api) } label: { Label(L("Cookidoo meal plan"), systemImage: "fork.knife") }
                    NavigationLink { HaAdvancedView(api: api) } label: { Label(L("Address & token (without the integration)"), systemImage: "key") }
                    if d["transport"]?.string != nil {
                        NavigationLink {
                            List { HaIntegrationSetup(api: api, cloud: app.isCloud, baseUrl: baseUrl, admin: admin) }
                                .themedList()
                                .navigationTitle(L("Connect Home Assistant"))
                        } label: { Label(L("Connect Home Assistant"), systemImage: "link") }
                    }
                } footer: {
                    Text(L("Home Assistant only connects out to ToHuus (HTTPS and live updates). Nothing in your home has to be reachable from the internet."))
                }
            } else if let error {
                Section { ErrorBanner(message: error) { Task { await load() } } }
            } else {
                IxLoadingRow()
            }
        }
        .themedList()
        .navigationTitle("Home Assistant")
        .refreshable { await load() }
        .task { await load() }
        .toast($toast)
    }

    // MARK: head

    @ViewBuilder private func headSection(_ d: JSONValue) -> some View {
        let transport = d["transport"]?.string
        Section {
            Text(L("If parts of this already run in Home Assistant, nothing needs doing twice: ToHuus Hub takes it over and plays changes back."))
                .font(.subheadline).foregroundStyle(Theme.ink2)
            if transport == "integration" {
                let v = d["integration"]?["version"]?.string.map { " \($0)" } ?? ""
                IxStatusLine(text: LF("Connected through the ToHuus Hub integration%@ · last contact %@", v, Self.when(d["integration"]?["seen"]?.string)), ok: true)
            } else if transport == "rest" {
                IxStatusLine(text: L("Connected with the Home Assistant address and token (AI assistants & access)"), ok: true)
            } else {
                IxStatusLine(text: L("Not connected yet – install the integration (recommended) or enter the Home Assistant address and token under Settings › Connections & devices › AI assistants & access."), ok: nil)
            }
            if let n = d["pending_ops"]?.int, n > 0 {
                Text(LF("%d changes waiting for Home Assistant", n)).font(.footnote).foregroundStyle(Theme.ink3)
            }
            if admin {
                Button { Task { await run("detect", "api/ha2/detect", ok: L("Home Assistant checked")) } } label: {
                    HStack { Label(busy == "detect" ? L("Looking …") : L("Look again"), systemImage: "magnifyingglass"); if busy == "detect" { Spacer(); ProgressView() } }
                }
                .disabled(busy != nil || transport == nil)
                Button { Task { await run("sync", "api/ha2/sync", ok: L("Synced")) } } label: {
                    HStack { Label(L("Sync now"), systemImage: "arrow.triangle.2.circlepath"); if busy == "sync" { Spacer(); ProgressView() } }
                }
                .disabled(busy != nil || transport == nil)
            }
        } header: {
            Text(L("What does Home Assistant already do for you?"))
        }
    }

    static func when(_ iso: String?) -> String {
        guard let iso else { return "" }
        return ServerDate.relative(iso) ?? ServerDate.relative(String(iso.replacingOccurrences(of: "T", with: " ").prefix(19))) ?? iso
    }

    // MARK: proposals

    private func topicLabel(_ t: String) -> String {
        switch t {
        case "shopping": return L("Shopping list")
        case "meals": return L("Meal plan")
        case "care": return L("Care tasks")
        case "presence": return L("Who is home")
        case "notify": return L("Notifications")
        case "tags": return L("NFC tags")
        case "voice": return L("Voice commands")
        default: return t
        }
    }

    @ViewBuilder private func proposalsSection(_ d: JSONValue, _ props: [JSONValue]) -> some View {
        Section {
            ForEach(Array(props.enumerated()), id: \.offset) { _, p in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(topicLabel(p["topic"]?.string ?? "")).font(.subheadline.weight(.semibold))
                        Spacer()
                        let m = p["mode"]?.string ?? "off"
                        StatusPill(text: m == "on" ? L("use it") : m == "off" ? L("nothing to do") : HaTopicSection.modeLabel(m), status: m == "off" ? nil : "good")
                    }
                    if let r = p["reason"]?.string { Text(r).font(.footnote).foregroundStyle(Theme.ink2) }
                    if let found = p["found"]?.array, !found.isEmpty {
                        Text(found.prefix(8).compactMap { f in
                            guard let n = f["name"]?.string else { return nil }
                            return f["note"]?.string.map { "\(n) · \($0)" } ?? n
                        }.joined(separator: ", "))
                        .font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .padding(.vertical, 2)
            }
            if admin {
                Button { Task { await run("apply", "api/ha2/apply-proposals", ok: L("Suggestions taken over")) } } label: {
                    Label(L("Take over the suggestions"), systemImage: "checkmark.circle")
                }
                .disabled(busy != nil)
            }
        } header: {
            Text(L("Our suggestion"))
        } footer: {
            if let at = d["capabilities"]?["at"]?.string { Text(L("Found in Home Assistant") + " · " + Self.when(at)) }
        }
    }

    // MARK: presence

    @ViewBuilder private func presenceSection(_ d: JSONValue) -> some View {
        let s = d["settings"]?["presence"] ?? .null
        let enabled = s["enabled"]?.bool ?? false
        let persons = d["capabilities"]?["person"]?.array ?? []
        let users = d["users"]?.array ?? []
        let map = s["map"]?.object ?? [:]
        Section {
            Toggle(isOn: Binding(get: { enabled }, set: { v in Task { await save(["presence": ["enabled": v]]) } })) {
                Label(L("Who is home"), systemImage: "person.2")
            }
            .tint(Theme.primary)
            .disabled(!admin)
            if enabled {
                if persons.isEmpty { Text(L("No people found in Home Assistant yet.")).font(.footnote).foregroundStyle(Theme.ink3) }
                ForEach(Array(persons.enumerated()), id: \.offset) { _, p in
                    let eid = p["entity_id"]?.string ?? ""
                    let live = d["presence"]?.array?.first(where: { $0["entity_id"]?.string == eid })
                    Picker(selection: Binding(get: { map[eid]?.int ?? 0 }, set: { uid in
                        var next = map.mapValues { $0.ixAny }
                        if uid == 0 { next[eid] = NSNull() } else { next[eid] = uid }
                        let body: [String: Any] = ["presence": ["map": next]]
                        Task { await save(body) }
                    })) {
                        Text(L("not a member")).tag(0)
                        ForEach(Array(users.enumerated()), id: \.offset) { _, u in
                            Text(u["name"]?.string ?? "?").tag(u["id"]?.int ?? -1)
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p["name"]?.string ?? eid)
                            Text(liveText(live, p)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    .disabled(!admin)
                }
                if d["away"]?["away"]?.bool == true {
                    Text(LF("Everyone has been away since %@. Going on a trip? Away mode keeps things quiet.", Self.when(d["away"]?["since"]?.string)))
                        .font(.footnote).foregroundStyle(Theme.warning)
                }
            }
        } footer: {
            Text(L("From the people in Home Assistant. Used for “who gets it” and for away mode – never shown to guests."))
        }
    }

    private func liveText(_ live: JSONValue?, _ p: JSONValue) -> String {
        guard let live else { return p["state"]?.string ?? "" }
        var s = live["home"]?.bool == true ? L("home") : L("away")
        if let since = live["since"]?.string { s += " · " + LF("since %@", Self.when(since)) }
        return s
    }

    // MARK: notifications through the HA app

    @ViewBuilder private func notifySection(_ d: JSONValue) -> some View {
        let services = (d["capabilities"]?["notify"]?.ixStrings ?? []).filter { $0.hasPrefix("mobile_app_") }
        let map = d["settings"]?["notify"]?.object ?? [:]
        let users = d["users"]?.array ?? []
        Section {
            if services.isEmpty {
                Text(L("No Home Assistant app found. Install the companion app on a phone, then tap “Look again”."))
                    .font(.footnote).foregroundStyle(Theme.ink3)
            } else {
                ForEach(Array(users.enumerated()), id: \.offset) { _, u in
                    let uid = String(u["id"]?.int ?? 0)
                    Picker(u["name"]?.string ?? "?", selection: Binding(get: { map[uid]?.string ?? "" }, set: { v in
                        var next = map.compactMapValues { $0.string }
                        if v.isEmpty { next.removeValue(forKey: uid) } else { next[uid] = v }
                        let final = next
                        Task { await save(["notify": final]) }
                    })) {
                        Text(L("Push in the app")).tag("")
                        ForEach(services, id: \.self) { s in
                            Text(LF("HA app: %@", s.replacingOccurrences(of: "mobile_app_", with: "").replacingOccurrences(of: "_", with: " "))).tag(s)
                        }
                    }
                    .disabled(!admin)
                }
            }
        } header: {
            Text(L("Notifications through the Home Assistant app"))
        } footer: {
            Text(L("If your household already gets its messages from the Home Assistant app, ToHuus Hub can use it instead of the browser push – per person. Which messages go out at all is still set under Notifications & calendar."))
        }
    }

    // MARK: NFC tags

    private func actionLabel(_ a: String) -> String {
        switch a {
        case "take": return L("one taken")
        case "list": return L("onto the shopping list")
        case "opened": return L("opened")
        case "done": return L("done")
        default: return a
        }
    }

    @ViewBuilder private func tagsSection(_ d: JSONValue) -> some View {
        let enabled = d["settings"]?["tags"]?["enabled"]?.bool ?? false
        let list = tags?["tags"]?.array ?? []
        let targets = tags?["targets"]?.array ?? []
        Section {
            Toggle(isOn: Binding(get: { enabled }, set: { v in Task { await save(["tags": ["enabled": v]]) } })) {
                Label(L("NFC tags"), systemImage: "tag")
            }
            .tint(Theme.primary)
            .disabled(!admin)
            if enabled {
                if list.isEmpty {
                    Text(d["transport"]?.string == "integration" ? L("No tag scanned yet.") : L("Needs the ToHuus Hub integration in Home Assistant."))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
                ForEach(Array(list.enumerated()), id: \.offset) { _, tg in
                    let id = tg["tag_id"]?.string ?? ""
                    let current = (tg["code"]?.string).flatMap { c in tg["action"]?.string.map { "\(c)|\($0)" } } ?? ""
                    Picker(selection: Binding(get: { current }, set: { v in
                        let parts = v.split(separator: "|").map(String.init)
                        Task { await setTag(id, code: parts.first, action: parts.count > 1 ? parts[1] : nil) }
                    })) {
                        Text(L("Nothing yet")).tag("")
                        ForEach(Array(targets.enumerated()), id: \.offset) { _, tt in
                            ForEach(tt["actions"]?.ixStrings ?? [], id: \.self) { a in
                                Text("\(tt["name"]?.string ?? "?") – \(actionLabel(a))").tag("\(tt["code"]?.string ?? "")|\(a)")
                            }
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tg["name"]?.string ?? id)
                            Text(LF("%d scans · last %@", tg["scans"]?.int ?? 0, Self.when(tg["last_seen_at"]?.string)) + (tg["last_device"]?.string.map { " · \($0)" } ?? ""))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    .disabled(!admin)
                    .swipeActions {
                        if admin {
                            Button(role: .destructive) { Task { await deleteTag(id) } } label: { Label(L("Remove"), systemImage: "trash") }
                        }
                    }
                }
                if !list.isEmpty && targets.isEmpty {
                    Text(L("Print a QR label for a product or care task first (Settings › Connections & devices › QR labels) – tags use the same actions."))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
            }
        } footer: {
            Text(L("Scan a tag with the Home Assistant app once – it shows up here. Then choose what a scan does, like a QR label."))
        }
    }

    // MARK: actions

    private func load() async {
        do {
            d = try await api.ixRaw("api/ha2")
            tags = try? await api.ixRaw("api/ha2/tags")
            if baseUrl == nil, !app.isCloud { baseUrl = (try? await api.ixRaw("api/settings"))?["baseUrl"]?.string }
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func run(_ key: String, _ path: String, ok: String) async {
        busy = key
        defer { busy = nil }
        do {
            let r = try await api.ixRawSend("POST", path, json: [:], timeout: 60)
            if let e = r["error"]?.string, !e.isEmpty {
                toast = ToastMessage(text: e, isError: true)
            } else {
                toast = ToastMessage(text: ok)
            }
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func save(_ body: [String: Any]) async {
        do {
            let r = try await api.ixRawSend("PATCH", "api/ha2/settings", json: body)
            if r["settings"] != nil { d = r }
            toast = ToastMessage(text: L("Saved"))
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            await load()
        }
    }

    private func setTag(_ id: String, code: String?, action: String?) async {
        let enc = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
        do {
            _ = try await api.ixRawSend("PATCH", "api/ha2/tags/\(enc)", json: ["code": code.map { $0 as Any } ?? NSNull(), "action": action.map { $0 as Any } ?? NSNull()])
            toast = ToastMessage(text: L("Saved"))
            tags = try? await api.ixRaw("api/ha2/tags")
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func deleteTag(_ id: String) async {
        let enc = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
        do {
            _ = try await api.ixRawSend("DELETE", "api/ha2/tags/\(enc)")
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

/// One topic (shopping list, meal plan, care tasks): who leads, which HA lists/calendars, sync status.
struct HaTopicSection: View {
    let topic: String
    let tp: JSONValue
    let capabilities: JSONValue
    let legacyTodo: Bool
    let admin: Bool
    let onSave: (JSONValue) -> Void
    @State private var mode = "off"
    @State private var ents: [String] = []
    @State private var typed = ""

    static func modeLabel(_ m: String) -> String {
        switch m {
        case "two_way": return L("Both ways")
        case "from_ha": return L("Home Assistant leads")
        case "to_ha": return L("ToHuus leads")
        default: return L("Off")
        }
    }

    private var serverMode: String { tp["mode"]?.string ?? "off" }
    private var serverEnts: [String] { tp["entities"]?.array?.compactMap { $0["entity_id"]?.string } ?? [] }
    private var domain: String { topic == "meals" ? "calendar" : "todo" }
    private var single: Bool { topic == "care" }

    private var meta: (icon: String, title: String, lead: String) {
        switch topic {
        case "meals": return ("calendar", L("Meal plan"), L("Home Assistant calendars: Mealie, Local Calendar, a family calendar"))
        case "care": return ("sparkles", L("Care tasks"), L("Optional: due tasks on a Home Assistant to-do list"))
        default: return ("cart", L("Shopping list"), L("Home Assistant to-do lists: shopping list, Bring!, Todoist, Local To-do, Cookidoo"))
        }
    }

    private func help(_ m: String) -> String? {
        switch (topic, m) {
        case ("shopping", "off"): return L("The lists stay separate.")
        case ("shopping", "two_way"): return L("New items, ticks and changes travel both ways. If both sides change the same thing, the later change wins. Duplicates are merged by name.")
        case ("shopping", "from_ha"): return L("What is added in Home Assistant (Alexa, Bring!, Assist …) comes here; ticks travel both ways. What you add here stays here.")
        case ("shopping", "to_ha"): return L("Your list is copied into Home Assistant; ticking off there ticks off here. What is added there stays there.")
        case ("meals", "off"): return L("ToHuus Hub’s meal plan is in Home Assistant as calendar.tohuus_hub_meal_plan anyway.")
        case ("meals", "from_ha"): return L("Dishes in the calendar come into the meal plan (matched to your recipes by name).")
        case ("meals", "to_ha"): return L("Your meal plan is written into the calendar. Moving or removing entries there needs the integration.")
        case ("meals", "two_way"): return L("Both: dishes come in, your plan goes out. Our own entries carry a marker, so nothing bounces back and forth.")
        case ("care", "off"): return L("Care tasks are in Home Assistant as calendar.tohuus_hub_care_tasks anyway.")
        case ("care", "to_ha"): return L("Due care tasks appear on the to-do list; ticking one off there marks it done here and plans the next time.")
        default: return nil
        }
    }

    private var available: [JSONValue] {
        (capabilities[domain]?.array ?? []).filter { e in
            let id = e["entity_id"]?.string ?? ""
            return !id.hasPrefix("\(domain).tohuus_hub") && !(topic == "meals" && id.contains("cookidoo"))
        }
    }

    private var dirty: Bool { mode != serverMode || ents != serverEnts }

    var body: some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(meta.title).font(.headline)
                    Text(meta.lead).font(.footnote).foregroundStyle(Theme.ink3)
                }
            } icon: { Image(systemName: meta.icon).foregroundStyle(Theme.primaryText) }
            let modes = tp["modes"]?.ixStrings ?? ["off"]
            FlowLayout(spacing: 6) {
                ForEach(modes, id: \.self) { m in
                    IxToggleChip(title: Self.modeLabel(m), systemImage: "circle", on: mode == m, enabled: admin) { mode = m }
                }
            }
            if let h = help(mode) { Text(h).font(.footnote).foregroundStyle(Theme.ink2) }
            if mode != "off" {
                Text(single ? L("Which list") : topic == "meals" ? L("Which calendars") : L("Which lists"))
                    .font(.subheadline.weight(.semibold))
                let extra = ents.filter { e in !available.contains { $0["entity_id"]?.string == e } }
                if available.isEmpty && extra.isEmpty {
                    Text(L("Nothing found yet – tap “Look again” above, or type the entity below.")).font(.footnote).foregroundStyle(Theme.ink3)
                }
                FlowLayout(spacing: 6) {
                    ForEach(Array(available.enumerated()), id: \.offset) { _, a in
                        let id = a["entity_id"]?.string ?? ""
                        let note = topic == "meals" && mode != "from_ha" && a["writable"]?.bool == false ? L("read-only") : a["platform"]?.string
                        IxToggleChip(title: (a["name"]?.string ?? id) + (note.map { " · \($0)" } ?? ""), systemImage: "list.bullet", on: ents.contains(id), enabled: admin) { toggle(id) }
                    }
                    ForEach(extra, id: \.self) { id in
                        IxToggleChip(title: id, systemImage: "list.bullet", on: true, enabled: admin) { toggle(id) }
                    }
                }
                if admin {
                    HStack {
                        TextField("\(domain).…", text: $typed)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.body.monospaced())
                        Button(L("Add")) { toggle(typed.trimmingCharacters(in: .whitespaces)); typed = "" }
                            .disabled(typed.trimmingCharacters(in: .whitespaces).range(of: "^\(domain)\\.[a-z0-9_]+$", options: .regularExpression) == nil)
                    }
                }
            }
            ForEach(Array((tp["entities"]?.array ?? []).enumerated()), id: \.offset) { _, e in
                statusLine(e)
            }
            if topic == "shopping" && legacyTodo {
                Text(L("The older “Shopping list in Home Assistant” sync is on. It is switched off and taken over when you save here."))
                    .font(.footnote).foregroundStyle(Theme.warning)
            }
            if admin && dirty {
                Button(L("Save")) { onSave(.object([topic: .object(["mode": .string(mode), "entities": .array(ents.map { JSONValue.string($0) })])])) }
                    .disabled(mode != "off" && ents.isEmpty)
            }
        }
        .task(id: "\(serverMode)|\(serverEnts.joined(separator: ","))") {
            mode = serverMode
            ents = serverEnts
        }
    }

    private func toggle(_ id: String) {
        guard !id.isEmpty else { return }
        if ents.contains(id) { ents.removeAll { $0 == id } } else { ents = single ? [id] : ents + [id] }
    }

    private func statusLine(_ e: JSONValue) -> some View {
        let id = e["entity_id"]?.string ?? ""
        let st = e["status"] ?? .null
        var text: String
        var ok: Bool? = true
        if let err = st["error"]?.string, !err.isEmpty {
            text = LF("problem %@: %@", HomeAssistantView.when(st["at"]?.string), err)
            ok = false
        } else if let at = st["at"]?.string {
            text = LF("synced %@ · %d linked", HomeAssistantView.when(at), st["linked"]?.int ?? 0)
        } else {
            text = L("waiting for the first sync")
            ok = nil
        }
        if let c = st["conflicts"]?.int, c > 0 { text += " · " + LF("%d conflicts resolved", c) }
        return IxStatusLine(text: "\(id): \(text)", ok: ok)
    }
}

/// HACS integration + pairing by code (web: HaIntegration.tsx HaIntegrationCard/HaPairBlock).
struct HaIntegrationSetup: View {
    let api: APIClient
    let cloud: Bool
    let baseUrl: String?
    let admin: Bool
    @State private var code: String?
    @State private var expires: Date?
    @State private var claimed: String??
    @State private var busy = false
    @State private var error: String?
    @State private var now = Date()

    var body: some View {
        Section {
            Text(L("The ToHuus Hub integration puts your shopping list, meal plan and care tasks into Home Assistant: a to-do list for Assist and voice, calendars, sensors for dashboards, actions and events for automations."))
                .font(.subheadline).foregroundStyle(Theme.ink2)
            Text("1. " + L("In Home Assistant open HACS › ⋮ › Custom repositories, add the address below as type “Integration”, then download “ToHuus Hub” and restart Home Assistant.")).font(.subheadline)
            Text("2. " + L("Tap “Connect Home Assistant” below. You get a short code.")).font(.subheadline)
            Text("3. " + (cloud
                          ? L("In Home Assistant: Settings › Devices & services › Add integration › ToHuus Hub › “ToHuus Cloud”, then enter the code.")
                          : L("In Home Assistant: Settings › Devices & services › Add integration › ToHuus Hub › “Own server”, enter the address below and the code."))).font(.subheadline)
        } header: {
            Text(L("Recommended"))
        }
        Section {
            if let claimed {
                Label {
                    VStack(alignment: .leading) {
                        Text(L("Home Assistant is connected")).font(.headline)
                        if let dev = claimed { Text(dev).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                } icon: { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.primaryText) }
            } else if let code, let expires, expires > now {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Text(L("Enter this code in Home Assistant when you add the ToHuus Hub integration:")).font(.footnote).foregroundStyle(Theme.ink2)
                    Text(code)
                        .font(.system(.largeTitle, design: .monospaced).weight(.semibold))
                        .textSelection(.enabled)
                        .accessibilityLabel(L("Code for Home Assistant"))
                        .accessibilityValue(code.map { String($0) }.joined(separator: " "))
                    let left = max(0, Int(expires.timeIntervalSince(now)))
                    Text(LF("Valid for %@ more. Use it once; it gives Home Assistant its own access, which you can revoke under Settings › Connections & devices › AI assistants & access.", String(format: "%d:%02d", left / 60, left % 60)))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                    HStack {
                        Button { IxClipboard.copy(code) } label: { Label(L("Copy"), systemImage: "doc.on.doc") }
                        Spacer()
                        Button(L("New code")) { Task { await start() } }.disabled(busy)
                    }
                    .buttonStyle(.borderless)
                }
                .task(id: code) { await poll() }
            } else if admin {
                Button { Task { await start() } } label: {
                    HStack { Label(L("Connect Home Assistant"), systemImage: "link"); if busy { Spacer(); ProgressView() } }
                }
                .disabled(busy)
            } else {
                Text(L("Only admins can do this.")).font(.footnote).foregroundStyle(Theme.ink3)
            }
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
        }
        Section {
            IxCopyRow(title: L("Integration repository (HACS)"), value: HomeAssistantView.repo)
            if !cloud, let baseUrl {
                IxCopyRow(title: L("Address of this ToHuus Hub"), value: baseUrl)
            }
            if let u = URL(string: HomeAssistantView.repo) {
                Link(destination: u) { Label(L("Entities, actions and ready-made dashboards"), systemImage: "arrow.up.right.square") }
            }
        } footer: {
            Text(cloud
                 ? L("With the integration, leave “Shopping list in Home Assistant” switched off – its to-do list talks to ToHuus Hub directly.")
                 : L("Use the address Home Assistant can reach. Inside Docker, “localhost” means the container itself."))
        }
    }

    private func start() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.ixRawSend("POST", "api/ha/pair/start", json: [:])
            code = r["code"]?.string
            expires = ServerDate.parse(r["expires_at"]?.string) ?? Date().addingTimeInterval(600)
            now = Date()
            claimed = nil
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    /// every 3 seconds: status (claimed → done) and the countdown
    private func poll() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            now = Date()
            if Int(now.timeIntervalSince1970) % 3 != 0 { continue }
            guard let s = try? await api.ixRaw("api/ha/pair/status") else { continue }
            switch s["state"]?.string {
            case "claimed":
                claimed = .some(s["device"]?.string)
                Haptics.success()
                return
            case "none":
                code = nil
                return
            default: break
            }
            if let expires, expires <= now { return }
        }
    }
}
