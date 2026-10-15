import SwiftUI
import UIKit

// Teilen (docs/sharing.md, web: share/share.tsx + share/cards.tsx).
// 1. Text to Notes, Mail and Messages: a title line, one line per item, and – if the household keeps it on – the footer
//    "— geteilt aus ToHuus · <site>/?utm_source=share&utm_medium=<list|mind|tasks|plan|card>&utm_campaign=app"
//    (lowercase, never a user or household id). Nothing leaves without the person tapping Share themselves.
// 2. Share cards: branded images in 4:5 (1080 × 1350) and 9:16 (1080 × 1920), the same layout as the web canvas and
//    the website script. Only what the person chose to share: no names, no household name, nothing private, nothing
//    about someone a member looks after.

/// The household's footer choice and the website, from GET /api/me (`site_url`, `share_footer`) – kept on the device
/// so every screen can build a shared text without asking the server again.
enum ShareFooter {
    static let defaultSite = "https://tohuus.heidrich-digital.de"
    private static let siteKey = "share.site"
    private static let onKey = "share.footer"

    static func adopt(site: String?, on: Bool?) {
        let d = UserDefaults.standard
        if let site, !site.isEmpty { d.set(site, forKey: siteKey) }
        if let on { d.set(on, forKey: onKey) }
    }

    /// e.g. https://tohuus.heidrich-digital.de (no trailing slash)
    static var site: String {
        var s = UserDefaults.standard.string(forKey: siteKey) ?? defaultSite
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }

    /// e.g. tohuus.heidrich-digital.de
    static var host: String { site.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "") }

    /// on unless the household switched it off
    static var on: Bool { UserDefaults.standard.object(forKey: onKey) as? Bool ?? true }

    /// the last line of a shared text, nil when the household switched it off
    static func line(medium: String) -> String? {
        guard on else { return nil }
        return "— " + L("shared from ToHuus") + " · " + site + "/?utm_source=share&utm_medium=" + medium.lowercased() + "&utm_campaign=app"
    }
}

extension ShareText {
    /// Title, an empty line, one line per item and the footer (docs/sharing.md). `medium`: list | mind | tasks | plan | card
    static func make(title: String, lines: [String], medium: String) -> String {
        let body = ([title, ""] + lines).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let footer = ShareFooter.line(medium: medium) else { return body }
        return body + "\n\n" + footer
    }
}

// MARK: - share cards

/// What goes on one picture. Built by the screen that offers "Als Bild teilen" – with the privacy rules applied there.
struct ShareCardSpec: Identifiable, Hashable {
    /// tasks | shop | cook | pantry | money | fact
    var area: String
    var eyebrow: String
    /// one number or one word
    var value: String
    var title: String
    var text: String?
    var list: [String] = []
    /// facts only: "Quelle: …" instead of the website line
    var source: String?
    /// facts only: the website's ready pictures (GET /api/facts → images { feed, story }); drawn here when they can't be loaded
    var remoteFeed: URL?
    var remoteStory: URL?
    var id: String { [area, eyebrow, value, title].joined(separator: "|") }
}

enum ShareCardFormat: String, CaseIterable, Identifiable {
    case story, feed
    var id: String { rawValue }
    var size: CGSize { self == .story ? CGSize(width: 1080, height: 1920) : CGSize(width: 1080, height: 1350) }
    /// text-free bands at the top and bottom (the platforms' own UI sits there)
    var safe: (top: CGFloat, bottom: CGFloat) { self == .story ? (260, 360) : (72, 72) }
    var title: String { self == .story ? L("Story 9:16") : L("Feed 4:5") }
}

enum ShareCardTheme {
    /// background, text – fixed brand colours, the same in light and dark mode (it is a picture)
    static func colors(_ area: String) -> (bg: Color, fg: Color, accent: Color) {
        let paper = Color(UIColor(hex: 0xFFFDF9)), ink = Color(UIColor(hex: 0x181D1A))
        switch area {
        case "cook": return (Color(UIColor(hex: 0xC56B4B)), paper, Color(UIColor(hex: 0xF6D9CC)))
        case "money": return (Color(UIColor(hex: 0x2F5E7A)), paper, Color(UIColor(hex: 0xD5E4EC)))
        case "pantry": return (Color(UIColor(hex: 0xE8B865)), ink, Color(UIColor(hex: 0x5B4515)))
        case "fact": return (Color(UIColor(hex: 0xF7F5EF)), ink, Color(UIColor(hex: 0x176B50)))
        default: return (Color(UIColor(hex: 0x176B50)), paper, Color(UIColor(hex: 0xCFDCD1)))
        }
    }

    /// review areas → card areas (anything unknown is a task card, the green default)
    static func area(_ reviewArea: String) -> String {
        ["tasks", "shop", "cook", "pantry", "money", "fact"].contains(reviewArea) ? reviewArea : "tasks"
    }
}

/// The door of the brand mark as one big, quiet arch at the bottom right, partly cut off.
private struct DoorArch: Shape {
    let story: Bool
    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        let aw = w * 0.62
        let ax = w - aw * 0.7
        let ay = h - (story ? 820 : 600)
        var p = Path()
        p.move(to: CGPoint(x: ax, y: h))
        p.addLine(to: CGPoint(x: ax, y: ay + aw / 2))
        p.addArc(center: CGPoint(x: ax + aw / 2, y: ay + aw / 2), radius: aw / 2, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: ax + aw, y: h))
        p.closeSubpath()
        return p
    }
}

/// The brand mark on a card: the house in the text colour, the door cut out in the background colour (32 × 32 grid).
private struct CardBrandMark: View {
    let fg: Color
    let bg: Color
    var size: CGFloat = 64
    var body: some View {
        let s = size / 32
        ZStack {
            SVGPath.path("M4 28V14L16 4l12 10v14z").applying(CGAffineTransform(scaleX: s, y: s)).fill(fg)
            SVGPath.path("M12.5 28v-6.5a3.5 3.5 0 0 1 7 0V28z").applying(CGAffineTransform(scaleX: s, y: s)).fill(bg)
        }
        .frame(width: size, height: size, alignment: .topLeading)
    }
}

/// One line on a card, measured and placed by `ShareCardLayout` (the same rows as `layoutCard` in web/src/share/cards.tsx).
struct ShareCardRow {
    var text: String
    var font: UIFont
    /// space above the row
    var before: CGFloat
    var lineHeight: CGFloat
    /// quiet rows (eyebrow, text) use the area's accent colour – never opacity on text
    var quiet = false
    var tracking: CGFloat = 0
    var dx: CGFloat = 0
}

/// The text fills the card (15 Oct 2026, Till: "Text soll das Bild besser ausfüllen"): one scale for value, title, text
/// and list – the largest that fits between the brand line and the footer. Typography is the lever, not decoration.
/// System fonts (the brand fonts aren't in the app), same rule and sizes as the web canvas.
enum ShareCardLayout {
    static func sans(_ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont { .systemFont(ofSize: size, weight: weight) }

    static func serif(_ size: CGFloat) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: .regular)
        guard let d = base.fontDescriptor.withDesign(.serif) else { return base }
        return UIFont(descriptor: d, size: size)
    }

    static func width(_ text: String, _ font: UIFont, tracking: CGFloat = 0) -> CGFloat {
        var attrs: [NSAttributedString.Key: Any] = [.font: font]
        if tracking != 0 { attrs[.kern] = tracking }
        return ceil((text as NSString).size(withAttributes: attrs).width)
    }

    /// greedy word wrap, like `lines()` on the web
    static func lines(_ text: String, _ font: UIFont, max: CGFloat, tracking: CGFloat = 0) -> [String] {
        var out: [String] = []
        var cur = ""
        for word in text.split(whereSeparator: { $0.isWhitespace }).map(String.init) {
            let next = cur.isEmpty ? word : cur + " " + word
            if width(next, font, tracking: tracking) > max && !cur.isEmpty {
                out.append(cur)
                cur = word
            } else {
                cur = next
            }
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    /// The value as large as fits on one line (a word like "Dienstag" needs to shrink).
    static func fitSize(_ text: String, start: CGFloat, max: CGFloat) -> CGFloat {
        var size = start
        while size > 80 {
            if width(text, serif(size)) <= max { break }
            size -= 8
        }
        return size
    }

    static func build(_ spec: ShareCardSpec, story: Bool, max: CGFloat, k: CGFloat) -> (rows: [ShareCardRow], height: CGFloat) {
        var rows: [ShareCardRow] = []
        // the eyebrow stays small on purpose – it is a label
        let eb = sans(30, .semibold)
        for l in lines(spec.eyebrow.uppercased(), eb, max: max, tracking: 2.4).prefix(2) {
            rows.append(ShareCardRow(text: l, font: eb, before: 0, lineHeight: 42, quiet: true, tracking: 2.4))
        }
        if !spec.value.isEmpty {
            // a short number is the picture itself (one loud element per card); a word stays a little smaller
            let short = spec.value.count <= 4
            let base: CGFloat = short ? (story ? 360 : 300) : (story ? 280 : 230)
            let vs = min(fitSize(spec.value, start: (base * k).rounded(), max: max), story ? 720 : 560)
            rows.append(ShareCardRow(text: spec.value, font: serif(vs), before: (18 * k).rounded(), lineHeight: vs * 0.98, dx: -vs * 0.03))
        }
        let ts = min((60 * k).rounded(), 124)
        let tf = sans(ts, .semibold)
        for (i, l) in lines(spec.title, tf, max: max).prefix(4).enumerated() {
            rows.append(ShareCardRow(text: l, font: tf, before: i == 0 ? (26 * k).rounded() : 0, lineHeight: ts * 1.12))
        }
        if let text = spec.text, !text.isEmpty {
            let xs = min((40 * k).rounded(), 66)
            let xf = sans(xs)
            // never cut a sourced fact short: up to ten lines, the scale makes room
            for (i, l) in lines(text, xf, max: max).prefix(10).enumerated() {
                rows.append(ShareCardRow(text: l, font: xf, before: i == 0 ? (30 * k).rounded() : 0, lineHeight: xs * 1.3, quiet: true))
            }
        }
        if !spec.list.isEmpty {
            let ls = min((40 * k).rounded(), 68)
            let lf = sans(ls)
            // a list the person picked themselves (erledigte Aufgaben) may be longer when there is no text
            let n = (spec.text ?? "").isEmpty ? 6 : 3
            for (i, item) in spec.list.prefix(n).enumerated() {
                let first = lines(item, lf, max: max - ls).first ?? item
                rows.append(ShareCardRow(text: "·  " + first, font: lf, before: i == 0 ? (30 * k).rounded() : 0, lineHeight: ls * 1.32))
            }
        }
        return (rows, rows.reduce(0) { $0 + $1.before + $1.lineHeight })
    }

    /// All rows at the largest scale (0.7–2.4) whose height fits `room` (lines re-wrap at every size, so it's searched).
    static func plan(_ spec: ShareCardSpec, story: Bool, max: CGFloat, room: CGFloat) -> (rows: [ShareCardRow], height: CGFloat) {
        var lo: CGFloat = 0.7, hi: CGFloat = 2.4
        for _ in 0..<14 {
            let mid = (lo + hi) / 2
            if build(spec, story: story, max: max, k: mid).height <= room { lo = mid } else { hi = mid }
        }
        return build(spec, story: story, max: max, k: lo)
    }
}

/// One card at its real pixel size (1 pt = 1 px when rendered at scale 1). Fixed sizes – it's a picture, not UI.
struct ShareCardCanvas: View {
    let spec: ShareCardSpec
    let format: ShareCardFormat

    private static let pad: CGFloat = 88

    var body: some View {
        let c = ShareCardTheme.colors(spec.area)
        let size = format.size
        let story = format == .story
        let max = size.width - Self.pad * 2
        let foot = spec.source.map { L("Source") + ": " + $0 } ?? L("Made with ToHuus") + " · " + ShareFooter.host
        let footLines = min(2, Swift.max(1, ShareCardLayout.lines(foot, ShareCardLayout.sans(28), max: max).count))
        // content box: below the brand line, above the footer (same numbers as the web canvas)
        let headerBottom = format.safe.top + (story ? 0 : 16) + 64 + (story ? 120 : 84)
        let boxTop = headerBottom + (story ? 40 : 8)
        let footTop = size.height - format.safe.bottom - CGFloat(footLines - 1) * 38 - 28
        let boxBottom = footTop - (story ? 96 : 64)
        let room = boxBottom - boxTop
        let plan = ShareCardLayout.plan(spec, story: story, max: max, room: room)
        let top = boxTop + Swift.max(0, (room - plan.height) / 2)
        ZStack(alignment: .topLeading) {
            c.bg
            // decoration, not text: the arch may stay quiet
            DoorArch(story: story).fill(c.fg.opacity(0.08))
            HStack(spacing: 20) {
                CardBrandMark(fg: c.fg, bg: c.bg)
                Text(verbatim: "ToHuus").font(.system(size: 46, weight: .semibold)).foregroundStyle(c.fg)
            }
            .padding(.leading, Self.pad)
            .padding(.top, format.safe.top + (story ? 0 : 16))
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(plan.rows.enumerated()), id: \.offset) { _, row in
                    Text(verbatim: row.text)
                        .font(Font(row.font as CTFont))
                        .tracking(row.tracking)
                        .foregroundStyle(row.quiet ? c.accent : c.fg)
                        .lineLimit(1)
                        .fixedSize()
                        .frame(height: row.lineHeight, alignment: .leading)
                        .offset(x: row.dx)
                        .padding(.top, row.before)
                }
            }
            .padding(.leading, Self.pad)
            .padding(.top, top)
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)
                Text(foot)
                    .font(.system(size: 28))
                    .foregroundStyle(c.accent)
                    .lineLimit(2)
            }
            .padding(.horizontal, Self.pad)
            .padding(.bottom, format.safe.bottom)
            .frame(width: size.width, height: size.height, alignment: .bottomLeading)
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .clipped()
        .environment(\.colorScheme, .light)
        .environment(\.dynamicTypeSize, .large)
    }
}

enum ShareCardRenderer {
    /// 1080 × 1350 or 1080 × 1920 pixels
    @MainActor static func image(_ spec: ShareCardSpec, _ format: ShareCardFormat) -> UIImage? {
        let r = ImageRenderer(content: ShareCardCanvas(spec: spec, format: format))
        r.scale = 1
        r.proposedSize = ProposedViewSize(format.size)
        r.isOpaque = true
        return r.uiImage
    }
}

/// "Als Bild teilen": choose the format, see the picture, then the share sheet (Instagram, WhatsApp, Photos …).
/// `header` sits above the format choice (e.g. the task chips of the week review); the picture follows `spec` live.
struct ShareCardSheet<Header: View>: View {
    let spec: ShareCardSpec
    let heading: String?
    let header: () -> Header
    @Environment(\.dismiss) private var dismiss
    @State private var format: ShareCardFormat = .story
    @State private var image: UIImage?
    @State private var failed = false

    init(spec: ShareCardSpec, heading: String? = nil, @ViewBuilder header: @escaping () -> Header) {
        self.spec = spec
        self.heading = heading
        self.header = header
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    if let heading {
                        Text(heading).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                    }
                    header()
                    Picker(L("Format"), selection: $format) {
                        ForEach(ShareCardFormat.allCases) { f in Text(f.title).tag(f) }
                    }
                    .pickerStyle(.segmented)
                    Group {
                        if let image {
                            Image(uiImage: image)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                                .accessibilityLabel(LF("Picture: %@", [spec.value, spec.title].joined(separator: " ")))
                        } else if failed {
                            ErrorBanner(message: L("The picture couldn’t be made.")) { render() }
                        } else {
                            ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: 520)
                    Text(L("Only what you see here is on the picture – no names, nothing private."))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                    if let image {
                        let picture = Image(uiImage: image)
                        ShareLink(item: picture, subject: Text(spec.title), preview: SharePreview(spec.title, image: picture)) {
                            Label(L("Share"), systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                    }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(L("Share as image"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .onChange(of: format) { render() }
            .onChange(of: spec) { render() }
            .onAppear { render() }
        }
    }

    private func render() {
        let f = format
        if let url = f == .story ? spec.remoteStory : spec.remoteFeed {
            image = nil
            failed = false
            Task { @MainActor in
                // the website's own picture first (same layout, checked by hand); offline the app draws it
                var got: UIImage?
                if let (data, resp) = try? await URLSession.shared.data(from: url),
                   (resp as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false {
                    got = UIImage(data: data)
                }
                guard format == f else { return }
                image = got ?? ShareCardRenderer.image(spec, f)
                failed = image == nil
            }
            return
        }
        image = ShareCardRenderer.image(spec, f)
        failed = image == nil
    }
}

extension ShareCardSheet where Header == EmptyView {
    init(spec: ShareCardSpec) {
        self.init(spec: spec, heading: nil) { EmptyView() }
    }
}

/// A small "Teilen" button for a card (opens ShareCardSheet through the caller's `.sheet(item:)`).
struct ShareCardButton: View {
    var title: String = L("Share")
    var systemImage: String = "square.and.arrow.up"
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.primaryText)
        .accessibilityHint(L("Share as image"))
    }
}
