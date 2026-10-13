import SwiftUI

/// Wrapping row of chips (stores, aisles, members) – lines break like text.
struct ShopChipFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width { y += line + spacing; x = 0; line = 0 }
            x += s.width + spacing
            line = max(line, s.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(width, widest), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { y += line + spacing; x = bounds.minX; line = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            line = max(line, s.height)
        }
    }
}

/// A toggle chip: green when on, outlined when off (≥ 36 pt high, the whole chip is the target).
struct ShopToggleChip: View {
    let title: String
    var systemImage: String?
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let systemImage { Image(systemName: systemImage).font(.caption.weight(.semibold)) }
                Text(title).lineLimit(1)
            }
            .font(.subheadline)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(on ? Theme.primary : Theme.surface, in: Capsule())
            .foregroundStyle(on ? Theme.onPrimary : Theme.ink)
            .overlay(Capsule().stroke(on ? Color.clear : Theme.line, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Round initial for a member (their colour from the server, else brand green).
struct ShopMemberDot: View {
    let name: String
    var color: String?
    var size: CGFloat = 28

    var body: some View {
        Text(String(name.prefix(1)).uppercased())
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(ShopColors.member(color), in: Circle())
            .accessibilityHidden(true)
    }
}

enum ShopColors {
    /// a member's colour from the server ("#2f5bea"), else brand green
    static func member(_ hex: String?) -> Color {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return Theme.primary }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return Theme.primary }
        return Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

/// "Wo kaufen?" – chips from the household's own stores plus free text. Only a person sets this.
struct BuyAtEditor: View {
    @Binding var stores: [String]
    let suggestions: BuyAtSuggestions?
    @State private var text = ""
    static let max = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ShopChipFlow {
                ForEach(suggestions?.options(chosen: stores) ?? stores, id: \.self) { s in
                    let on = stores.contains { $0.caseInsensitiveCompare(s) == .orderedSame }
                    ShopToggleChip(title: s, systemImage: on ? "checkmark" : "plus", on: on) { toggle(s) }
                }
            }
            HStack {
                TextField(L("Somewhere else, e.g. weekly market"), text: $text)
                    .submitLabel(.done)
                    .onSubmit(addText)
                Button(L("Add"), action: addText).disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(.vertical, 4)
    }

    private func toggle(_ s: String) {
        if let i = stores.firstIndex(where: { $0.caseInsensitiveCompare(s) == .orderedSame }) {
            stores.remove(at: i)
        } else if stores.count < Self.max {
            stores.append(s)
        }
        Haptics.tick()
    }

    private func addText() {
        let s = String(text.trimmingCharacters(in: .whitespaces).prefix(40))
        text = ""
        guard !s.isEmpty, !stores.contains(where: { $0.caseInsensitiveCompare(s) == .orderedSame }) else { return }
        toggle(s)
    }
}

/// Icon and text close together (the default Label spacing is too wide for caption lines in a row).
struct ShopTightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}
