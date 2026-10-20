#if os(iOS) && canImport(ActivityKit)
import ActivityKit
import Foundation

/// Live Activity "Jetzt" (lock screen + Dynamic Island, docs/now.md): only while the timer of a task runs – the task's
/// title and the countdown. Started and ended by the app (Features/Focus/NowViews.swift TaskTimerLive): "Fertig",
/// stopping the timer or the end of the time end it. Drawn by the widget extension
/// (ToHuusWidget/TaskTimerActivityWidget.swift). Local updates only, no push. Shared by both targets.
struct TaskTimerAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable, Sendable {
        /// when the time is up
        var endsAt: Date
    }

    var taskId: Int
    var title: String
    var emoji: String
    /// when the timer started (for the progress bar)
    var startedAt: Date
}
#endif
