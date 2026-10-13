import SwiftUI

/// Wrapping row layout for chips and tags.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing
            rowH = max(rowH, s.height)
            maxX = max(maxX, x - spacing)
        }
        return CGSize(width: min(maxX, width), height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowH = max(rowH, s.height)
        }
    }
}

/// A selectable chip (≥ 44 pt tall hit area through padding + contentShape).
struct ChoiceChip: View {
    let title: String
    var systemImage: String?
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let systemImage { Image(systemName: systemImage).font(.caption) }
                Text(title).font(.subheadline)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .foregroundStyle(on ? Theme.onPrimary : Theme.ink)
            .background(on ? Theme.primary : Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(on ? Color.clear : Theme.line, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Tags / likes / allergies: chips with a remove button, a field to add more, optional suggestions.
struct TagEditor: View {
    let label: String
    @Binding var values: [String]
    var suggestions: [String] = []
    var placeholder = L("New tag, e.g. Party")
    /// "low" (allergies) or "good" (likes)
    var tone: String?
    var help: String?
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
            FlowLayout(spacing: 6) {
                ForEach(values, id: \.self) { v in
                    Button {
                        values.removeAll { $0 == v }
                    } label: {
                        HStack(spacing: 4) {
                            Text(v)
                            Image(systemName: "xmark").font(.caption2.weight(.bold))
                        }
                        .font(.subheadline)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .foregroundStyle(fg)
                        .background(bg, in: Capsule())
                        // the visible chip stays small; the tap area is 44 pt high (FlowLayout spacing absorbs it)
                        .padding(.vertical, 5)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(LF("Remove %@", v))
                }
                ForEach(suggestions.filter { s in !values.contains { $0.caseInsensitiveCompare(s) == .orderedSame } }.prefix(8), id: \.self) { s in
                    Button("+ \(s)") { add(s) }
                        .font(.subheadline)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .foregroundStyle(Theme.ink2)
                        .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                        .buttonStyle(.plain)
                }
            }
            HStack {
                TextField(placeholder, text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.done)
                    .onSubmit { add(draft) }
                    .onChange(of: draft) { _, v in if v.hasSuffix(",") { add(String(v.dropLast())) } }
                if !draft.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button(L("Add")) { add(draft) }.font(.subheadline.weight(.semibold))
                }
            }
            if let help { Text(help).font(.caption).foregroundStyle(Theme.ink3) }
        }
    }

    private var fg: Color { tone == "low" ? Theme.low : tone == "good" ? Theme.primaryText : Theme.ink }
    private var bg: Color { tone == "low" ? Theme.lowSoft : tone == "good" ? Theme.primarySoft : Theme.surface2 }

    private func add(_ raw: String) {
        let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        for p in parts where !values.contains(where: { $0.caseInsensitiveCompare(p) == .orderedSame }) { values.append(String(p.prefix(40))) }
        draft = ""
    }
}

/// UIActivityViewController for files and links (share sheet).
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
