import SwiftUI

/// The food drawings of kid mode – port of web/src/pages/KidArt.tsx (FOOD). Shown when an item has no photo.
/// The animals live in Design/EmptyArt.swift (AnimalArt).
enum KidFoodArt {
    private static func f(_ g: ArtShape.Geometry, _ hex: UInt32, opacity: Double = 1) -> ArtShape { ArtShape(geometry: g, fill: .hex(hex), opacity: opacity) }
    private static func s(_ d: String, _ hex: UInt32, _ w: CGFloat, opacity: Double = 1) -> ArtShape {
        ArtShape(geometry: .path(d), stroke: .hex(hex), lineWidth: w, opacity: opacity)
    }
    private static func fs(_ g: ArtShape.Geometry, _ fill: UInt32, _ stroke: UInt32, _ w: CGFloat) -> ArtShape {
        ArtShape(geometry: g, fill: .hex(fill), stroke: .hex(stroke), lineWidth: w)
    }

    static func shapes(_ art: String?) -> [ArtShape] {
        switch art {
        case "apple":
            return [f(.path("M50 30 C40 22 20 24 18 46 C16 70 34 90 50 84 C66 90 84 70 82 46 C80 24 60 22 50 30 Z"), 0xE2483D),
                    s("M30 44 C30 38 36 34 40 36", 0xFFFFFF, 4, opacity: 0.6),
                    s("M50 30 C50 22 52 16 56 12", 0x6B4A2E, 4),
                    f(.path("M54 20 C62 10 74 12 76 16 C70 24 60 24 54 20 Z"), 0x5CB85C)]
        case "banana":
            return [f(.path("M20 30 C18 64 42 86 80 74 C84 72 84 68 80 68 C50 72 32 56 30 30 C30 24 20 24 20 30 Z"), 0xF6CF3D),
                    s("M30 34 C34 58 50 68 74 70", 0xD9A91F, 2.5),
                    f(.path("M20 26 L24 18 L30 22 L28 30 Z"), 0x7A5A2C)]
        case "pear":
            return [f(.path("M50 22 C40 22 38 34 38 42 C38 50 24 56 24 70 C24 84 38 90 50 90 C62 90 76 84 76 70 C76 56 62 50 62 42 C62 34 60 22 50 22 Z"), 0xA5CF4C),
                    s("M50 22 C50 16 52 12 55 9", 0x6B4A2E, 4),
                    s("M34 66 C34 60 38 56 40 56", 0xFFFFFF, 4, opacity: 0.55)]
        case "grapes":
            let pts: [(CGFloat, CGFloat)] = [(38, 34), (54, 34), (70, 36), (46, 48), (62, 48), (38, 60), (54, 62), (46, 74), (60, 76), (52, 88)]
            return pts.enumerated().map { i, p in f(.circle(p.0, p.1, 9), i % 2 == 1 ? 0x8E5BB8 : 0x7B4AA6) }
                + [s("M54 26 C54 18 58 14 62 12", 0x6B4A2E, 4), f(.path("M58 20 C66 10 80 14 80 18 C72 24 64 24 58 20 Z"), 0x5CB85C)]
        case "carrot":
            return [f(.path("M36 34 L64 34 L52 92 C51 95 49 95 48 92 Z"), 0xF08A3C),
                    s("M42 46 H50 M46 60 H54 M46 74 H52", 0xC9631F, 2.5),
                    f(.path("M50 34 C44 22 38 16 32 14 C40 24 42 28 46 34 Z M50 34 C50 22 52 14 56 10 C56 22 54 28 54 34 Z M52 34 C58 24 66 20 72 20 C64 26 60 30 56 34 Z"), 0x5CB85C)]
        case "water":
            return [fs(.path("M28 18 H72 L66 88 C66 90 64 92 62 92 H38 C36 92 34 90 34 88 Z"), 0xE7F3FB, 0x9CC7E6, 3),
                    f(.path("M32 42 H68 L65 86 C65 88 63 89 61 89 H39 C37 89 35 88 35 86 Z"), 0x8FD0F5),
                    s("M40 50 V78", 0xFFFFFF, 4, opacity: 0.7)]
        case "milk":
            return [f(.path("M32 30 L50 14 L68 30 Z"), 0xCFE0F4),
                    fs(.rect(30, 30, 40, 60, 4), 0xFBFBF8, 0xCFD6DE, 2),
                    f(.path("M30 56 C40 50 46 62 56 56 C62 52 66 54 70 56 V86 C70 88 68 90 66 90 H34 C32 90 30 88 30 86 Z"), 0x4F8FD8),
                    f(.circle(50, 42, 6), 0x4F8FD8)]
        case "juice":
            return [s("M58 8 L52 40", 0xE2483D, 4),
                    fs(.path("M28 24 H72 L66 88 C66 90 64 92 62 92 H38 C36 92 34 90 34 88 Z"), 0xFFF4E3, 0xF2C27A, 3),
                    f(.path("M31 40 H69 L65 86 C65 88 63 89 61 89 H39 C37 89 35 88 35 86 Z"), 0xF7A531),
                    f(.circle(70, 26, 12), 0xF7C948), f(.circle(70, 26, 8), 0xFBE08A)]
        case "drink":
            return [f(.rect(38, 8, 24, 14, 3), 0x2FA58A),
                    f(.path("M36 22 H64 V30 C72 38 72 44 72 50 V86 C72 90 68 92 64 92 H36 C32 92 28 90 28 86 V50 C28 44 28 38 36 30 Z"), 0x59C3A8),
                    f(.rect(28, 50, 44, 22, 0), 0xFFFFFF, opacity: 0.85),
                    f(.circle(50, 61, 6), 0xF2A33A)]
        case "icecream":
            return [f(.path("M32 52 L68 52 L52 94 C51 96 49 96 48 94 Z"), 0xE3B26D),
                    s("M38 58 L58 78 M48 54 L64 70 M36 64 L54 86 M62 56 L42 80", 0xC48C43, 2),
                    f(.circle(40, 44, 14), 0xF6A9C0), f(.circle(60, 44, 14), 0xFBE8C5),
                    f(.circle(50, 28, 14), 0xA8724E), f(.circle(54, 14, 4), 0xE2483D)]
        case "yoghurt":
            return [fs(.path("M24 30 H76 L70 88 C70 90 68 92 66 92 H34 C32 92 30 90 30 88 Z"), 0xFDFAF5, 0xE2D6C6, 2),
                    f(.rect(20, 22, 60, 10, 4), 0xF6A9C0),
                    f(.path("M30 52 H70 L68 70 H32 Z"), 0xF6A9C0),
                    f(.circle(44, 61, 4), 0xE2483D), f(.circle(56, 61, 4), 0xE2483D)]
        case "bread":
            return [f(.path("M22 44 C14 24 40 14 50 22 C60 14 86 24 78 44 V86 C78 88 76 90 74 90 H26 C24 90 22 88 22 86 Z"), 0xC98A45),
                    f(.path("M28 46 C22 30 42 22 50 30 C58 22 78 30 72 46 V84 H28 Z"), 0xF4D9A8),
                    f(.circle(42, 56, 2), 0xD9B276), f(.circle(58, 64, 2), 0xD9B276), f(.circle(46, 72, 2), 0xD9B276)]
        case "cookie":
            let chips: [(CGFloat, CGFloat)] = [(36, 40), (58, 34), (64, 56), (42, 62), (52, 74), (30, 54)]
            return [fs(.circle(50, 52, 36), 0xD9A35F, 0xB9823F, 3)] + chips.map { f(.ellipse($0.0, $0.1, 5, 4), 0x5B3A24) }
        case "snack":
            let chips: [(CGFloat, CGFloat)] = [(34, 44), (50, 38), (64, 46), (42, 50), (58, 52)]
            return chips.enumerated().map { i, p in fs(.ellipse(p.0, p.1, 12, 8), i % 2 == 1 ? 0xF6CF3D : 0xF2B93A, 0xD99A1F, 1.5) }
                + [f(.path("M14 54 H86 C84 76 70 90 50 90 C30 90 16 76 14 54 Z"), 0x4F8FD8), s("M22 66 H78", 0xFFFFFF, 3, opacity: 0.5)]
        case "cheese":
            return [f(.path("M14 70 L74 30 L88 52 V80 C88 82 86 84 84 84 H18 C16 84 14 82 14 80 Z"), 0xF7C948),
                    f(.path("M14 70 L74 30 L88 52 Z"), 0xFBE08A),
                    f(.circle(34, 74, 5), 0xE3AC2A), f(.circle(60, 66, 6), 0xE3AC2A), f(.circle(76, 76, 4), 0xE3AC2A)]
        default: // plate
            return [fs(.circle(50, 54, 34), 0xFFFFFF, 0xD8D4CC, 3),
                    f(.circle(50, 54, 22), 0xF3EFE7),
                    s("M10 30 V48 M6 30 V42 C6 46 14 46 14 42 V30", 0x9A978F, 3),
                    s("M92 26 C84 30 84 44 92 46 V70", 0x9A978F, 3)]
        }
    }
}

/// An animal on its soft colour disc (web: KidAnimal).
struct KidAnimalView: View {
    let animal: String?
    var color: String?
    var size: CGFloat = 52

    var body: some View {
        ZStack {
            Circle().fill((Color(hexString: color) ?? Theme.mustard).opacity(0.2))
            ArtCanvas(viewBox: CGSize(width: 100, height: 100), shapes: AnimalArt.shapes(animal ?? "fox"))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The product photo if there is one, otherwise the drawing (web: KidPicture).
struct KidPictureView: View {
    let imagePath: String?
    let art: String?
    let api: APIClient

    var body: some View {
        if let p = imagePath, !p.isEmpty {
            KidRemoteImage(url: api.imageURL(p), api: api) {
                ArtCanvas(viewBox: CGSize(width: 100, height: 100), shapes: KidFoodArt.shapes(art))
            }
        } else {
            ArtCanvas(viewBox: CGSize(width: 100, height: 100), shapes: KidFoodArt.shapes(art))
        }
    }
}

/// Like RemoteImage, but fitting (whole product visible) and with a drawing while it loads.
struct KidRemoteImage<Fallback: View>: View {
    let url: URL?
    let api: APIClient
    @ViewBuilder let fallback: () -> Fallback
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                fallback().opacity(failed ? 1 : 0.35)
            }
        }
        .task(id: url) { await load() }
        .accessibilityHidden(true)
    }

    private func load() async {
        guard let url else { failed = true; return }
        if let cached = ImageCache.shared.image(for: url) { image = cached; return }
        var req = URLRequest(url: url)
        if let token = api.token, url.host() == api.baseURL.host() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let hh = api.householdId, url.host() == api.baseURL.host() { req.setValue(hh, forHTTPHeaderField: "X-Household") }
        guard let (data, _) = try? await URLSession.shared.data(for: req), let img = UIImage(data: data) else { failed = true; return }
        ImageCache.shared.set(img, for: url)
        image = img
    }
}
