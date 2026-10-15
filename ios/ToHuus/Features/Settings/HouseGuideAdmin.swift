import SwiftUI
import UIKit

// Hausinfo for admins (web: pages/HouseGuide.tsx TemplatesSheet, LogSheet, LinkSelectionSheet, PrintSheet).
// API: docs/house-guide.md.

/// GET /api/house-guide/templates → [{ key, name, description, assistant, cards }]
struct HouseTemplate: Decodable, Sendable, Identifiable {
    var key: String
    var name: String
    var description: String?
    var id: String { key }
}

/// GET /api/house-guide/log → [{ code_id, label, viewer, via, at }]
struct HouseLogEntry: Decodable, Sendable, Hashable {
    var codeId: Int?
    var label: String?
    var viewer: String?
    var via: String?
    var at: String?
}

/// GET/PUT/DELETE /api/house-guide/links/:id – what one guest link shows
struct HouseLinkSelection: Decodable, Sendable {
    var link: LinkInfo
    var cards: [Item]
    var codes: [CodeItem]

    struct LinkInfo: Decodable, Sendable { var id: Int; var name: String; var custom: Bool?; var expiresAt: String? }
    struct Item: Decodable, Sendable, Identifiable, Hashable { var id: Int; var title: String; var area: String?; var shown: Bool }
    struct CodeItem: Decodable, Sendable, Identifiable, Hashable { var id: Int; var label: String; var shown: Bool; var until: String? }
}

extension APIClient {
    func houseTemplates() async throws -> [HouseTemplate] { try await get("api/house-guide/templates", as: Lossy<HouseTemplate>.self).wrappedValue }
    /// POST /api/house-guide/templates/:key → { added } – applying twice adds nothing twice
    func applyHouseTemplate(_ key: String) async throws -> Int {
        struct Added: Decodable, Sendable { var added: Int? }
        return try await send("POST", "api/house-guide/templates/\(key)", json: [:], as: Added.self).added ?? 0
    }
    func houseLog() async throws -> [HouseLogEntry] { try await get("api/house-guide/log", as: Lossy<HouseLogEntry>.self).wrappedValue }
    func houseLinkSelection(_ id: Int) async throws -> HouseLinkSelection { try await get("api/house-guide/links/\(id)") }
    func saveHouseLinkSelection(_ id: Int, cards: [Int], codes: [(id: Int, until: String?)]) async throws -> HouseLinkSelection {
        try await send("PUT", "api/house-guide/links/\(id)", json: [
            "cards": cards,
            "codes": codes.map { ["id": $0.id, "until": $0.until.map { $0 as Any } ?? NSNull()] as [String: Any] },
        ])
    }
    func resetHouseLinkSelection(_ id: Int) async throws -> HouseLinkSelection { try await send("DELETE", "api/house-guide/links/\(id)") }
}

/// Starter cards for the voice assistant and typical tips.
struct HouseTemplatesSheet: View {
    let api: APIClient
    let onApplied: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var list: [HouseTemplate]?
    @State private var error: String?
    @State private var busy: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(L("Starter cards for your voice assistant and typical tips. Nothing assumes your home – change or delete what does not fit."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if let list {
                    Section {
                        ForEach(list) { t in
                            Button { Task { await apply(t) } } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(t.name).font(.headline).foregroundStyle(Theme.ink)
                                        if let d = t.description { Text(d).font(.caption).foregroundStyle(Theme.ink3) }
                                    }
                                    Spacer()
                                    if busy == t.key { ProgressView() } else { Image(systemName: "plus").foregroundStyle(Theme.primaryText) }
                                }
                            }
                            .disabled(busy != nil)
                        }
                    }
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
            }
            .themedList()
            .navigationTitle(L("Templates"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .task {
                do { list = try await api.houseTemplates() } catch { self.error = APIError.from(error).localizedDescription }
            }
        }
    }

    private func apply(_ t: HouseTemplate) async {
        busy = t.key
        defer { busy = nil }
        do {
            let n = try await api.applyHouseTemplate(t.key)
            onApplied(n)
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// Who looked at which code when – never the value.
struct HouseLogSheet: View {
    let api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var log: [HouseLogEntry]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(Theme.empty) }
                if let log {
                    if log.isEmpty {
                        Text(L("Nobody has looked at a code yet.")).foregroundStyle(Theme.ink3)
                    }
                    ForEach(Array(log.enumerated()), id: \.offset) { _, l in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.label ?? "–")
                            Text([l.viewer, l.via == "link" ? L("via link") : nil, ServerDate.parse(l.at)?.formatted(date: .abbreviated, time: .shortened)]
                                .compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                } else if error == nil {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
            }
            .themedList()
            .navigationTitle(L("Who looked at codes"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task {
                do { log = try await api.houseLog() } catch { self.error = APIError.from(error).localizedDescription }
            }
        }
    }
}

/// What one babysitter / guest link shows: by default every card meant for sitter links; ticked = exactly these.
struct HouseLinkSelectionSheet: View {
    let api: APIClient
    let link: GuestLink
    let onSaved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var sel: HouseLinkSelection?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            List {
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if let s = sel {
                    Section {
                        Text(s.link.custom == true ? L("This link shows only what is ticked.")
                                                   : L("Right now this link shows every card meant for babysitter links. Tick to choose exactly."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                    Section(L("Cards")) {
                        ForEach(s.cards) { c in
                            Toggle(isOn: Binding(get: { c.shown }, set: { v in setCard(c.id, v) })) {
                                VStack(alignment: .leading) {
                                    Text(c.title)
                                    if let a = c.area, !a.isEmpty { Text(a).font(.caption).foregroundStyle(Theme.ink3) }
                                }
                            }
                        }
                    }
                    if !s.codes.isEmpty {
                        Section {
                            ForEach(s.codes) { c in
                                Toggle(c.label, isOn: Binding(get: { c.shown }, set: { v in setCode(c.id, v) }))
                            }
                        } header: { Text(L("Codes")) } footer: { Text(L("until the link ends")) }
                    }
                    if s.link.custom == true {
                        Section { Button(L("Back to default")) { Task { await reset() } } }
                    }
                } else if error == nil {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
            }
            .themedList()
            .navigationTitle(LF("House info for %@", link.name))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Save")) { Task { await save() } }.disabled(sel == nil || busy) }
            }
            .task {
                do { sel = try await api.houseLinkSelection(link.id) } catch { self.error = APIError.from(error).localizedDescription }
            }
        }
    }

    private func setCard(_ id: Int, _ v: Bool) {
        guard var s = sel, let i = s.cards.firstIndex(where: { $0.id == id }) else { return }
        s.cards[i].shown = v
        sel = s
    }

    private func setCode(_ id: Int, _ v: Bool) {
        guard var s = sel, let i = s.codes.firstIndex(where: { $0.id == id }) else { return }
        s.codes[i].shown = v
        sel = s
    }

    private func save() async {
        guard let s = sel else { return }
        busy = true
        defer { busy = false }
        do {
            sel = try await api.saveHouseLinkSelection(link.id, cards: s.cards.filter(\.shown).map(\.id),
                                                       codes: s.codes.filter(\.shown).map { (id: $0.id, until: $0.until ?? s.link.expiresAt) })
            onSaved(L("Saved – the link shows exactly this now."))
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func reset() async {
        do { sel = try await api.resetHouseLinkSelection(link.id) } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// "Für den Babysitter": the A4 sheet. Codes print as "bitte fragen" unless an admin ticks "Print codes too" – each
/// code is then revealed (and logged). The values exist only in memory and in the print job.
struct HousePrintSheet: View {
    let api: APIClient
    let guide: HouseGuide
    let household: String
    let allowCodes: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var withCodes = false
    @State private var values: [Int: String] = [:]
    @State private var loading = false

    private var cards: [HouseGuide.Card] { guide.cards.filter { !$0.isDraft } }

    var body: some View {
        NavigationStack {
            List {
                if allowCodes && guide.codes.contains(where: { $0.hasValue == true }) {
                    Section {
                        Toggle(L("Print codes too"), isOn: $withCodes)
                    } footer: { Text(L("Each code printed is noted for the admins.")) }
                }
                Section {
                    Text(L("For the babysitter")).font(.title3.weight(.semibold))
                    let numbers = cards.filter { $0.type == "contact" }
                    if !numbers.isEmpty {
                        Text(L("Important numbers")).font(.headline)
                        ForEach(numbers) { c in LabeledContent(c.title, value: c.body ?? "") }
                    }
                    if !guide.codes.isEmpty {
                        Text(L("Codes")).font(.headline)
                        ForEach(guide.codes) { c in
                            LabeledContent(c.label + (c.wifi?.ssid.map { " (\($0))" } ?? ""), value: withCodes ? (values[c.id] ?? "—") : L("ask us"))
                        }
                    }
                    Text(L("…and every card by room.")).font(.caption).foregroundStyle(Theme.ink3)
                } header: { Text(household) }
            }
            .themedList()
            .navigationTitle(L("Print"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Back")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Self.printHTML(html(), title: L("For the babysitter")) } label: { Label(L("Print"), systemImage: "printer") }
                        .disabled(loading)
                }
            }
            .onChange(of: withCodes) { _, on in
                guard on else { values = [:]; return }
                Task { await revealAll() }
            }
            .onDisappear { values = [:] }
        }
    }

    private func revealAll() async {
        loading = true
        defer { loading = false }
        var out: [Int: String] = [:]
        for c in guide.codes where c.hasValue == true {
            if let r = try? await api.send("POST", "api/house-guide/codes/\(c.id)/reveal", as: RevealedCode.self) { out[c.id] = r.value ?? "" }
        }
        values = out
    }

    private func html() -> String {
        func e(_ s: String?) -> String {
            (s ?? "").replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        }
        var h = """
        <html><head><meta charset="utf-8"><style>
        body{font-family:-apple-system,Helvetica,sans-serif;font-size:11pt;color:#181D1A;margin:0}
        .eyebrow{font-size:9pt;text-transform:uppercase;letter-spacing:.08em;color:#545C56}
        h1{font-size:20pt;margin:2pt 0 12pt}h2{font-size:12pt;margin:14pt 0 4pt;border-bottom:1px solid #DEDCD3;padding-bottom:2pt}
        dl{margin:0}dl div{display:flex;justify-content:space-between;padding:2pt 0}dt{font-weight:600}dd{margin:0}
        ul{margin:0;padding-left:14pt}li{margin:2pt 0}
        </style></head><body>
        <div class="eyebrow">\(e(household))</div><h1>\(e(L("For the babysitter")))</h1>
        """
        let numbers = cards.filter { $0.type == "contact" }
        if !numbers.isEmpty {
            h += "<h2>\(e(L("Important numbers")))</h2><dl>"
            for c in numbers { h += "<div><dt>\(e(c.title))</dt><dd>\(e(c.body))</dd></div>" }
            h += "</dl>"
        }
        if !guide.codes.isEmpty {
            h += "<h2>\(e(L("Codes")))</h2><dl>"
            for c in guide.codes {
                let v = withCodes ? (values[c.id].flatMap { $0.isEmpty ? nil : $0 } ?? "—") : L("ask us")
                h += "<div><dt>\(e(c.label))\(c.wifi?.ssid.map { " (\(e($0)))" } ?? "")</dt><dd>\(e(v))</dd></div>"
            }
            h += "</dl>"
        }
        var areas: [String] = []
        let rest = cards.filter { $0.type != "contact" }
        for c in rest where !areas.contains(c.area ?? "") { areas.append(c.area ?? "") }
        for a in areas {
            h += "<h2>\(e(a.isEmpty ? L("Everywhere") : a))</h2><ul>"
            for c in rest where (c.area ?? "") == a {
                let say = c.type == "voice" || c.type == "routine"
                let body = say ? "„\(c.body ?? "")“" : (c.body ?? "")
                h += "<li><b>\(e(c.title)):</b> \(e(body))\(c.detail.map { " – \(e($0))" } ?? "")</li>"
            }
            h += "</ul>"
        }
        if let v = guide.haVoice, !v.groups.isEmpty {
            h += "<h2>\(e(LF("Say it to %@", v.assistantName ?? "Assist")))</h2><ul>"
            for g in v.groups {
                for i in g.items { h += "<li>„\(e(i.phrases?.first ?? i.name))“\(g.area.map { " (\(e($0)))" } ?? "")</li>" }
            }
            h += "</ul>"
        }
        return h + "</body></html>"
    }

    /// AirPrint (or "Save to PDF" from the print dialog) – nothing is written to disk by the app
    @MainActor static func printHTML(_ html: String, title: String) {
        let pc = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = title
        pc.printInfo = info
        let f = UIMarkupTextPrintFormatter(markupText: html)
        f.perPageContentInsets = UIEdgeInsets(top: 48, left: 48, bottom: 48, right: 48)
        pc.printFormatter = f
        if UIDevice.current.userInterfaceIdiom == .pad,
           let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first?.keyWindow {
            pc.present(from: CGRect(x: window.bounds.midX, y: 60, width: 1, height: 1), in: window, animated: true, completionHandler: nil)
        } else {
            pc.present(animated: true, completionHandler: nil)
        }
    }
}
