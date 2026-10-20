import ActivityKit
import SwiftUI
import WidgetKit

/// "Jetzt" – the running task timer on the lock screen and in the Dynamic Island (attributes:
/// Shared/TaskTimerActivity.swift). Calm: the title and the time left, nothing red, no alarm.
struct TaskTimerActivityWidget: Widget {
    private let mint = Color(red: 0.45, green: 0.80, blue: 0.64)

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TaskTimerAttributes.self) { context in
            lockScreen(context.attributes, context.state)
                .padding(14)
                .activityBackgroundTint(Color(red: 0.06, green: 0.08, blue: 0.07))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "tohuus://today"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.emoji).font(.title2).accessibilityHidden(true)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    countdown(context.state.endsAt).font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(mint)
                        .frame(maxWidth: 80, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressView(timerInterval: context.attributes.startedAt...max(context.attributes.startedAt.addingTimeInterval(1), context.state.endsAt), countsDown: true) {
                        EmptyView()
                    } currentValueLabel: { EmptyView() }
                    .tint(mint)
                }
            } compactLeading: {
                Text(context.attributes.emoji).accessibilityLabel(context.attributes.title)
            } compactTrailing: {
                countdown(context.state.endsAt).font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(mint)
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(mint).accessibilityLabel(context.attributes.title)
            }
            .widgetURL(URL(string: "tohuus://today"))
        }
    }

    /// counts down by itself – the app doesn't need to update the activity every second
    private func countdown(_ end: Date) -> Text {
        Text(timerInterval: Date()...max(Date(), end), countsDown: true)
    }

    private func lockScreen(_ a: TaskTimerAttributes, _ s: TaskTimerAttributes.ContentState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text(a.emoji).font(.title2).accessibilityHidden(true)
                Text(a.title).font(.headline).foregroundStyle(.white).lineLimit(2)
                Spacer()
                countdown(s.endsAt).font(.title2.weight(.semibold).monospacedDigit()).foregroundStyle(mint)
                    .frame(maxWidth: 96, alignment: .trailing)
            }
            ProgressView(timerInterval: a.startedAt...max(a.startedAt.addingTimeInterval(1), s.endsAt), countsDown: true) {
                EmptyView()
            } currentValueLabel: { EmptyView() }
            .tint(mint)
        }
        .accessibilityElement(children: .combine)
    }
}
