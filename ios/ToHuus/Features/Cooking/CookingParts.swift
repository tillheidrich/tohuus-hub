import SwiftUI

// Small shared pieces of the cooking area: person dots, chips, toast, servings stepper, amount scaling.

/// Round initial in the person's colour (web: Avatar).
struct PersonDot: View {
    let name: String
    var color: String?
    var size: CGFloat = 30

    var body: some View {
        Text(String(name.prefix(1)).uppercased())
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color(hexString: color) ?? Theme.sage, in: Circle())
            .accessibilityHidden(true)
    }
}

extension Color {
    /// "#3a7d5c" → Color
    init?(hexString: String?) {
        guard var s = hexString?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(UIColor(hex: v))
    }
}

/// Filter / choice chip (≥ 44 pt tall tap area).
struct CookChip: View {
    let title: String
    var systemImage: String?
    var on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let systemImage { Image(systemName: systemImage).font(.caption) }
                Text(title).font(.subheadline.weight(on ? .semibold : .regular))
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .foregroundStyle(on ? Theme.onPrimary : Theme.ink)
            .background(on ? Theme.primary : Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(on ? Color.clear : Theme.line, lineWidth: 1))
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Simple wrapping layout for chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > 0 && x + sz.width > w { x = 0; y += row + spacing; row = 0 }
            x += sz.width + spacing
            maxX = max(maxX, x)
            row = max(row, sz.height)
        }
        return CGSize(width: min(w, maxX), height: y + row)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + sz.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing
            row = max(row, sz.height)
        }
    }
}

/// − n + with a label ("Für 6 Personen").
struct ServingsStepper: View {
    let value: Int
    var label: String
    var detail: String?
    var reset: (() -> Void)?
    let onChange: (Int) -> Void

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: "person.2").foregroundStyle(Theme.primaryText)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.subheadline.weight(.semibold))
                HStack(spacing: 4) {
                    if let detail { Text(detail).font(.caption).foregroundStyle(Theme.ink3) }
                    if let reset { Button(LC("reset"), action: reset).font(.caption.weight(.semibold)) }
                }
            }
            Spacer(minLength: 4)
            HStack(spacing: 0) {
                Button { onChange(max(1, value - 1)) } label: { Image(systemName: "minus").frame(width: 44, height: 40) }
                    .disabled(value <= 1)
                    .accessibilityLabel(LC("less"))
                Text("\(value)").font(.body.monospacedDigit().weight(.semibold)).frame(minWidth: 28)
                Button { onChange(min(60, value + 1)) } label: { Image(systemName: "plus").frame(width: 44, height: 40) }
                    .disabled(value >= 60)
                    .accessibilityLabel(LC("more"))
            }
            .background(Theme.surface2, in: Capsule())
        }
        .padding(Theme.Space.s3)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
    }
}

/// Bottom toast with an optional action ("Rückgängig").
struct CookToastData: Equatable {
    var text: String
    var actionLabel: String?
    var id = UUID()
    static func == (a: CookToastData, b: CookToastData) -> Bool { a.id == b.id }
}

extension View {
    func cookToast(_ toast: Binding<CookToastData?>, bottom: CGFloat = 24, action: (() -> Void)? = nil) -> some View {
        overlay(alignment: .bottom) {
            if let t = toast.wrappedValue {
                HStack(spacing: Theme.Space.s3) {
                    Text(t.text).font(.subheadline)
                    if let label = t.actionLabel, let action {
                        Button(label) { toast.wrappedValue = nil; action() }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.mustard)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(Theme.ink, in: Capsule())
                .foregroundStyle(Theme.canvas)
                .padding(.horizontal, Theme.Space.s4)
                .padding(.bottom, bottom)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: t.id) {
                    try? await Task.sleep(nanoseconds: 3_500_000_000)
                    if toast.wrappedValue?.id == t.id { toast.wrappedValue = nil }
                }
            }
        }
    }
}

/// Section title in the cooking screens.
struct CookHeading: View {
    let title: String
    var hint: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.headline).foregroundStyle(Theme.ink)
            if let hint { Text(hint).font(.caption).foregroundStyle(Theme.ink3) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, Theme.Space.s2)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - scaling amounts (port of web/src/scale.ts)

enum AmountScale {
    private static let vulgar: [Character: Double] = ["½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1.0 / 3, "⅔": 2.0 / 3, "⅛": 0.125]
    private static let fractions: [(Double, String)] = [(0.25, "¼"), (1.0 / 3, "⅓"), (0.5, "½"), (2.0 / 3, "⅔"), (0.75, "¾")]
    private static let num = #"\d+\s+\d+/\d+|\d+\s*[½¼¾⅓⅔⅛]|\d+/\d+|[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?"#
    private static let lead = try! NSRegularExpression(pattern: #"^(\s*)("# + num + #")(?:(\s*(?:-|–|bis|to|till)\s*)("# + num + #"))?(\s*)([\p{L}.]+)?"#, options: [.caseInsensitive])
    private static let mass = try! NSRegularExpression(pattern: "^(g|gr|gramm|kg|mg)\\.?$", options: .caseInsensitive)
    private static let volume = try! NSRegularExpression(pattern: "^(ml|cl|dl|l|liter|litre)\\.?$", options: .caseInsensitive)

    static func parse(_ s: String) -> Double? {
        let x = s.trimmingCharacters(in: .whitespaces)
        if x.count == 1, let c = x.first, let v = vulgar[c] { return v }
        if let last = x.last, let v = vulgar[last], let whole = Double(x.dropLast().trimmingCharacters(in: .whitespaces)) { return whole + v }
        let parts = x.split(separator: " ")
        if parts.count == 2, let w = Double(parts[0]), let f = parse(String(parts[1])) { return w + f }
        let frac = x.split(separator: "/")
        if frac.count == 2, let a = Double(frac[0]), let b = Double(frac[1]), b > 0 { return a / b }
        return Double(x.replacingOccurrences(of: ",", with: "."))
    }

    static func fraction(_ n: Double) -> String {
        if n <= 0 { return "0" }
        var whole = floor(n)
        var rest = n - whole
        if rest > 0.88 { whole += 1; rest = 0 }
        if rest < 0.12 { return whole == 0 ? "¼" : String(Int(whole)) }
        var best = fractions[0]
        for f in fractions where abs(f.0 - rest) < abs(best.0 - rest) { best = f }
        return (whole > 0 ? String(Int(whole)) : "") + best.1
    }

    private static func roundMetric(_ n: Double, unit: String) -> Double {
        let u = unit.lowercased().replacingOccurrences(of: ".", with: "")
        if ["kg", "l", "liter", "litre"].contains(u) { return (n * 100).rounded() / 100 }
        if u == "dl" || u == "cl" { return (n * 10).rounded() / 10 }
        if n < 20 { return max(1, n.rounded()) }
        if n < 100 { return (n / 5).rounded() * 5 }
        if n < 1000 { return (n / 10).rounded() * 10 }
        return (n / 50).rounded() * 50
    }

    /// "500 g Hack" × 1.5 → "750 g Hack"; "2 Zwiebeln" × 1.5 → "3 Zwiebeln"; text without amount stays.
    static func scale(_ text: String, _ factor: Double) -> String {
        guard factor > 0, abs(factor - 1) > 0.001 else { return text }
        let ns = text as NSString
        guard let m = lead.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return text }
        func g(_ i: Int) -> String? { let r = m.range(at: i); return r.location == NSNotFound ? nil : ns.substring(with: r) }
        guard let a = g(2), let q = parse(a), q > 0 else { return text }
        let qTo = g(4).flatMap(parse)
        let unit = g(6)
        let isMetric = unit.map { u in
            let r = NSRange(location: 0, length: (u as NSString).length)
            return mass.firstMatch(in: u, range: r) != nil || volume.firstMatch(in: u, range: r) != nil
        } ?? false
        let comma = a.contains(",") || (!a.contains(".") && Locale.current.decimalSeparator == ",")
        func fmt(_ v: Double) -> String {
            let x = v * factor
            if isMetric, let unit {
                let r = roundMetric(x, unit: unit)
                var s = r.rounded() == r ? String(Int(r)) : String(r)
                if comma { s = s.replacingOccurrences(of: ".", with: ",") }
                return s
            }
            return fraction(x)
        }
        var out = (g(1) ?? "") + fmt(q)
        if let qTo, let sep = g(3) { out += sep + fmt(qTo) }
        let consumed = (g(1) ?? "").utf16.count + a.utf16.count + (g(3) ?? "").utf16.count + (g(4) ?? "").utf16.count
        return out + ns.substring(from: consumed)
    }

    /// Countable products to book out after cooking, amounts following the servings (RecipeServings.tsx scaledConsumption).
    static func consumption(_ lines: [RecipeMatchLine], factor: Double) -> [(product: RecipeMatchLine.Product, qty: Double)] {
        var out: [(product: RecipeMatchLine.Product, qty: Double)] = []
        let spoon = try! NSRegularExpression(pattern: "^(el|tl|msk|tsk|krm|tbsp|tsp|prise|prisen|pinch|cup|cups|becher|bund|zehe|zehen|scheibe|scheiben)\\.?$", options: .caseInsensitive)
        for l in lines {
            guard let p = l.product, p.trackMode == "count", (p.total ?? 0) > 0, !out.contains(where: { $0.product.id == p.id }) else { continue }
            var qty = max(1, factor.rounded())
            let ns = l.text as NSString
            if let m = lead.firstMatch(in: l.text, range: NSRange(location: 0, length: ns.length)) {
                let a = ns.substring(with: m.range(at: 2))
                let toR = m.range(at: 4)
                let unitR = m.range(at: 6)
                let unit = unitR.location == NSNotFound ? nil : ns.substring(with: unitR)
                let metric = unit.map { u in
                    let r = NSRange(location: 0, length: (u as NSString).length)
                    return mass.firstMatch(in: u, range: r) != nil || volume.firstMatch(in: u, range: r) != nil
                        || spoon.firstMatch(in: u, range: r) != nil
                } ?? false
                let v = toR.location == NSNotFound ? parse(a) : parse(ns.substring(with: toR))
                if !metric, let v, v.rounded() == v { qty = max(1, (v * factor).rounded()) }
            }
            out.append((p, min(qty, max(1, floor(p.total ?? 1)))))
        }
        return out
    }
}
