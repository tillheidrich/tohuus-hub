import SwiftUI

/// Delete with "Undo" instead of a confirmation (Till, 20.10.2026: "per Swipe einen Einkauf oder Bon direkt in der
/// ersten Ansicht löschen"). The row disappears at once and a toast offers "Undo"; the server only hears about it
/// when the toast goes away (time is up, another toast replaces it, the screen closes). Undo before that = nothing
/// happened. So the existing delete/discard endpoints are used unchanged, bookings are taken back as before.
@MainActor @Observable
final class PendingRemovals {
    /// keys of rows hidden right now (e.g. "import:12", "expense:4")
    private(set) var hidden: Set<String> = []
    private var pending: [UUID: (key: String, commit: @MainActor () async -> Void)] = [:]

    func isHidden(_ key: String) -> Bool { hidden.contains(key) }

    /// Hide the row and return the toast with "Undo"; set it as the screen's toast.
    func remove(_ key: String, text: String, commit: @escaping @MainActor () async -> Void) -> ToastMessage {
        hidden.insert(key)
        var msg = ToastMessage(text: text, actionTitle: L("Undo"))
        let id = msg.id
        msg.action = { [weak self] in
            guard let self else { return }
            self.pending[id] = nil
            self.hidden.remove(key)
        }
        pending[id] = (key, commit)
        Haptics.success()
        return msg
    }

    /// Call from `.onChange(of: toast)`: the toast that went away commits its removal (unless undone).
    func toastChanged(from old: ToastMessage?) {
        guard let old, let p = pending.removeValue(forKey: old.id) else { return }
        Task { await p.commit() }
    }

    /// The screen goes away: everything still waiting is done now.
    func flush() {
        let all = pending.values
        pending = [:]
        for p in all { Task { await p.commit() } }
    }

    /// The server said no: show the row again.
    func restore(_ key: String) { hidden.remove(key) }
}

/// Swipe left to delete for rows outside a `List` (cards): the row slides, a red button appears behind it; a full
/// swipe deletes straight away. Inside a `List` use `.swipeActions` instead. VoiceOver gets the same as an action.
struct SwipeToDeleteModifier: ViewModifier {
    let enabled: Bool
    let label: String
    let systemImage: String
    let action: () -> Void
    /// the row's own background (cards: Theme.surface), so the red button does not shine through
    var rowBackground: Color = Theme.surface
    @State private var offset: CGFloat = 0
    @State private var dragStart: CGFloat?
    @State private var width: CGFloat = 320
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let button: CGFloat = 88

    func body(content: Content) -> some View {
        if !enabled {
            content
        } else {
            content
                .background(rowBackground)
                .offset(x: offset)
                .background(alignment: .trailing) {
                    if offset < 0 {
                        Button(action: fire) {
                            Label(label, systemImage: systemImage).labelStyle(.iconOnly)
                                .font(.headline).foregroundStyle(.white)
                                .frame(width: max(button, -offset), alignment: .center)
                                .frame(maxHeight: .infinity)
                                .contentShape(Rectangle())
                        }
                        .background(Theme.empty, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                        .accessibilityHidden(true)
                    }
                }
                .clipped()
                .onGeometryChangeCompat { width = $0 }
                .simultaneousGesture(
                    DragGesture(minimumDistance: 24)
                        .onChanged { g in
                            // only clearly sideways drags – vertical scrolling stays untouched
                            guard abs(g.translation.width) > abs(g.translation.height) * 1.5 else { return }
                            if dragStart == nil { dragStart = offset }
                            offset = min(0, (dragStart ?? 0) + g.translation.width)
                        }
                        .onEnded { g in
                            let start = dragStart ?? 0
                            dragStart = nil
                            guard abs(g.translation.width) > abs(g.translation.height) * 1.5 else { return settle(start) }
                            let end = start + g.translation.width
                            if -end > width * 0.6 { fire() }
                            else if -end > button * 0.6 { settle(-button) }
                            else { settle(0) }
                        }
                )
                .accessibilityAction(named: Text(label)) { action() }
        }
    }

    private func settle(_ x: CGFloat) {
        if reduceMotion { offset = x } else { withAnimation(.spring(duration: 0.25)) { offset = x } }
    }

    private func fire() {
        settle(0)
        action()
    }
}

extension View {
    func swipeToDelete(enabled: Bool = true, label: String, systemImage: String = "trash", rowBackground: Color = Theme.surface, action: @escaping () -> Void) -> some View {
        modifier(SwipeToDeleteModifier(enabled: enabled, label: label, systemImage: systemImage, action: action, rowBackground: rowBackground))
    }
}
