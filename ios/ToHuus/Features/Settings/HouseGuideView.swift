import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// GET /api/house-guide → { cards, codes (masked), ha_voice, areas, can_edit }
struct HouseGuide: Decodable, Sendable {
    @Lossy var cards: [Card]
    @Lossy var codes: [Code]
    var haVoice: HAVoice?
    var areas: [String]?
    var canEdit: Bool?

    struct Card: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        /// voice | routine | tip | contact
        var type: String?
        var topic: String?
        var area: String?
        var title: String
        var body: String?
        var detail: String?
        var assistant: String?
        /// admins only: template cards still to fill in, with a hint what belongs there
        var draft: JSONValue?
        var hint: String?
        /// admins only
        var visibility: HGVisibility?
        /// photos and short videos (HouseGuideMedia.swift)
        var media: [HGMedia]?

        var isDraft: Bool { draft?.bool == true }
    }

    /// A code is a secret: only `masked` and `has_value` here; the value comes from one explicit, logged reveal.
    struct Code: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        /// door | alarm | garage | wifi | safe | other
        var kind: String?
        var label: String
        var area: String?
        var note: String?
        var hasValue: Bool?
        var masked: String?
        var wifi: CodeWifi?
        /// admins only
        var visibility: HGVisibility?
        /// admins only: who looked last
        var lastViews: [CodeView]?
    }

    struct CodeWifi: Decodable, Sendable, Hashable {
        var ssid: String?
        var security: String?
        var hidden: Bool?
    }

    struct CodeView: Decodable, Sendable, Hashable {
        var viewer: String?
        var via: String?
        var at: String?
    }

    /// Home Assistant's voice list (server/lib/ha2-voice.ts) – what you can say to the voice assistant
    struct HAVoice: Decodable, Sendable {
        var assistant: String?
        var assistantName: String?
        @Lossy var groups: [VoiceGroup]
    }

    struct VoiceGroup: Decodable, Sendable {
        var area: String?
        @Lossy var items: [VoiceItem]
    }

    struct VoiceItem: Decodable, Sendable, Hashable, Identifiable {
        var id: Int
        var name: String
        var phrases: [String]?
        /// device | routine
        var kind: String?
    }
}

/// POST /api/house-guide/codes/:id/reveal → { id, value, wifi: { ssid, security, hidden, qr } | null }
struct RevealedCode: Decodable, Sendable {
    var id: Int
    var value: String?
    var wifi: Wifi?
    struct Wifi: Decodable, Sendable {
        var ssid: String?
        var security: String?
        var qr: String?
    }
}

/// Mehr › Hausinfo (web: pages/HouseGuide.tsx): codes on top, cards by room or by kind, search, the Home Assistant
/// voice list, the A4 sheet; for admins templates, "who looked at codes" and what each babysitter link shows.
/// Revealed values live only in memory for a minute – never written to disk, never cached, never in notifications.
struct HouseGuideView: View {
    @Environment(AppModel.self) private var app
    @State private var guide: HouseGuide?
    @State private var state: String?
    @State private var revealed: [Int: RevealedCode] = [:]
    @State private var editCard: EditTarget<HouseGuide.Card>?
    @State private var editCode: EditTarget<HouseGuide.Code>?
    @State private var byKind = SharedConfig.defaults.string(forKey: "hg.group") == "type"
    @State private var query = ""
    @State private var showTemplates = false
    @State private var showLog = false
    @State private var showPrint = false
    @State private var sitterLinks: [GuestLink] = []
    @State private var pickLink: GuestLink?
    @State private var toast: ToastMessage?

    /// nil item = new
    struct EditTarget<T>: Identifiable { var item: T?; let id = UUID() }

    private var canEdit: Bool { guide?.canEdit == true }

    private static let typeOrder = ["contact", "tip", "voice", "routine"]

    var body: some View {
        List {
            if let state { Text(state).foregroundStyle(Theme.ink3) }
            if let g = guide {
                let empty = g.cards.isEmpty && g.codes.isEmpty && (g.haVoice?.groups.isEmpty ?? true)
                if empty {
                    EmptyStateView(systemImage: "book", title: L("How do things work here?"),
                                   message: L("Write down what a babysitter or guest needs: “Alexa, gute Nacht” and what it does, how the heating works, where the fuse box is, important numbers. Codes stay hidden until someone taps them."),
                                   art: .book,
                                   actionTitle: canEdit ? L("Start with a template") : nil,
                                   action: canEdit ? { showTemplates = true } : nil)
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        Picker(L("Group by"), selection: $byKind) {
                            Text(L("By room")).tag(false)
                            Text(L("By kind")).tag(true)
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: byKind) { _, v in SharedConfig.defaults.set(v ? "type" : "area", forKey: "hg.group") }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    content(g)
                }
                if canEdit { manage }
            } else if state == nil {
                ProgressView()
            }
            Section {
                HelpLink(slug: "hausinfo", title: L("House info for guests and sitters"))
                HelpLink(slug: "hausinfo-codes", title: L("Sharing codes safely"))
            }
        }
        .themedList()
        .navigationTitle(L("House info"))
        .onAppear { app.screenContext = "house" }
        .onDisappear { if app.screenContext == "house" { app.screenContext = nil } }
        .searchable(text: $query, prompt: L("Search, e.g. heating"))
        .toolbar {
            if let g = guide, !(g.cards.isEmpty && g.codes.isEmpty) {
                ToolbarItem(placement: .secondaryAction) {
                    Button { showPrint = true } label: { Label(L("Print"), systemImage: "printer") }
                }
            }
            if canEdit {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { editCard = EditTarget(item: nil) } label: { Label(L("New card"), systemImage: "text.below.photo") }
                        Button { editCode = EditTarget(item: nil) } label: { Label(L("New code"), systemImage: "key") }
                        Button { showTemplates = true } label: { Label(L("Templates"), systemImage: "sparkles") }
                    } label: { Image(systemName: "plus") }
                    .accessibilityLabel(L("Add"))
                }
            }
        }
        .sheet(item: $editCard) { t in
            if let api = app.api {
                HouseCardEditor(api: api, card: t.item, areas: guide?.areas ?? []) { Task { await load() } }
            }
        }
        .sheet(item: $editCode) { t in
            if let api = app.api {
                HouseCodeEditor(api: api, code: t.item, areas: guide?.areas ?? []) { Task { await load() } }
            }
        }
        .sheet(isPresented: $showTemplates) {
            if let api = app.api {
                HouseTemplatesSheet(api: api) { added in
                    toast = ToastMessage(text: added > 0 ? LF("%d cards added – fill in what applies, delete the rest.", added) : L("These cards are already there."))
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: $showLog) { if let api = app.api { HouseLogSheet(api: api) } }
        .sheet(item: $pickLink) { l in
            if let api = app.api {
                HouseLinkSelectionSheet(api: api, link: l) { msg in
                    toast = ToastMessage(text: msg)
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: $showPrint) {
            if let api = app.api, let g = guide {
                HousePrintSheet(api: api, guide: g, household: app.activeHousehold?.name ?? "", allowCodes: canEdit)
            }
        }
        .toast($toast)
        .task { await load() }
        .refreshable { await load() }
        .onDisappear { revealed = [:] }
    }

    // MARK: content

    private func matches(_ c: HouseGuide.Card) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || "\(c.title) \(c.body ?? "") \(c.detail ?? "") \(c.area ?? "")".lowercased().contains(q)
    }

    private func matches(_ c: HouseGuide.Code) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || "\(c.label) \(c.area ?? "") \(HouseGuideLabels.kind(c.kind ?? "other"))".lowercased().contains(q)
    }

    @ViewBuilder
    private func content(_ g: HouseGuide) -> some View {
        let cards = g.cards.filter { matches($0) }
        let codes = g.codes.filter { matches($0) }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let voice = (g.haVoice?.groups ?? []).map { vg in
            VoiceSection(area: vg.area, items: vg.items.filter { i in q.isEmpty || "\(i.name) \((i.phrases ?? []).joined(separator: " ")) \(vg.area ?? "")".lowercased().contains(q) })
        }.filter { !$0.items.isEmpty }
        if cards.isEmpty && codes.isEmpty && voice.isEmpty {
            Text(q.isEmpty ? L("Nothing here yet") : LF("Nothing matches “%@”.", query)).foregroundStyle(Theme.ink3)
        }
        if !codes.isEmpty {
            Section {
                ForEach(codes) { c in
                    codeRow(c)
                        .swipeActions(edge: .leading) {
                            if canEdit { Button { editCode = EditTarget(item: c) } label: { Label(L("Edit"), systemImage: "pencil") }.tint(Theme.primary) }
                        }
                        .contextMenu {
                            if canEdit { Button { editCode = EditTarget(item: c) } label: { Label(L("Edit"), systemImage: "pencil") } }
                        }
                        .accessibilityAction(named: L("Edit")) { if canEdit { editCode = EditTarget(item: c) } }
                }
            } header: { Label(L("Codes"), systemImage: "lock") }
        }
        ForEach(sections(cards), id: \.key) { s in
            Section {
                ForEach(s.cards) { c in
                    cardRow(c, showArea: byKind)
                        .contentShape(Rectangle())
                        .onTapGesture { if canEdit { editCard = EditTarget(item: c) } }
                        .accessibilityAction(named: L("Edit")) { if canEdit { editCard = EditTarget(item: c) } }
                }
            } header: { Text(s.title) }
        }
        if !voice.isEmpty {
            ForEach(voice, id: \.key) { vg in
                Section {
                    ForEach(vg.items) { i in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(i.name).font(.subheadline.weight(.semibold))
                                if i.kind == "routine" { Text(L("Routine")).font(.caption2).padding(.horizontal, 6).background(Theme.surface2, in: Capsule()) }
                            }
                            if let p = i.phrases?.first { Text("„\(p)“").font(.subheadline).foregroundStyle(Theme.ink2) }
                        }
                    }
                } header: {
                    Label(LF("Say it to %@ · %@", g.haVoice?.assistantName ?? "Assist", vg.area ?? L("Everywhere")), systemImage: "mic")
                }
            }
        }
    }

    private struct VoiceSection {
        let area: String?
        let items: [HouseGuide.VoiceItem]
        var key: String { area ?? "_" }
    }

    private struct CardSection { let key: String; let title: String; let cards: [HouseGuide.Card] }

    private func sections(_ cards: [HouseGuide.Card]) -> [CardSection] {
        if byKind {
            return Self.typeOrder.compactMap { ty in
                let list = cards.filter { ($0.type ?? "tip") == ty }
                return list.isEmpty ? nil : CardSection(key: ty, title: HouseGuideLabels.typeTitle(ty), cards: list)
            }
        }
        var areas: [String] = []
        for c in cards where !areas.contains(c.area ?? "") { areas.append(c.area ?? "") }
        areas.sort { a, b in a.isEmpty ? false : b.isEmpty ? true : a.localizedCompare(b) == .orderedAscending }
        return areas.map { a in
            let list = cards.filter { ($0.area ?? "") == a }
                .sorted { (Self.typeOrder.firstIndex(of: $0.type ?? "tip") ?? 9) < (Self.typeOrder.firstIndex(of: $1.type ?? "tip") ?? 9) }
            return CardSection(key: a.isEmpty ? "_" : a, title: a.isEmpty ? L("Everywhere") : a, cards: list)
        }
    }

    private var manage: some View {
        Section {
            Button { editCode = EditTarget(item: nil) } label: { Label(L("Add code"), systemImage: "key") }
            Button { showTemplates = true } label: { Label(L("Templates"), systemImage: "sparkles") }
            Button { showLog = true } label: { Label(L("Who looked at codes"), systemImage: "eye") }
            if let api = app.api {
                NavigationLink { GuestLinksView(api: api) } label: { Label(L("Links for babysitters and guests"), systemImage: "link") }
            }
            ForEach(sitterLinks) { l in
                Button { pickLink = l } label: {
                    LabeledContent { Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3) } label: {
                        Label(LF("What “%@” shows", l.name), systemImage: "figure.and.child.holdinghands")
                    }
                }
            }
        } header: { Text(L("Manage")) } footer: {
            Text(L("Codes are never sent to the assistant, AI, Home Assistant, displays or notifications, and they stay out of the export unless you tick them."))
        }
    }

    private func cardRow(_ c: HouseGuide.Card, showArea: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Label(c.title, systemImage: icon(c)).font(.headline)
                Spacer(minLength: 4)
                if showArea, let a = c.area, !a.isEmpty { Text(a).font(.caption2).foregroundStyle(Theme.ink2).padding(.horizontal, 6).background(Theme.surface2, in: Capsule()) }
                if c.isDraft { Text(L("to fill in")).font(.caption2.weight(.semibold)).foregroundStyle(Theme.warning).padding(.horizontal, 6).background(Theme.warningSoft, in: Capsule()) }
            }
            if let b = c.body, !b.isEmpty {
                if c.type == "contact", let tel = Self.telURL(b) {
                    Link(b, destination: tel).font(.subheadline)
                } else {
                    Text(c.type == "voice" || c.type == "routine" ? "„\(b)“" : b).font(.subheadline)
                }
            } else if let h = c.hint, !h.isEmpty {
                Text(h).font(.caption).foregroundStyle(Theme.ink3)
            }
            if let d = c.detail, !d.isEmpty {
                Text(c.type == "routine" ? "\(L("What happens:")) \(d)" : d).font(.caption).foregroundStyle(Theme.ink2)
            }
            if let m = c.media, !m.isEmpty { HGMediaStrip(media: m, title: c.title).padding(.top, 4) }
        }
        .padding(.vertical, 2)
    }

    /// a phone number (web: /^[+\d][\d\s/()-]{2,}$/) → tel: link
    static func telURL(_ s: String) -> URL? {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard t.range(of: #"^[+\d][\d\s/()-]{2,}$"#, options: .regularExpression) != nil else { return nil }
        return URL(string: "tel:" + t.filter { $0.isNumber || $0 == "+" })
    }

    private func icon(_ c: HouseGuide.Card) -> String {
        switch c.type {
        case "voice": return "waveform"
        case "routine": return "repeat"
        case "contact": return "phone"
        default:
            switch c.topic {
            case "emergency": return "exclamationmark.triangle"
            case "light": return "lightbulb"
            case "heating": return "thermometer.medium"
            case "bins": return "trash"
            case "laundry": return "washer"
            case "tv": return "tv"
            case "wifi": return "wifi"
            default: return "info.circle"
            }
        }
    }

    @ViewBuilder
    private func codeRow(_ c: HouseGuide.Code) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(c.label, systemImage: c.kind == "wifi" ? "wifi" : (c.kind == "alarm" || c.kind == "safe") ? "lock" : "key")
                Spacer()
                if let r = revealed[c.id], let v = r.value {
                    Text(v).font(.body.monospaced()).textSelection(.enabled)
                    Button(L("Hide")) { withAnimation { revealed[c.id] = nil } }
                        .buttonStyle(.bordered).controlSize(.small)
                } else if revealed[c.id] != nil {
                    Button(L("Hide")) { withAnimation { revealed[c.id] = nil } }
                        .buttonStyle(.bordered).controlSize(.small)
                } else if c.hasValue == true {
                    Text(c.masked ?? "••••").foregroundStyle(Theme.ink3)
                    Button(L("Show")) { Task { await reveal(c) } }
                        .buttonStyle(.bordered).controlSize(.small)
                }
            }
            let sub = [c.area, c.wifi?.ssid.map { LF("Network: %@", $0) }, c.note].compactMap { $0 }.filter { !$0.isEmpty }
            if !sub.isEmpty { Text(sub.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink2) }
            if let v = c.lastViews?.first, let who = v.viewer {
                Text(LF("Last shown to %@, %@", who, ServerDate.relative(v.at) ?? "")).font(.caption2).foregroundStyle(Theme.ink3)
            }
            if let r = revealed[c.id] {
                if let qr = r.wifi?.qr, let img = Self.qrImage(qr) {
                    Image(uiImage: img).interpolation(.none).resizable().frame(width: 160, height: 160)
                        .accessibilityLabel(LF("Wi-Fi QR code for %@", r.wifi?.ssid ?? c.label))
                    Text(L("Scan with the phone camera to join the Wi-Fi.")).font(.caption2).foregroundStyle(Theme.ink3)
                }
                HStack {
                    if let v = r.value {
                        Button(L("Copy")) {
                            // local only and gone after a minute – no Handoff, no lasting clipboard
                            UIPasteboard.general.setItems([["public.utf8-plain-text": v]],
                                                          options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(60)])
                        }
                        .font(.caption)
                    }
                    Text(L("Hidden again in a minute. Each look is noted for the admins.")).font(.caption2).foregroundStyle(Theme.ink3)
                }
                .task(id: c.id) {
                    try? await Task.sleep(nanoseconds: 60_000_000_000)
                    revealed[c.id] = nil
                }
            }
        }
    }

    private func load() async {
        guard let api = app.api else { return }
        do {
            guide = try await api.get("api/house-guide", as: HouseGuide.self)
            state = nil
            if guide?.canEdit == true {
                sitterLinks = ((try? await api.guestLinks()) ?? []).filter { $0.scopes.contains("stock") }
            }
            #if DEBUG
            // simulator checks: -debugMore housecard-new | housecode-new | house-templates | house-log
            if editCard == nil, editCode == nil, guide?.canEdit == true, let d = UserDefaults.standard.string(forKey: "debugMore"), d.hasPrefix("house") {
                // the debug sheet is still animating in – present the editor a moment later
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                if d == "housecard-new" { editCard = EditTarget(item: nil) }
                if d == "housecard-edit" { editCard = EditTarget(item: guide?.cards.first) }
                if d == "housecode-new" { editCode = EditTarget(item: nil) }
                if d == "house-templates" { showTemplates = true }
                if d == "house-log" { showLog = true }
            }
            #endif
        } catch APIError.notFound {
            state = L("Your server doesn't have this section yet.")
        } catch {
            state = APIError.from(error).localizedDescription
        }
    }

    private func reveal(_ c: HouseGuide.Code) async {
        guard let api = app.api else { return }
        do {
            revealed[c.id] = try await api.send("POST", "api/house-guide/codes/\(c.id)/reveal", as: RevealedCode.self)
        } catch {
            state = APIError.from(error).localizedDescription
        }
    }

    static func qrImage(_ text: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
