import SwiftUI

// Cards and sections that load their own data and hide themselves while there is nothing to show.
//
// The trap: `Group { if loaded { Card … } }.task { await load() }` never loads. A Group hands its modifiers to its
// children; while the condition is false there is no child, so `.task`/`.onAppear`/`.sheet` attach to nothing and the
// card stays hidden for good. The load needs a host that always exists – without leaving a gap when it stays empty:
//
// • ScrollView / VStack: `LoadSlot { if … { Card … } }.task { … }` – the slot always exists (0 × 0 when empty).
//   Put cards in a `CardStack` instead of a VStack: a VStack adds its spacing even around a 0-pt child, CardStack
//   skips children without height.
// • List / Form: no view can stay invisible there – every row gets at least `defaultMinListRowHeight`, a 0-pt row
//   may not appear at all, and an empty section with a 0-pt header still adds 10–30 pt (tried in the simulator).
//   So sections load from their own body instead: `@State private var loader = LoadTrigger()` and, first thing in
//   `body`, `let _ = loader.run(id: refresh) { await load() }`. A List has to evaluate a component's body to learn
//   whether it adds sections, so the load always starts; it runs again when `id` changes and is cancelled when the
//   component leaves the screen for good. Sheets and dialogs go on the visible section (they open from there).

/// The invisible, always-present view that `.task`, `.onAppear`, `.sheet` … hang on.
struct AnchorPoint: View {
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
}

/// Scroll views: a slot that always exists, so its `.task`/`.onAppear` always run, and that is 0 × 0 while `content`
/// is empty (an empty slot in a `CardStack` takes no space and no spacing).
struct LoadSlot<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnchorPoint()
            content
        }
    }
}

/// Lists and forms: starts a load from the component's body, once per `id` (see above). Like `.task(id:)`, minus
/// the need for a view to hang on: the previous run is cancelled when `id` changes, the last one when the
/// component's state goes away.
final class LoadTrigger {
    private var id: AnyHashable?
    private var task: Task<Void, Never>?

    /// Returns nothing useful; call it as `let _ = loader.run(id: …) { … }` inside `body`.
    @discardableResult
    func run(id: AnyHashable = 0, _ work: @escaping @MainActor () async -> Void) -> Bool {
        guard id != self.id else { return false }
        self.id = id
        task?.cancel()
        // never mutate state during the view update itself: the work starts on the next main-actor turn
        task = Task { @MainActor in await work() }
        return true
    }

    deinit { task?.cancel() }
}

/// A vertical stack for scroll views: like `VStack(alignment:spacing:)`, but children without height (an empty
/// `LoadSlot`, a card that hid itself) get no spacing either – a hidden card leaves no gap. Children get their ideal
/// height, as in a ScrollView; not meant for stacks that should stretch to fill a fixed height.
struct CardStack: Layout {
    var alignment: HorizontalAlignment = .leading
    var spacing: CGFloat

    struct Cache { var width: CGFloat?; var sizes: [CGSize] }

    func makeCache(subviews: Subviews) -> Cache { Cache(width: nil, sizes: []) }

    private func sizes(_ width: CGFloat?, _ subviews: Subviews, _ cache: inout Cache) -> [CGSize] {
        if cache.width == width, cache.sizes.count == subviews.count { return cache.sizes }
        let s = subviews.map { $0.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
        cache = Cache(width: width, sizes: s)
        return s
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize {
        var height: CGFloat = 0, width: CGFloat = 0, shown = 0
        for size in sizes(proposal.width, subviews, &cache) where size.height > 0 {
            height += size.height + (shown > 0 ? spacing : 0)
            width = max(width, size.width)
            shown += 1
        }
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) {
        var y = bounds.minY, shown = 0
        for (sub, size) in zip(subviews, sizes(bounds.width, subviews, &cache)) {
            let visible = size.height > 0
            if visible && shown > 0 { y += spacing }
            let x: CGFloat
            switch alignment {
            case .center: x = bounds.midX - size.width / 2
            case .trailing: x = bounds.maxX - size.width
            default: x = bounds.minX
            }
            sub.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: bounds.width, height: size.height))
            if visible { y += size.height; shown += 1 }
        }
    }
}
