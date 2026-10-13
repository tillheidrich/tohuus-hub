import SwiftUI
import UIKit

/// Few, quiet, purposeful animations (13 Oct 2026): rows that are ticked off or added, numbers that change, the
/// content of a tab coming in, the feedback when someone reserves a wish or says "I'll bring it". Everything here
/// checks Reduce Motion – then the change simply happens, without movement.
enum Motion {
    /// lists, rows, sections
    static let standard = Animation.snappy(duration: 0.28)
    /// numbers and small state changes
    static let quick = Animation.easeOut(duration: 0.2)

    /// `withAnimation` unless Reduce Motion is on
    @MainActor static func perform(_ animation: Animation = standard, _ body: () -> Void) {
        if UIAccessibility.isReduceMotionEnabled { body() } else { withAnimation(animation, body) }
    }
}

private struct MotionAnimation<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let animation: Animation
    let value: V
    func body(content: Content) -> some View { content.animation(reduceMotion ? nil : animation, value: value) }
}

private struct NumberTransition: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let value: Double
    func body(content: Content) -> some View {
        content
            .contentTransition(reduceMotion ? .identity : .numericText(value: value))
            .animation(reduceMotion ? nil : Motion.quick, value: value)
    }
}

/// The content of a tab fades in with a short rise when the tab is opened (no movement with Reduce Motion).
private struct TabEntrance: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 8)
            .onAppear {
                guard !shown else { return }
                if reduceMotion { shown = true } else { withAnimation(.easeOut(duration: 0.22)) { shown = true } }
            }
            .onDisappear { shown = false }
    }
}

/// A short bounce of a symbol when something good happened (reserved, "I'll bring it", saved) – none with Reduce Motion.
private struct ConfirmBounce<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let value: V
    func body(content: Content) -> some View {
        if reduceMotion { content } else { content.symbolEffect(.bounce, value: value) }
    }
}

extension View {
    /// `.animation(_:value:)` that stays still with Reduce Motion
    func motion<V: Equatable>(_ animation: Animation = Motion.standard, value: V) -> some View {
        modifier(MotionAnimation(animation: animation, value: value))
    }

    /// totals and counts: the digits roll to the new value
    func numberTransition(_ value: Double) -> some View { modifier(NumberTransition(value: value)) }

    /// tab roots: a quiet fade-in when the tab is opened
    func tabEntrance() -> some View { modifier(TabEntrance()) }

    /// symbols: one bounce when `value` changes
    func confirmBounce<V: Equatable>(_ value: V) -> some View { modifier(ConfirmBounce(value: value)) }

    /// rows that come and go in lists: slide in from the top, fade out
    func rowTransition() -> some View { transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity), removal: .opacity)) }

    /// at least 44 × 44 pt to tap, whatever the symbol's size (Apple HIG, Dutch Detail tap targets)
    func tapTarget() -> some View { frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
}

extension Haptics {
    /// something went wrong (a purchase failed, a save did not go through)
    @MainActor static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
}
