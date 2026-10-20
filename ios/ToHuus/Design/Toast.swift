import SwiftUI

/// A short confirmation at the bottom ("Gemerkt – gilt auch für die nächsten Bons."), gone after a few seconds.
/// Announced to VoiceOver; optional action (e.g. "Rückgängig").
struct ToastMessage: Equatable, Identifiable {
    let id = UUID()
    var text: String
    var actionTitle: String?
    var isError = false
    var action: (@MainActor () -> Void)?
    /// how long it stays (e.g. 10 s for the undo after deleting data, DataWipeView); default 3 s, 6 s with an action
    var seconds: Double? = nil

    static func == (a: ToastMessage, b: ToastMessage) -> Bool { a.id == b.id }
}

private struct ToastModifier: ViewModifier {
    @Binding var message: ToastMessage?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let m = message {
                HStack(spacing: Theme.Space.s3) {
                    Image(systemName: m.isError ? "exclamationmark.circle" : "checkmark.circle")
                        .foregroundStyle(m.isError ? Theme.empty : Theme.mustard)
                    Text(m.text).font(.subheadline).foregroundStyle(Theme.onBlock)
                    Spacer(minLength: 0)
                    if let t = m.actionTitle, let a = m.action {
                        Button(t) { a(); message = nil }.font(.subheadline.weight(.semibold)).foregroundStyle(Theme.mustard)
                    }
                }
                .padding(Theme.Space.s3)
                .background(Theme.block, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                .shadow(color: .black.opacity(0.2), radius: 10, y: 4)
                .padding(.leading, Theme.Space.s4)
                // the round assistant button sits bottom right (MainTabView): keep "Rückgängig" out from under it
                .padding(.trailing, Theme.Space.s4 + 56 + Theme.Space.s2)
                .padding(.bottom, Theme.Space.s4)
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                .task(id: m.id) {
                    A11yTiming.announce(m.text)
                    await A11yTiming.hold(m.seconds ?? (m.action == nil ? 3 : 6))
                    if !Task.isCancelled, message?.id == m.id { Motion.perform { message = nil } }
                }
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: message)
    }
}

extension View {
    func toast(_ message: Binding<ToastMessage?>) -> some View { modifier(ToastModifier(message: message)) }
}
