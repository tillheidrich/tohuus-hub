import SwiftUI

/// Small drawings for empty states in the "Dutch Detail" language – a 1:1 port of web/src/art.tsx (EmptyArt):
/// flat palette shapes, an occasional ink contour, always on the soft green disc. Colours follow light/dark.
/// Purely decorative (hidden from VoiceOver); settles in once, never loops, and not at all with Reduce Motion.
struct EmptyArt: View {
    enum Name: String, CaseIterable, Sendable {
        case list, shelf, book, receipt, box, done, calendar, suitcase, bag
        /// the web's "fridge" falls back to the neutral storage box (no fridge as the default home)
        static func named(_ s: String) -> Name { s == "fridge" ? .box : Name(rawValue: s) ?? .box }
    }

    let name: Name
    var height: CGFloat = 96
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        ArtCanvas(viewBox: CGSize(width: 120, height: 88), shapes: Self.scenes[name] ?? [])
            .frame(height: height)
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 4)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeOut(duration: 0.46)) { shown = true }
            }
    }

    /// SF Symbol of an older empty state → the matching drawing (keeps every existing EmptyStateView call illustrated)
    static func forSymbol(_ symbol: String) -> Name? {
        let s = symbol.lowercased()
        if s.hasPrefix("doc.text") || s.hasPrefix("receipt") || s.contains("eurosign") { return .receipt }
        if s.hasPrefix("checkmark") { return .done }
        if s.hasPrefix("cart") || s.hasPrefix("bag") || s.hasPrefix("basket") { return .bag }
        if s.hasPrefix("list") || s.hasPrefix("checklist") || s.hasPrefix("note") { return .list }
        if s.hasPrefix("cabinet") || s.hasPrefix("shippingbox") || s.hasPrefix("archivebox") || s.hasPrefix("refrigerator") { return .box }
        if s.hasPrefix("book") || s.hasPrefix("fork.knife") || s.hasPrefix("text.book") { return .book }
        if s.hasPrefix("calendar") { return .calendar }
        if s.hasPrefix("suitcase") || s.hasPrefix("airplane") { return .suitcase }
        if s.hasPrefix("tray") || s.hasPrefix("house") || s.hasPrefix("square.stack") { return .shelf }
        return nil
    }

    typealias S = ArtShape
    static let scenes: [Name: [ArtShape]] = [
        .list: [
            S.circle(60, 48, 40, "f-ps"),
            S.rect(30, 16, 38, 56, "f-w s-k2", rx: 3),
            S.rect(40, 11, 18, 9, "f-k", rx: 2),
            S.rect(36, 28, 7, 7, "f-p"),
            S.rect(36, 42, 7, 7, "s-k15 f-w"),
            S.rect(36, 56, 7, 7, "s-k15 f-w"),
            S.path("M48 31h14M48 45h11M48 59h13", "s-k15"),
            S.path("M70 50h32l-4 26H74z", "f-pd"),
            S.path("M77 50c0-9 5-13 9-13s9 4 9 13", "s-k2"),
        ],
        .shelf: [
            S.circle(60, 46, 40, "f-ps"),
            S.rect(14, 66, 92, 6, "f-k"),
            S.rect(22, 72, 5, 12, "f-k"),
            S.rect(93, 72, 5, 12, "f-k"),
            S.path("M34 66h22l-3-18H37z", "f-c"),
            S.path("M45 48c-11-4-15-15-11-26 10 4 14 14 11 26z", "f-p"),
            S.path("M45 48c8-8 19-8 26-1-8 7-18 7-26 1z", "f-pd"),
            S.rect(66, 44, 14, 22, "f-s s-k15", rx: 3),
            S.rect(66, 40, 14, 5, "f-k"),
            S.rect(84, 52, 11, 14, "f-m", rx: 2),
        ],
        .book: [
            S.circle(60, 46, 40, "f-ps"),
            S.path("M60 24c-10-6-26-7-38-3v52c12-4 28-3 38 3Z", "f-w s-k2"),
            S.path("M60 24c10-6 26-7 38-3v52c-12-4-28-3-38 3Z", "f-s s-k2"),
            S.path("M30 34c8-2 15-1 22 2M30 44c8-2 15-1 22 2M30 54c6-2 11-1 16 1", "s-k15"),
            S.path("M80 20v20l5-4 5 4V19", "f-c"),
        ],
        .receipt: [
            S.circle(60, 46, 40, "f-ps"),
            S.path("M34 10h40v62l-5-4-5 4-5-4-5 4-5-4-5 4-5-4-5 4Z", "f-w s-k2"),
            S.path("M42 24h24M42 33h16M42 42h20", "s-k15"),
            S.path("M42 54h24", "s-k2"),
            S.circle(88, 66, 14, "f-p"),
            S.path("m82 66 4 4 8-8", "s-w3"),
        ],
        .box: [
            S.circle(60, 46, 40, "f-ps"),
            S.rect(26, 40, 68, 36, "f-s s-k2", rx: 4),
            S.rect(22, 32, 76, 10, "f-pd", rx: 3),
            S.rect(44, 52, 32, 12, "f-w s-k15", rx: 2),
            S.path("M50 58h20", "s-k15"),
        ],
        .done: [
            S.circle(60, 46, 40, "f-ps"),
            S.path("M38 44 60 24l22 20v32H38z", "f-p"),
            S.path("M53 76V62a7 7 0 0 1 14 0v14z", "f-m"),
            S.circle(88, 30, 13, "f-w s-k2"),
            S.path("m82 30 4 4 8-8", "s-p3"),
        ],
        .calendar: [
            S.circle(60, 46, 40, "f-ps"),
            S.path("M28 76V34a20 20 0 0 1 20-20h24a20 20 0 0 1 20 20v42z", "f-w s-k2"),
            S.path("M36 44h8M52 44h8M68 44h8M36 56h8M68 56h8M36 68h8M52 68h8", "s-k15"),
            S.circle(56, 56, 6, "f-p"),
            S.path("M44 14v8M76 14v8", "s-k3"),
        ],
        .suitcase: [
            S.circle(60, 46, 40, "f-ps"),
            S.rect(30, 30, 56, 42, "f-pd", rx: 5),
            S.path("M48 30v-8a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8", "s-k2"),
            S.path("M44 30v42M72 30v42", "s-w2"),
            S.circle(40, 78, 3, "f-k"),
            S.circle(76, 78, 3, "f-k"),
            S.circle(98, 22, 8, "f-m"),
        ],
        .bag: [
            S.circle(60, 46, 40, "f-ps"),
            S.path("M44 28c-12-2-10-14 0-14 4 0 6 4 6 8M76 28c12-2 10-14 0-14-4 0-6 4-6 8", "f-p"),
            S.path("M30 34h60l-5 44H35z", "f-s s-k2"),
            S.path("M46 34c0-12 4-16 14-16s14 4 14 16", "s-k2"),
            S.rect(50, 46, 20, 14, "f-m", rx: 2),
        ],
    ]
}

/// The ToHuus mark: a green house with an arched mustard door (web: BrandMark in art.tsx).
struct BrandMark: View {
    var size: CGFloat = 28
    /// on a dark green block the house turns light (web: .mark.on-block)
    var onBlock = false

    var body: some View {
        ArtCanvas(viewBox: CGSize(width: 32, height: 32), shapes: [
            ArtShape(geometry: .path("M4 28V14L16 4l12 10v14z"), fill: onBlock ? .hex(0xF7F5EF) : .primary),
            ArtShape(geometry: .path("M12.5 28v-6.5a3.5 3.5 0 0 1 7 0V28z"), fill: .mustard),
        ])
        .frame(width: size, height: size)
    }
}

/// The friendly animals people (and children) can pick as their picture – port of web/src/pages/KidArt.tsx.
enum AnimalArt {
    static let keys = ["fox", "bear", "rabbit", "cat", "owl", "frog", "mouse", "hedgehog"]
    private static func f(_ g: ArtShape.Geometry, _ hex: UInt32, opacity: Double = 1) -> ArtShape { ArtShape(geometry: g, fill: .hex(hex), opacity: opacity) }
    private static func line(_ d: String, _ hex: UInt32, _ w: CGFloat, opacity: Double = 1) -> ArtShape {
        ArtShape(geometry: .path(d), stroke: .hex(hex), lineWidth: w, opacity: opacity)
    }
    private static func eyes(_ y: CGFloat = 50, _ dx: CGFloat = 13, _ r: CGFloat = 4.2) -> [ArtShape] {
        [f(.circle(50 - dx, y, r), 0x2B2622), f(.circle(50 + dx, y, r), 0x2B2622),
         f(.circle(50 - dx + 1.4, y - 1.4, 1.3), 0xFFFFFF), f(.circle(50 + dx + 1.4, y - 1.4, 1.3), 0xFFFFFF)]
    }
    private static func cheeks(_ y: CGFloat = 60, _ dx: CGFloat = 22) -> [ArtShape] {
        [f(.ellipse(50 - dx, y, 5, 3.2), 0xF4A3A0, opacity: 0.75), f(.ellipse(50 + dx, y, 5, 3.2), 0xF4A3A0, opacity: 0.75)]
    }
    private static func smile(_ y: CGFloat = 64, _ w: CGFloat = 6) -> ArtShape {
        line("M\(50 - w) \(y) q\(w) \(w * 0.9) \(w * 2) 0", 0x2B2622, 2.6)
    }

    static func shapes(_ name: String) -> [ArtShape] {
        switch name {
        case "bear":
            return [f(.circle(24, 28, 12), 0x8A5A3B), f(.circle(76, 28, 12), 0x8A5A3B), f(.circle(24, 28, 6), 0xD9A77F), f(.circle(76, 28, 6), 0xD9A77F),
                    f(.circle(50, 55, 34), 0xA06A45), f(.ellipse(50, 66, 15, 11), 0xE6C09C)] + eyes(50, 13)
                + [f(.ellipse(50, 61, 5, 3.6), 0x2B2622), smile(68, 4)]
        case "rabbit":
            return [f(.ellipse(36, 22, 8, 20), 0xE9E4DE), f(.ellipse(64, 22, 8, 20), 0xE9E4DE), f(.ellipse(36, 24, 4, 14), 0xF6C1C4), f(.ellipse(64, 24, 4, 14), 0xF6C1C4),
                    f(.circle(50, 60, 30), 0xF3EFEA)] + eyes(56, 12) + cheeks(66, 19)
                + [f(.path("M46 64 L54 64 L50 69 Z"), 0xE88B93), line("M50 69 v4", 0x2B2622, 2)]
        case "cat":
            return [f(.path("M20 20 L40 34 L22 48 Z"), 0x8F949C), f(.path("M80 20 L60 34 L78 48 Z"), 0x8F949C),
                    f(.path("M24 27 L34 35 L25 42 Z"), 0xF2B8BC), f(.path("M76 27 L66 35 L75 42 Z"), 0xF2B8BC),
                    f(.circle(50, 56, 32), 0xA3A8B0), line("M44 26 q6 8 12 0", 0x7D828A, 3)] + eyes(52, 13) + cheeks(64, 20)
                + [f(.path("M46 62 L54 62 L50 66 Z"), 0xE88B93), line("M22 64 H34 M22 70 H34 M66 64 H78 M66 70 H78", 0x5D6168, 1.8), smile(70, 4)]
        case "owl":
            return [f(.path("M22 20 L34 34 L22 38 Z"), 0x7B5A3E), f(.path("M78 20 L66 34 L78 38 Z"), 0x7B5A3E),
                    f(.ellipse(50, 58, 32, 34), 0x9A7250), f(.ellipse(50, 70, 20, 18), 0xE8D2B5),
                    f(.circle(37, 46, 12), 0xFFFFFF), f(.circle(63, 46, 12), 0xFFFFFF), f(.circle(37, 46, 5.5), 0x2B2622), f(.circle(63, 46, 5.5), 0x2B2622),
                    f(.path("M45 56 L55 56 L50 64 Z"), 0xF2A33A), line("M40 74 q4 3 8 0 M52 74 q4 3 8 0 M46 82 q4 3 8 0", 0xC4A582, 2)]
        case "frog":
            return [f(.circle(32, 32, 13), 0x5CB85C), f(.circle(68, 32, 13), 0x5CB85C), f(.ellipse(50, 60, 36, 28), 0x6CC46C),
                    f(.circle(32, 31, 7.5), 0xFFFFFF), f(.circle(68, 31, 7.5), 0xFFFFFF), f(.circle(33, 32, 4), 0x2B2622), f(.circle(67, 32, 4), 0x2B2622)]
                + cheeks(66, 24) + [line("M34 66 q16 12 32 0", 0x2B5E2B, 3)]
        case "mouse":
            return [f(.circle(24, 34, 17), 0xB9B4AD), f(.circle(76, 34, 17), 0xB9B4AD), f(.circle(24, 34, 10), 0xF2C3C6), f(.circle(76, 34, 10), 0xF2C3C6),
                    f(.ellipse(50, 60, 28, 27), 0xCDC8C1)] + eyes(55, 11, 3.8)
                + [f(.circle(50, 68, 4.2), 0xE88B93), line("M30 66 H42 M30 72 H42 M58 66 H70 M58 72 H70", 0x7A756F, 1.6)]
        case "hedgehog":
            return [f(.path("M12 62 L18 40 L24 52 L28 26 L36 44 L42 20 L50 40 L58 20 L64 44 L72 26 L76 52 L82 40 L88 62 C88 80 70 88 50 88 C30 88 12 80 12 62 Z"), 0x7A5A43),
                    f(.ellipse(50, 66, 26, 20), 0xEFD7B8)] + eyes(62, 10, 3.8) + [f(.circle(50, 71, 4), 0x2B2622)] + cheeks(72, 17)
        default: // fox
            return [f(.path("M18 22 L36 40 L24 50 Z"), 0xE8742C), f(.path("M82 22 L64 40 L76 50 Z"), 0xE8742C),
                    f(.path("M22 28 L32 40 L26 45 Z"), 0xFBE3CF), f(.path("M78 28 L68 40 L74 45 Z"), 0xFBE3CF),
                    f(.path("M50 86 C26 82 14 62 18 42 C30 34 70 34 82 42 C86 62 74 82 50 86 Z"), 0xF08A3C),
                    f(.path("M50 86 C38 84 28 74 26 62 C36 62 44 66 50 72 C56 66 64 62 74 62 C72 74 62 84 50 86 Z"), 0xFFF6EC)]
                + eyes(52, 14) + [f(.ellipse(50, 70, 4.6, 3.4), 0x2B2622)]
        }
    }
}
