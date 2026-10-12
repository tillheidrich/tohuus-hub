import SwiftUI

/// A small SVG path-data reader (M L H V C S Q T A Z, absolute and relative) so the web's drawings
/// (web/src/art.tsx, web/src/pages/KidArt.tsx) can be ported 1:1 as path strings instead of being redrawn by hand.
enum SVGPath {
    private static let cache = PathCache()

    static func path(_ d: String) -> Path {
        if let p = cache.get(d) { return p }
        let p = parse(d)
        cache.set(d, p)
        return p
    }

    private enum Token { case cmd(Character), num(CGFloat) }

    private static func tokens(_ d: String) -> [Token] {
        var out: [Token] = []
        var buf = ""
        func flush() {
            if !buf.isEmpty, let v = Double(buf) { out.append(.num(CGFloat(v))) }
            buf = ""
        }
        for ch in d {
            if ch.isLetter && ch != "e" && ch != "E" {
                flush(); out.append(.cmd(ch))
            } else if ch == "-" {
                // a minus starts a new number unless it follows an exponent
                if let last = buf.last, last == "e" || last == "E" { buf.append(ch) } else { flush(); buf.append(ch) }
            } else if ch == "." {
                if buf.contains(".") && !buf.contains("e") { flush() }
                buf.append(ch)
            } else if ch.isNumber || ch == "e" || ch == "E" {
                buf.append(ch)
            } else {
                flush()
            }
        }
        flush()
        return out
    }

    private static func parse(_ d: String) -> Path {
        var p = Path()
        let t = tokens(d)
        var i = 0
        var cmd: Character = "M"
        var cur = CGPoint.zero
        var start = CGPoint.zero
        var lastCtrl: CGPoint?
        var lastQuad: CGPoint?
        func num() -> CGFloat? {
            guard i < t.count, case .num(let v) = t[i] else { return nil }
            i += 1
            return v
        }
        func hasNum() -> Bool { i < t.count && { if case .num = t[i] { return true } else { return false } }() }

        while i < t.count {
            if case .cmd(let c) = t[i] { cmd = c; i += 1 }
            let rel = cmd.isLowercase
            let base = rel ? cur : .zero
            switch cmd.uppercased().first! {
            case "M":
                guard let x = num(), let y = num() else { i += 1; continue }
                cur = CGPoint(x: base.x + x, y: base.y + y)
                start = cur
                p.move(to: cur)
                cmd = rel ? "l" : "L" // further pairs are line-tos
                lastCtrl = nil; lastQuad = nil
            case "L":
                guard let x = num(), let y = num() else { i += 1; continue }
                cur = CGPoint(x: base.x + x, y: base.y + y)
                p.addLine(to: cur)
                lastCtrl = nil; lastQuad = nil
            case "H":
                guard let x = num() else { i += 1; continue }
                cur = CGPoint(x: (rel ? cur.x : 0) + x, y: cur.y)
                p.addLine(to: cur)
                lastCtrl = nil; lastQuad = nil
            case "V":
                guard let y = num() else { i += 1; continue }
                cur = CGPoint(x: cur.x, y: (rel ? cur.y : 0) + y)
                p.addLine(to: cur)
                lastCtrl = nil; lastQuad = nil
            case "C":
                guard let x1 = num(), let y1 = num(), let x2 = num(), let y2 = num(), let x = num(), let y = num() else { i += 1; continue }
                let c1 = CGPoint(x: base.x + x1, y: base.y + y1)
                let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                cur = CGPoint(x: base.x + x, y: base.y + y)
                p.addCurve(to: cur, control1: c1, control2: c2)
                lastCtrl = c2; lastQuad = nil
            case "S":
                guard let x2 = num(), let y2 = num(), let x = num(), let y = num() else { i += 1; continue }
                let c1 = lastCtrl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                cur = CGPoint(x: base.x + x, y: base.y + y)
                p.addCurve(to: cur, control1: c1, control2: c2)
                lastCtrl = c2; lastQuad = nil
            case "Q":
                guard let x1 = num(), let y1 = num(), let x = num(), let y = num() else { i += 1; continue }
                let c = CGPoint(x: base.x + x1, y: base.y + y1)
                cur = CGPoint(x: base.x + x, y: base.y + y)
                p.addQuadCurve(to: cur, control: c)
                lastQuad = c; lastCtrl = nil
            case "T":
                guard let x = num(), let y = num() else { i += 1; continue }
                let c = lastQuad.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                cur = CGPoint(x: base.x + x, y: base.y + y)
                p.addQuadCurve(to: cur, control: c)
                lastQuad = c; lastCtrl = nil
            case "A":
                guard let rx = num(), let ry = num(), let rot = num(), let large = num(), let sweep = num(), let x = num(), let y = num() else { i += 1; continue }
                let to = CGPoint(x: base.x + x, y: base.y + y)
                addArc(&p, from: cur, to: to, rx: rx, ry: ry, rotation: rot, large: large != 0, sweep: sweep != 0)
                cur = to
                lastCtrl = nil; lastQuad = nil
            case "Z":
                p.closeSubpath()
                cur = start
                lastCtrl = nil; lastQuad = nil
                // a number right after Z would be an implicit moveto – not used in our drawings
                if hasNum() { cmd = rel ? "m" : "M" }
            default:
                i += 1
            }
        }
        return p
    }

    /// SVG endpoint arc → cubic Béziers (SVG spec, appendix F.6).
    private static func addArc(_ p: inout Path, from p0: CGPoint, to p1: CGPoint, rx rx0: CGFloat, ry ry0: CGFloat,
                               rotation: CGFloat, large: Bool, sweep: Bool) {
        var rx = abs(rx0), ry = abs(ry0)
        if rx == 0 || ry == 0 || p0 == p1 { p.addLine(to: p1); return }
        let phi = rotation * .pi / 180
        let cosP = cos(phi), sinP = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 = cosP * dx + sinP * dy
        let y1 = -sinP * dx + cosP * dy
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
        var coef = den == 0 ? 0 : sqrt(max(0, num / den))
        if large == sweep { coef = -coef }
        let cxp = coef * rx * y1 / ry
        let cyp = -coef * ry * x1 / rx
        let cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2
        let cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2
        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
        var delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }
        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / CGFloat(segments)
        let k = 4.0 / 3.0 * tan(step / 4)
        func point(_ t: CGFloat) -> CGPoint {
            let x = rx * cos(t), y = ry * sin(t)
            return CGPoint(x: cx + cosP * x - sinP * y, y: cy + sinP * x + cosP * y)
        }
        func deriv(_ t: CGFloat) -> CGPoint {
            let x = -rx * sin(t), y = ry * cos(t)
            return CGPoint(x: cosP * x - sinP * y, y: sinP * x + cosP * y)
        }
        var t = theta1
        for _ in 0..<segments {
            let t2 = t + step
            let a = point(t), b = point(t2)
            let da = deriv(t), db = deriv(t2)
            p.addCurve(to: b, control1: CGPoint(x: a.x + k * da.x, y: a.y + k * da.y), control2: CGPoint(x: b.x - k * db.x, y: b.y - k * db.y))
            t = t2
        }
    }
}

private final class PathCache: @unchecked Sendable {
    private var store: [String: Path] = [:]
    private let lock = NSLock()
    func get(_ k: String) -> Path? { lock.lock(); defer { lock.unlock() }; return store[k] }
    func set(_ k: String, _ v: Path) { lock.lock(); store[k] = v; lock.unlock() }
}

// MARK: - drawing kit

/// A colour for a drawing: a brand token (follows light/dark) or a fixed hex (kid animals).
enum ArtPaint: Sendable, Hashable {
    case primary, primaryDark, primarySoft, sand, sage, mustard, clay, ink, surface, primaryText, hex(UInt32)

    var color: Color {
        switch self {
        case .primary: return Theme.primary
        case .primaryDark: return Theme.primaryDark
        // dark mode: the soft disc turns sage-soft (web: :root[data-theme='dark'] .ia .f-ps)
        case .primarySoft: return ArtColors.softDisc
        case .sand: return Theme.sand
        case .sage: return Theme.sage
        case .mustard: return Theme.mustard
        case .clay: return Theme.clay
        case .ink: return Theme.ink
        case .surface: return Theme.surface
        case .primaryText: return Theme.primaryText
        case .hex(let h): return Color(UIColor(hex: h))
        }
    }
}

enum ArtColors {
    static let softDisc = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x273A30) : UIColor(hex: 0xE4EEE6) })
}

/// One shape of a drawing in viewBox units.
struct ArtShape: Sendable {
    enum Geometry: Sendable {
        case path(String)
        case circle(CGFloat, CGFloat, CGFloat)
        case ellipse(CGFloat, CGFloat, CGFloat, CGFloat)
        case rect(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)
    }
    var geometry: Geometry
    var fill: ArtPaint?
    var stroke: ArtPaint?
    var lineWidth: CGFloat = 0
    var opacity: Double = 1

    var path: Path {
        switch geometry {
        case .path(let d): return SVGPath.path(d)
        case .circle(let cx, let cy, let r): return Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r))
        case .ellipse(let cx, let cy, let rx, let ry): return Path(ellipseIn: CGRect(x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry))
        case .rect(let x, let y, let w, let h, let r):
            let rect = CGRect(x: x, y: y, width: w, height: h)
            return r > 0 ? Path(roundedRect: rect, cornerRadius: r) : Path(rect)
        }
    }

    // the web's CSS classes (web/src/styles.css ".ia …") as a compact constructor: "f-p s-k2"
    static func path(_ d: String, _ cls: String) -> ArtShape { ArtShape(geometry: .path(d), cls: cls) }
    static func circle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, _ cls: String) -> ArtShape { ArtShape(geometry: .circle(cx, cy, r), cls: cls) }
    static func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ cls: String, rx: CGFloat = 0) -> ArtShape {
        ArtShape(geometry: .rect(x, y, w, h, rx), cls: cls)
    }

    init(geometry: Geometry, fill: ArtPaint? = nil, stroke: ArtPaint? = nil, lineWidth: CGFloat = 0, opacity: Double = 1) {
        self.geometry = geometry
        self.fill = fill
        self.stroke = stroke
        self.lineWidth = lineWidth
        self.opacity = opacity
    }

    init(geometry: Geometry, cls: String) {
        var fill: ArtPaint?
        var stroke: ArtPaint?
        var width: CGFloat = 0
        var strokeClearsFill = false
        for c in cls.split(separator: " ") {
            switch c {
            case "f-p": fill = .primary
            case "f-pd": fill = .primaryDark
            case "f-ps": fill = .primarySoft
            case "f-s": fill = .sand
            case "f-g": fill = .sage
            case "f-m": fill = .mustard
            case "f-c": fill = .clay
            case "f-k": fill = .ink
            case "f-w": fill = .surface
            case "s-k15": stroke = .ink; width = 1.5; strokeClearsFill = true
            case "s-k2": stroke = .ink; width = 2
            case "s-k3": stroke = .ink; width = 3
            case "s-w2": stroke = .surface; width = 2; strokeClearsFill = true
            case "s-w3": stroke = .surface; width = 3; strokeClearsFill = true
            case "s-p3": stroke = .primaryText; width = 3; strokeClearsFill = true
            default: break
            }
        }
        // same cascade as the CSS: s-k15 / s-w* / s-p3 set fill:none and come later in the stylesheet
        if strokeClearsFill { fill = nil }
        self.init(geometry: geometry, fill: fill, stroke: stroke, lineWidth: width)
    }
}

/// Draws shapes in a viewBox, scaled to fit. Decorative: hidden from VoiceOver.
struct ArtCanvas: View {
    let viewBox: CGSize
    let shapes: [ArtShape]

    var body: some View {
        Canvas { ctx, size in
            let s = min(size.width / viewBox.width, size.height / viewBox.height)
            ctx.translateBy(x: (size.width - viewBox.width * s) / 2, y: (size.height - viewBox.height * s) / 2)
            ctx.scaleBy(x: s, y: s)
            for shape in shapes {
                let path = shape.path
                var c = ctx
                c.opacity = shape.opacity
                if let f = shape.fill { c.fill(path, with: .color(f.color)) }
                if let st = shape.stroke {
                    c.stroke(path, with: .color(st.color), style: StrokeStyle(lineWidth: shape.lineWidth, lineCap: .round, lineJoin: .round))
                }
            }
        }
        .aspectRatio(viewBox.width / viewBox.height, contentMode: .fit)
        .accessibilityHidden(true)
    }
}
