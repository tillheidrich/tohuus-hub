import SwiftUI

/// "Was schaffst du heute?" (15 Oct 2026): the tasks due today or overdue, one card at a time. Right = "Mach ich heute"
/// (the promise of the task detail, POST /api/care/:id/promise { when: today }), left = "Darf warten" (next date one
/// week later, PATCH /api/care/:id { next_due }), the button "Erledigt" ticks it off. Never shaming: nothing here is
/// counted, waiting is a fine answer.
struct TaskTodayView: View {
    let api: APIClient
    let tasks: [CareTask]
    var onChanged: () -> Void = {}
    @State private var error: String?

    private let actions = [
        SwipeDeckAction(id: "wait", title: L("May wait"), systemImage: "clock.arrow.circlepath", direction: .left),
        SwipeDeckAction(id: "done", title: L("Completed"), systemImage: "checkmark"),
        SwipeDeckAction(id: "today", title: L("I’ll do it today"), systemImage: "hand.raised", direction: .right, prominent: true),
    ]

    /// due today or overdue; fixed deadlines (passport) need a new date when done, so they stay in the list
    static func candidates(_ all: [CareTask]) -> [CareTask] {
        all.filter { ($0.state == "overdue" || $0.state == "today") && !($0.intervalN == nil && $0.asNeeded != true && !$0.isHouse) }
            .sorted { ($0.nextDue ?? "") < ($1.nextDue ?? "") }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("What will you manage today?")).font(Theme.title(Theme.FontSize.h2)).foregroundStyle(Theme.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(L("None of this is bad. Pick what fits today – the rest can wait a week."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let error { ErrorBanner(message: error) }
                SwipeDeck(items: tasks, actions: actions, onAction: act) { t in
                    VStack(alignment: .leading, spacing: Theme.Space.s3) {
                        Image(systemName: CareLabels.icon(t.template, category: t.category))
                            .font(.title2).foregroundStyle(Theme.primaryText).accessibilityHidden(true)
                        Text(t.name).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(sub(t)).font(.caption).foregroundStyle(Theme.ink3)
                        if let n = t.note, !n.isEmpty {
                            Text(n).font(.subheadline).foregroundStyle(Theme.ink2).lineLimit(4)
                        }
                    }
                } end: { counts in
                    SwipeDeckEnd(systemImage: "sun.max", title: counts["today"].map { LF("%d for today. That’s enough.", $0) } ?? L("Sorted for today."),
                                 message: summary(counts))
                }
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 80)
        }
        .canvasBackground()
        .navigationTitle(L("Tasks"))
        .navigationBarTitleDisplayMode(.inline)
    }

    /// "today" / "since Monday" – a date, never a count of days late
    private func sub(_ t: CareTask) -> String {
        [t.state == "today" ? L("today") : t.nextDue.map { LF("since %@", ServerDate.shortDay($0) ?? $0) },
         t.doer.map { LF("%@ does it", $0.name) },
         t.isPrivate ? L("only for you") : nil].compactMap { $0 }.joined(separator: " · ")
    }

    private func summary(_ c: [String: Int]) -> String {
        [c["done"].map { LF("%d done", $0) },
         c["wait"].map { LF("%d can wait", $0) }].compactMap { $0 }.joined(separator: " · ")
    }

    private func act(_ t: CareTask, _ a: SwipeDeckAction) async -> Bool {
        do {
            switch a.id {
            case "today":
                try await api.carePromise(t.id, "today")
            case "done":
                _ = try await api.careDone(t.id)
            default:
                // a week from today (or from the due date, if that is later)
                let base = max(t.nextDue.map { String($0.prefix(10)) } ?? WeekDays.today, WeekDays.today)
                try await api.saveCareTask(id: t.id, ["next_due": WeekDays.shift(base, 7)])
            }
            error = nil
            onChanged()
            return true
        } catch {
            self.error = APIError.from(error).localizedDescription
            return false
        }
    }
}

/// The way in on Aufgaben, when three or more tasks are due today or overdue.
struct TaskTodayLink: View {
    let api: APIClient
    let tasks: [CareTask]
    var onChanged: () -> Void = {}

    var body: some View {
        NavigationLink { TaskTodayView(api: api, tasks: tasks, onChanged: onChanged) } label: {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("What will you manage today?"))
                    Text(LF("%d tasks, one at a time – none of it is bad.", tasks.count)).font(.caption).foregroundStyle(Theme.ink3)
                }
            } icon: { Image(systemName: "rectangle.stack").foregroundStyle(Theme.primaryText) }
        }
    }
}
