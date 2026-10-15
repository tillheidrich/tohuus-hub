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

/// One card at its real pixel size (1 pt = 1 px when rendered at scale 1). Fixed sizes – it's a picture, not UI.
struct ShareCardCanvas: View {
    let spec: ShareCardSpec
    let format: ShareCardFormat

    var body: some View {
        let c = ShareCardTheme.colors(spec.area)
        let size = format.size
        let story = format == .story
        let foot = spec.source.map { L("Source") + ": " + $0 } ?? L("Made with ToHuus") + " · " + ShareFooter.host
        ZStack(alignment: .topLeading) {
            c.bg
            DoorArch(story: story).fill(c.fg.opacity(0.08))
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 20) {
                    CardBrandMark(fg: c.fg, bg: c.bg)
                    Text(verbatim: "ToHuus").font(.system(size: 46, weight: .semibold))
                }
                .padding(.top, story ? 0 : 16)
                Color.clear.frame(height: story ? 120 : 84)
                Text(spec.eyebrow.uppercased())
                    .font(.system(size: 30, weight: .semibold))
                    .tracking(2.4)
                    .opacity(0.8)
                    .lineLimit(2)
                Text(spec.value)
                    .font(.system(size: story ? 300 : 240, weight: .regular, design: .serif))
                    .lineLimit(1)
                    .minimumScaleFactor(0.3)
                    .padding(.leading, -(story ? 9 : 7))
                Text(spec.title)
                    .font(.system(size: 60, weight: .semibold))
                    .lineLimit(3)
                    .lineSpacing(10)
                    .padding(.top, story ? 12 : 4)
                if let t = spec.text, !t.isEmpty {
                    Text(t)
                        .font(.system(size: 40))
                        .lineSpacing(12)
                        .opacity(0.85)
                        .lineLimit(4)
                        .padding(.top, 28)
                }
                if !spec.list.isEmpty {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(Array(spec.list.prefix(3).enumerated()), id: \.offset) { _, item in
                            Text("·  " + item).font(.system(size: 38)).lineLimit(1)
                        }
                    }
                    .padding(.top, 30)
                }
                Spacer(minLength: 24)
                Text(foot)
                    .font(.system(size: 28))
                    .opacity(0.7)
                    .lineLimit(2)
            }
            .foregroundStyle(c.fg)
            .padding(.horizontal, 88)
            .padding(.top, format.safe.top)
            .padding(.bottom, format.safe.bottom)
            .frame(width: size.width, height: size.height, alignment: .topLeading)
        }
        .frame(width: size.width, height: size.height)
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
struct ShareCardSheet: View {
    let spec: ShareCardSpec
    @Environment(\.dismiss) private var dismiss
    @State private var format: ShareCardFormat = .story
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
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

/// A small "Teilen" button for a card (opens ShareCardSheet through the caller's `.sheet(item:)`).
struct ShareCardButton: View {
    var title: String = L("Share")
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "square.and.arrow.up")
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.primaryText)
        .accessibilityHint(L("Share as image"))
    }
}
