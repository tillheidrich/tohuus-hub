import SwiftUI

/// A short confirmation at the bottom ("Gemerkt – gilt auch für die nächsten Bons."), gone after a few seconds.
/// Announced to VoiceOver; optional action (e.g. "Rückgängig").
struct ToastMessage: Equatable, Identifiable {
    let id = UUID()
    var text: String
    var actionTitle: String?
    var isError = false
    var action: (@MainActor () -> Void)?

    static func == (a: ToastMessage, b: ToastMessage) -> Bool { a.id == b.id }
}

private struct ToastModifier: ViewModifier {
    @Binding var message: ToastMessage?

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
                .padding(.horizontal, Theme.Space.s4)
                .padding(.bottom, Theme.Space.s4)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: m.id) {
                    UIAccessibility.post(notification: .announcement, argument: m.text)
                    try? await Task.sleep(nanoseconds: m.action == nil ? 3_000_000_000 : 6_000_000_000)
                    if message?.id == m.id { withAnimation { message = nil } }
                }
            }
        }
        .animation(.easeOut(duration: 0.2), value: message)
    }
}

extension View {
    func toast(_ message: Binding<ToastMessage?>) -> some View { modifier(ToastModifier(message: message)) }
}
