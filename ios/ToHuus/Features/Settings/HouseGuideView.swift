import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// GET /api/house-guide → { cards, codes (masked), areas, can_edit }
struct HouseGuide: Decodable, Sendable {
    @Lossy var cards: [Card]
    @Lossy var codes: [Code]
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
        var draft: JSONValue?
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

/// Mehr › Hausinfo: cards by area, codes masked with tap-to-show. Revealed values live only in memory for a minute –
/// never written to disk, never cached, never in notifications.
struct HouseGuideView: View {
    @Environment(AppModel.self) private var app
    @State private var guide: HouseGuide?
    @State private var state: String?
    @State private var revealed: [Int: RevealedCode] = [:]

    var body: some View {
        List {
            if let state { Text(state).foregroundStyle(Theme.ink3) }
            if let g = guide {
                let areas = orderedAreas(g)
                ForEach(areas, id: \.self) { area in
                    Section(area.isEmpty ? L("Everywhere") : area) {
                        ForEach(g.cards.filter { ($0.area ?? "") == area && $0.draft?.bool != true }) { c in cardRow(c) }
                        ForEach(g.codes.filter { ($0.area ?? "") == area }) { c in codeRow(c) }
                    }
                }
                if g.cards.isEmpty && g.codes.isEmpty {
                    Text(L("Nothing here yet. Admins fill the house info in the web app.")).foregroundStyle(Theme.ink3)
                }
            } else if state == nil {
                ProgressView()
            }
            Section {
                HelpLink(slug: "hausinfo", title: L("House info for guests and sitters"))
                HelpLink(slug: "hausinfo-codes", title: L("Sharing codes safely"))
            }
        }
        .navigationTitle(L("House info"))
        .task { await load() }
        .refreshable { await load() }
        .onDisappear { revealed = [:] }
    }

    private func orderedAreas(_ g: HouseGuide) -> [String] {
        var seen: [String] = []
        for a in (g.cards.map { $0.area ?? "" } + g.codes.map { $0.area ?? "" }) where !seen.contains(a) { seen.append(a) }
        return seen
    }

    private func cardRow(_ c: HouseGuide.Card) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(c.title, systemImage: icon(c)).font(.headline)
            if let b = c.body, !b.isEmpty {
                Text(c.type == "voice" || c.type == "routine" ? "„\(b)“" : b).font(.subheadline)
            }
            if let d = c.detail, !d.isEmpty { Text(d).font(.caption).foregroundStyle(Theme.ink2) }
        }
        .padding(.vertical, 2)
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
                Label(c.label, systemImage: c.kind == "wifi" ? "wifi" : "key")
                Spacer()
                if let r = revealed[c.id], let v = r.value {
                    Text(v).font(.body.monospaced()).textSelection(.enabled)
                } else if c.hasValue == true {
                    Text(c.masked ?? "••••").foregroundStyle(Theme.ink3)
                    Button(L("Show")) { Task { await reveal(c) } }
                        .buttonStyle(.bordered).controlSize(.small)
                }
            }
            if let note = c.note, !note.isEmpty { Text(note).font(.caption).foregroundStyle(Theme.ink2) }
            if let r = revealed[c.id] {
                if let qr = r.wifi?.qr, let img = Self.qrImage(qr) {
                    Image(uiImage: img).interpolation(.none).resizable().frame(width: 160, height: 160)
                        .accessibilityLabel(LF("Wi-Fi QR code for %@", r.wifi?.ssid ?? c.label))
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
