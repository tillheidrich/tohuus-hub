import SwiftUI
import UIKit

/// Undo bars and toasts disappear after a few seconds – except while VoiceOver runs: then they stay until the person
/// acts or something new replaces them (WCAG 2.2.1 Timing Adjustable). Each one is also announced.
enum A11yTiming {
    /// Waits `seconds`, or forever while VoiceOver is on (the task is cancelled when the bar changes or goes away).
    static func hold(_ seconds: Double) async {
        if UIAccessibility.isVoiceOverRunning {
            while !Task.isCancelled { try? await Task.sleep(nanoseconds: 60_000_000_000) }
            return
        }
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    @MainActor static func announce(_ text: String) {
        UIAccessibility.post(notification: .announcement, argument: text)
    }
}
