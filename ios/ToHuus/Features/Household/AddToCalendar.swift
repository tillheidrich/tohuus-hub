import EventKit
import EventKitUI
import SwiftUI

/// "In den Kalender" (web: the .ics download from GET /api/care/:id/ics): Apple's own editor, prefilled with the task.
/// Since iOS 17 the editor runs outside the app and needs no calendar permission – the person picks the calendar and saves.
struct AddToCalendarView: UIViewControllerRepresentable {
    let task: CareTask
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = task.name
        event.location = task.place
        event.notes = [task.note, task.doer.map { LF("%@ does it", $0.name) }].compactMap { $0 }.joined(separator: "\n")
        if let start = TaskTime.start(task) {
            event.startDate = start
            event.endDate = start.addingTimeInterval(Double(task.durationMin ?? 60) * 60)
        } else if let day = ServerDate.parse(task.nextDue) {
            event.isAllDay = true
            event.startDate = day
            event.endDate = day
        }
        let vc = EKEventEditViewController()
        vc.eventStore = store
        vc.event = event
        vc.editViewDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: EKEventEditViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(dismiss: dismiss) }

    @MainActor final class Coordinator: NSObject, EKEventEditViewDelegate {
        let dismiss: DismissAction
        init(dismiss: DismissAction) { self.dismiss = dismiss }
        // UIKit calls this on the main thread
        nonisolated func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            MainActor.assumeIsolated { dismiss() }
        }
    }
}

/// How a task's time reads (web: pages/taskTime.ts)
enum TaskTime {
    /// "10:00" → "10:00 Uhr"
    static func label(_ hhmm: String) -> String { LF("%@ o’clock", hhmm) }

    static func duration(_ min: Int) -> String {
        min < 60 ? LF("%d min", min) : min % 60 == 0 ? LF("%d h", min / 60) : LF("%d h %d min", min / 60, min % 60)
    }

    static let durations = [15, 30, 45, 60, 90, 120, 180, 240]

    /// the task's day and time as a date (the phone's time zone – the household's in nearly every case)
    static func start(_ task: CareTask) -> Date? {
        guard let day = ServerDate.parse(task.nextDue), let t = task.dueTime else { return nil }
        let parts = t.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day)
    }

    static func hhmm(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}
